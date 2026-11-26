import { db, now } from '../db/knex.js'
import { providerFor } from './whatsapp/index.js'
import { sendOutbound, logActivity, broadcastConversation } from './conversations.js'
import { normalizePhone } from './broadcasts.js'

const fail = (status, message) => Object.assign(new Error(message), { status })

/**
 * Empieza una conversación con un número que dicta el cliente (sin esperar a que escriba primero).
 * Crea o reutiliza el contacto y el chat, y envía el primer mensaje si el número lo permite.
 */
export async function startConversation({ companyId, instanceId, phone: raw, name, body, user }) {
  const phone = normalizePhone(raw)
  if (!phone) throw fail(400, 'Escribe el número completo: 10 dígitos si es de Colombia (ej. 300 123 4567) o con su indicativo si es de otro país (ej. +1 305 555 1234).')
  const inst = await db('whatsapp_instances').where({ id: instanceId, company_id: companyId }).first()
  if (!inst) throw fail(400, 'Elige desde qué número de WhatsApp vas a escribir.')
  if (inst.status !== 'connected') throw fail(400, `El número "${inst.name}" está desconectado. Vuelve a conectarlo en la pantalla WhatsApp.`)

  // ¿Ese número tiene WhatsApp? (solo se puede comprobar en números por QR)
  const prov = providerFor(inst)
  let check = null
  if (prov.checkNumber) {
    try { check = await prov.checkNumber(inst, phone) } catch (e) { console.warn('Comprobar número:', e.message) }
    if (check && !check.exists) throw fail(400, `El número +${phone} no tiene WhatsApp. Revisa que esté bien escrito.`)
  }
  const jid = check?.jid || null
  const lid = jid?.endsWith('@lid') ? jid : null

  let contact = await db('contacts').where({ company_id: companyId, phone }).first()
  if (!contact && lid) contact = await db('contacts').where({ company_id: companyId }).where((b) => b.where('wa_lid', lid).orWhere('wa_jid', lid)).first()
  const cleanName = String(name || '').trim().slice(0, 120) || null
  if (!contact) {
    const [row] = await db('contacts').insert({ company_id: companyId, phone, name: cleanName || `+${phone}`, wa_jid: jid, wa_lid: lid, source: 'organico' }).returning('id')
    contact = await db('contacts').where({ id: row.id ?? row }).first()
  } else {
    const patch = {}
    if (cleanName && (!contact.name || contact.name === contact.phone || contact.name === `+${contact.phone}` || contact.name === 'Contacto de WhatsApp')) patch.name = cleanName
    if (jid && !contact.wa_jid) patch.wa_jid = jid
    if (Object.keys(patch).length) { await db('contacts').where({ id: contact.id }).update(patch); contact = { ...contact, ...patch } }
  }

  // Reutiliza el chat abierto de esa persona; si no hay, crea uno nuevo asignado a quien lo empieza
  const ts = now()
  let conv = await db('conversations').where({ company_id: companyId, contact_id: contact.id }).whereNot('status', 'closed').orderBy('id', 'desc').first()
  let created = false
  if (conv) {
    const patch = { status: 'open' }
    if (conv.instance_id !== inst.id) patch.instance_id = inst.id
    if (!conv.assigned_user_id) patch.assigned_user_id = user.id
    await db('conversations').where({ id: conv.id }).update(patch)
  } else {
    created = true
    const pipeline = await db('pipelines').where({ company_id: companyId }).orderBy('is_default', 'desc').first()
    const stage = pipeline ? await db('pipeline_stages').where({ pipeline_id: pipeline.id }).orderBy('position').first() : null
    const [row] = await db('conversations').insert({
      company_id: companyId, instance_id: inst.id, contact_id: contact.id, pipeline_id: pipeline?.id || null, stage_id: stage?.id || null,
      assigned_user_id: user.id, status: 'open', opened_at: ts, stage_entered_at: ts, last_message_at: ts, unread_count: 0,
    }).returning('id')
    conv = await db('conversations').where({ id: row.id ?? row }).first()
  }
  await logActivity(companyId, conv.id, 'conversation.started', { phone, instance: inst.name, created }, user.id)

  // Primer mensaje. Con la API oficial no se puede escribir texto libre a quien no ha escrito: hace falta una plantilla.
  const text = String(body || '').trim()
  let sent = false, error = null, needsTemplate = false
  if (inst.provider === 'meta') needsTemplate = true
  else if (text) {
    try {
      const msg = await sendOutbound(conv.id, { body: text, senderType: 'user', userId: user.id })
      if (msg?.status === 'failed') error = msg.error || 'WhatsApp no aceptó el mensaje. Puedes reintentarlo desde el chat.'
      else sent = true
    } catch (e) { error = e.message }
  }
  await broadcastConversation(conv.id)
  return { conversation_id: conv.id, contact_id: contact.id, created, sent, error, needs_template: needsTemplate }
}
