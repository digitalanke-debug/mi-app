import { db } from '../db/knex.js'
import { emitCompany } from './realtime.js'
import { loadConversation, logActivity } from './conversations.js'
import { providerFor } from './whatsapp/index.js'

/**
 * WhatsApp a veces oculta el número de quien escribe y solo entrega un identificador privado (@lid).
 * Aquí se guarda el teléfono real cuando aparece (WhatsApp lo revela, o alguien lo escribe a mano)
 * y se unen los contactos duplicados de la misma persona.
 */

const isPlaceholderName = (c) => !c.name || c.name === 'Contacto de WhatsApp' || c.name === c.phone || c.name === `+${c.phone}`

/** El "teléfono" guardado es en realidad el @lid: WhatsApp no nos ha dado el número */
export const hasHiddenPhone = (c) => !!c?.wa_jid?.endsWith('@lid') && c.wa_jid.split('@')[0] === c.phone

export const contactLid = (c) => c.wa_lid || (c.wa_jid?.endsWith('@lid') ? c.wa_jid : null)

export async function findContactByLid(companyId, lid) {
  if (!lid) return null
  return db('contacts').where({ company_id: companyId }).where((b) => b.where('wa_lid', lid).orWhere('wa_jid', lid)).first()
}

/** Une dos conversaciones abiertas de la misma persona en la más antigua */
async function mergeConversations(keep, dup) {
  await db('messages').where({ conversation_id: dup.id }).update({ conversation_id: keep.id })
  await db('notes').where({ conversation_id: dup.id }).update({ conversation_id: keep.id })
  await db('tasks').where({ conversation_id: dup.id }).update({ conversation_id: keep.id })
  await db('activity_log').where({ conversation_id: dup.id }).update({ conversation_id: keep.id })
  const keepTags = (await db('conversation_tags').where({ conversation_id: keep.id })).map((t) => t.tag_id)
  for (const t of await db('conversation_tags').where({ conversation_id: dup.id })) {
    if (!keepTags.includes(t.tag_id)) await db('conversation_tags').insert({ conversation_id: keep.id, tag_id: t.tag_id })
  }
  const max = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b)
  const min = (a, b) => (!a ? b : !b ? a : new Date(a) < new Date(b) ? a : b)
  await db('conversations').where({ id: keep.id }).update({
    last_message_at: max(keep.last_message_at, dup.last_message_at),
    last_inbound_at: max(keep.last_inbound_at, dup.last_inbound_at),
    last_outbound_at: max(keep.last_outbound_at, dup.last_outbound_at),
    first_response_at: min(keep.first_response_at, dup.first_response_at),
    unread_count: (keep.unread_count || 0) + (dup.unread_count || 0),
    assigned_user_id: keep.assigned_user_id || dup.assigned_user_id,
    service: keep.service || dup.service,
    value: Number(keep.value) || Number(dup.value) || 0,
    status: keep.status === 'open' || dup.status === 'open' ? 'open' : keep.status,
  })
  await db('conversations').where({ id: dup.id }).del()
  emitCompany(keep.company_id, 'conversation:removed', { id: dup.id, into: keep.id, company_id: keep.company_id })
}

/** Pasa todo lo de `dup` (conversaciones, difusiones, datos) a `keep` y borra `dup` */
async function mergeContacts(keep, dup) {
  const patch = {}
  for (const f of ['email', 'document', 'city']) if (!keep[f] && dup[f]) patch[f] = dup[f]
  if (dup.notes) patch.notes = keep.notes ? `${keep.notes}\n${dup.notes}` : dup.notes
  if (isPlaceholderName(keep) && !isPlaceholderName(dup)) patch.name = dup.name
  if (keep.source === 'organico' && dup.source && dup.source !== 'organico') { patch.source = dup.source; patch.campaign = dup.campaign }

  await db('conversations').where({ contact_id: dup.id }).update({ contact_id: keep.id })
  for (const r of await db('broadcast_recipients').where({ contact_id: dup.id })) {
    const exists = await db('broadcast_recipients').where({ broadcast_id: r.broadcast_id, contact_id: keep.id }).first()
    if (exists) await db('broadcast_recipients').where({ id: r.id }).del()
    else await db('broadcast_recipients').where({ id: r.id }).update({ contact_id: keep.id })
  }
  await db('contacts').where({ id: dup.id }).del()
  if (Object.keys(patch).length) await db('contacts').where({ id: keep.id }).update(patch)

  // Si quedaron dos conversaciones activas, se dejan en una sola
  const active = await db('conversations').where({ contact_id: keep.id }).whereNot('status', 'closed').orderBy('id')
  for (const c of active.slice(1)) await mergeConversations(active[0], c)
}

/**
 * Guarda el teléfono real de un contacto. Si ya existía otro contacto con ese número, los une.
 * `verified`: el número vino de WhatsApp (no escrito a mano).
 */
export async function setContactPhone(contact, rawPhone, { verified = false, userId = null } = {}) {
  const phone = String(rawPhone || '').replace(/\D/g, '')
  if (phone === contact.phone) return contact
  if (phone.length < 7 || phone.length > 15) throw Object.assign(new Error('Número no válido: escríbelo con indicativo de país, por ejemplo 573001234567'), { status: 400 })
  const lid = contactLid(contact)
  const other = await db('contacts').where({ company_id: contact.company_id, phone }).whereNot('id', contact.id).first()
  if (other) await mergeContacts(contact, other)
  // Se sigue enviando al identificador @lid si lo tenemos: es el que WhatsApp garantiza que llega
  const patch = { phone, wa_lid: lid }
  if (!lid && verified) patch.wa_jid = `${phone}@s.whatsapp.net`
  await db('contacts').where({ id: contact.id }).update(patch)
  const updated = await db('contacts').where({ id: contact.id }).first()

  const convs = await db('conversations').where({ contact_id: contact.id })
  for (const c of convs) {
    await logActivity(contact.company_id, c.id, 'contact.phone', { phone, verified, merged: other?.id || null, user_id: userId })
    emitCompany(contact.company_id, 'conversation:update', await loadConversation(c.id))
  }
  return updated
}

/** Número de WhatsApp (instancia) por el que más recientemente habló el contacto */
async function instanceFor(contact) {
  const conv = await db('conversations as c').join('whatsapp_instances as w', 'w.id', 'c.instance_id')
    .where({ 'c.contact_id': contact.id }).orderBy('c.last_message_at', 'desc').select('w.*').first()
  return conv || null
}

/** Intenta descubrir el número real de un contacto con número oculto. Devuelve el contacto (actualizado o no). */
export async function resolveHiddenPhone(contact, inst = null) {
  if (!hasHiddenPhone(contact)) return contact
  inst = inst || await instanceFor(contact)
  const prov = inst && providerFor(inst)
  if (!prov?.lookupPhoneForLid) return contact
  const phone = await prov.lookupPhoneForLid(inst, contact.wa_jid)
  if (!phone || phone === contact.phone) return contact
  console.log(`Número real encontrado para ${contact.wa_jid}: ${phone}`)
  return setContactPhone(contact, phone, { verified: true })
}

const lastTry = new Map()
/** Revisión periódica de todos los contactos con número oculto (cada uno como máximo cada 30 min) */
export async function resolveHiddenPhones() {
  const pending = (await db('contacts').whereLike('wa_jid', '%@lid')).filter(hasHiddenPhone)
  let found = 0
  for (const c of pending) {
    if (Date.now() - (lastTry.get(c.id) || 0) < 30 * 60_000) continue
    lastTry.set(c.id, Date.now())
    try { const u = await resolveHiddenPhone(c); if (u.phone !== c.phone) found++ } catch (e) { console.warn(`resolver ${c.wa_jid}:`, e.message) }
  }
  return { pending: pending.length, found }
}
