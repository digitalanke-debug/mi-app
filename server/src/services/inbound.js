import { db, now } from '../db/knex.js'
import { emitCompany } from './realtime.js'
import { loadConversation, logActivity } from './conversations.js'
import { fire } from './automations.js'
import { saveMedia } from './media.js'
import { providerFor } from './whatsapp/index.js'
import { findContactByLid, setContactPhone, resolveHiddenPhone } from './contactIdentity.js'

/**
 * Detecta código de campaña en el primer mensaje.
 * Los anuncios de Google Ads / web usan enlaces wa.me con texto prellenado tipo:
 *   "Hola, quiero información [GA-BUSQUEDA-MARCA]"  ->  source=google_ads, campaign=BUSQUEDA-MARCA
 *   "... [META-IG-SEPT]" -> meta_ads ; "... [WEB-LANDING]" -> web ; "... [REF-JUAN]" -> referido
 */
export function detectSource(text) {
  const m = /\[(GA|GOOGLE|META|FB|IG|WEB|REF)[-_ ]([^\]]+)\]/i.exec(text || '')
  if (!m) return null
  const key = m[1].toUpperCase()
  const source = key === 'GA' || key === 'GOOGLE' ? 'google_ads' : ['META', 'FB', 'IG'].includes(key) ? 'meta_ads' : key === 'WEB' ? 'web' : 'referido'
  return { source, campaign: m[2].trim() }
}

/**
 * Punto único de entrada de mensajes entrantes (Evolution, demo, o cualquier proveedor futuro).
 * Crea/actualiza contacto y conversación, guarda el mensaje, emite tiempo real y dispara automatizaciones.
 */
export async function handleInbound(inst, { phone, name, body, type = 'text', waMessageId = null, adReferral = null, media = null, jid = null, lid = null }) {
  const company = await db('companies').where({ id: inst.company_id }).first()
  const cleanPhone = String(phone).replace(/\D/g, '')

  let contact = await db('contacts').where({ company_id: company.id, phone: cleanPhone }).first()
  if (jid?.endsWith('@lid')) lid = jid
  if (!contact && lid) contact = await findContactByLid(company.id, lid)
  if (!contact && !jid?.endsWith('@lid') && providerFor(inst).lidForMessage) {
    // Llegó con número real: si antes esta persona escribió con número oculto, se completa ese contacto en vez de crear otro
    try { lid = lid || await providerFor(inst).lidForMessage(inst, waMessageId) } catch (e) { console.warn('lidForMessage:', e.message) }
    const hidden = lid && await findContactByLid(company.id, lid)
    if (hidden) contact = await setContactPhone(hidden, cleanPhone, { verified: true })
  }
  if (contact && lid && !contact.wa_lid) { await db('contacts').where({ id: contact.id }).update({ wa_lid: lid }); contact = { ...contact, wa_lid: lid } }
  const detected = detectSource(body) || adReferral
  let isNewContact = false
  if (!contact) {
    isNewContact = true
    const [row] = await db('contacts').insert({ company_id: company.id, phone: cleanPhone, wa_jid: jid, wa_lid: lid, name: name || (jid?.endsWith('@lid') ? 'Contacto de WhatsApp' : cleanPhone),
      source: detected?.source || 'organico', campaign: detected?.campaign || null }).returning('id')
    contact = await db('contacts').where({ id: row.id ?? row }).first()
  } else if (jid && contact.wa_jid !== jid && !(contact.wa_jid?.endsWith('@lid') && jid.endsWith('@s.whatsapp.net'))) {
    // Guarda o actualiza el identificador de WhatsApp (y el nombre si llegó vacío)
    await db('contacts').where({ id: contact.id }).update({ wa_jid: jid, ...(name && (contact.name === contact.phone || contact.name === 'Contacto de WhatsApp') ? { name } : {}) })
    contact = { ...contact, wa_jid: jid }
  }
  if (detected && contact.source === 'organico') {
    await db('contacts').where({ id: contact.id }).update({ source: detected.source, campaign: detected.campaign })
    contact = { ...contact, ...detected }
  }

  let conv = await db('conversations').where({ company_id: company.id, contact_id: contact.id }).whereNot('status', 'closed').orderBy('id', 'desc').first()
  let isNew = false
  const ts = now()
  if (!conv) {
    isNew = true
    const pipeline = await db('pipelines').where({ company_id: company.id }).orderBy('is_default', 'desc').first()
    const stage = pipeline ? await db('pipeline_stages').where({ pipeline_id: pipeline.id }).orderBy('position').first() : null
    const [row] = await db('conversations').insert({
      company_id: company.id, instance_id: inst.id, contact_id: contact.id, pipeline_id: pipeline?.id || null, stage_id: stage?.id || null,
      status: 'open', opened_at: ts, stage_entered_at: ts, last_message_at: ts, last_inbound_at: ts, unread_count: 1,
    }).returning('id')
    conv = await db('conversations').where({ id: row.id ?? row }).first()
    await logActivity(company.id, conv.id, 'conversation.created', { source: contact.source, campaign: contact.campaign, new_contact: isNewContact })
  } else {
    await db('conversations').where({ id: conv.id }).update({ last_message_at: ts, last_inbound_at: ts, unread_count: (conv.unread_count || 0) + 1, status: 'open' })
    conv = await db('conversations').where({ id: conv.id }).first()
  }

  let saved = null
  if (media) {
    try {
      let b64 = media.base64
      if (!b64 && waMessageId) { const r = await providerFor(inst).fetchMediaBase64(inst, waMessageId); if (r) { b64 = r.base64; media.mime = media.mime || r.mime } }
      if (b64) saved = saveMedia({ base64: b64, mime: media.mime, name: media.name })
    } catch (e) { console.error('No se pudo guardar el medio entrante:', e.message) }
  }
  const [mrow] = await db('messages').insert({ conversation_id: conv.id, direction: 'in', sender_type: 'contact', type, body: body || (saved ? '' : (type !== 'text' ? `[${type}]` : '')), wa_message_id: waMessageId, status: 'delivered', created_at: ts,
    media_url: saved?.url || null, media_name: saved?.name || media?.name || null, media_mime: saved?.mime || media?.mime || null, media_size: saved?.size || null }).returning('id')
  const message = await db('messages').where({ id: mrow.id ?? mrow }).first()
  emitCompany(company.id, 'message:new', { ...message, company_id: company.id })
  emitCompany(company.id, 'conversation:update', await loadConversation(conv.id))

  const ctx = { company, conversation: conv, contact, message, instance: inst }
  if (isNew) await fire('new_conversation', ctx)
  await fire('outside_hours', ctx)
  await fire('keyword', ctx)
  await fire('message_in', ctx)
  emitCompany(company.id, 'conversation:update', await loadConversation(conv.id))
  // Número oculto: intenta descubrir el real en segundo plano
  if (isNewContact && contact.wa_jid?.endsWith('@lid')) resolveHiddenPhone(contact, inst).catch((e) => console.warn('resolver lid:', e.message))
  return { conversation: conv, message, isNew }
}
