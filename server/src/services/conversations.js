import { db, now } from '../db/knex.js'
import { emitCompany } from './realtime.js'
import { providerFor } from './whatsapp/index.js'
import { saveMedia, readMediaBase64 } from './media.js'

export async function logActivity(companyId, conversationId, type, data = {}, userId = null) {
  await db('activity_log').insert({ company_id: companyId, conversation_id: conversationId, user_id: userId, type, data: JSON.stringify(data) })
}

/** Conversación con contacto, etiquetas, asignado y etapa (lo que muestra la bandeja) */
export async function loadConversation(id) {
  const c = await db('conversations as c')
    .leftJoin('contacts as ct', 'ct.id', 'c.contact_id')
    .leftJoin('users as u', 'u.id', 'c.assigned_user_id')
    .leftJoin('pipeline_stages as s', 's.id', 'c.stage_id')
    .leftJoin('whatsapp_instances as w', 'w.id', 'c.instance_id')
    .select('c.*', 'ct.name as contact_name', 'ct.phone as contact_phone', 'ct.wa_jid as contact_jid', 'ct.source as contact_source', 'ct.campaign as contact_campaign', 'ct.city as contact_city',
      'u.name as assigned_name', 's.name as stage_name', 's.color as stage_color', 'w.name as instance_name', 'w.provider as instance_provider')
    .where('c.id', id).first()
  if (!c) return null
  c.tags = await db('conversation_tags as ctg').join('tags as t', 't.id', 'ctg.tag_id').where('ctg.conversation_id', id).select('t.id', 't.name', 't.color')
  const last = await db('messages').where({ conversation_id: id }).orderBy('created_at', 'desc').first()
  c.last_message = last ? { body: last.body, direction: last.direction, sender_type: last.sender_type, created_at: last.created_at } : null
  return c
}

export async function broadcastConversation(id) {
  const c = await loadConversation(id)
  if (c) emitCompany(c.company_id, 'conversation:update', c)
  return c
}

/**
 * Envía un mensaje saliente (por asesor, bot o sistema) por la instancia de la conversación.
 */
export async function sendOutbound(conversationId, { body, senderType = 'user', userId = null, type = 'text', media = null, savedMedia = null }) {
  const conv = await db('conversations').where({ id: conversationId }).first()
  if (!conv) throw new Error('Conversación no existe')
  const contact = await db('contacts').where({ id: conv.contact_id }).first()
  const inst = conv.instance_id ? await db('whatsapp_instances').where({ id: conv.instance_id }).first() : null

  let waId = null
  let status = 'sent'
  let errorMsg = null
  let saved = null
  if (savedMedia) { saved = savedMedia; type = saved.type } // archivo ya guardado (difusiones: un solo archivo para todos)
  else if (media) { saved = saveMedia({ base64: media.base64, mime: media.mime, name: media.name }); type = saved.type }
  // Por QR se responde al identificador exacto de WhatsApp (necesario para contactos @lid)
  const target = inst?.provider === 'evolution' && contact.wa_jid ? contact.wa_jid : contact.phone
  if (inst && inst.status === 'connected') {
    try {
      const r = saved
        ? await providerFor(inst).sendMedia(inst, target, { base64: readMediaBase64(saved.url), mime: saved.mime, name: saved.name, type: saved.type, caption: body || '' })
        : await providerFor(inst).sendText(inst, target, body)
      waId = r?.id || null
    } catch (e) {
      console.error('Error enviando por WhatsApp:', e.message)
      status = 'failed'
      errorMsg = e.code === 131047 ? 'Ventana de 24 horas cerrada: envía una plantilla aprobada' : e.message.slice(0, 250)
    }
  } else {
    status = 'failed'
  }

  const ts = now()
  const [row] = await db('messages').insert({
    conversation_id: conversationId, direction: 'out', sender_type: senderType, sender_user_id: userId,
    type, body: body || '', wa_message_id: waId, status, created_at: ts,
    media_url: saved?.url || null, media_name: saved?.name || null, media_mime: saved?.mime || null, media_size: saved?.size || null, error: errorMsg,
  }).returning('id')
  const msgId = row.id ?? row
  const patch = { last_message_at: ts, last_outbound_at: ts, unread_count: 0 }
  if (!conv.first_response_at && senderType !== 'system') patch.first_response_at = ts
  if (conv.status === 'closed') patch.status = 'open'
  await db('conversations').where({ id: conversationId }).update(patch)

  const msg = await db('messages').where({ id: msgId }).first()
  emitCompany(conv.company_id, 'message:new', { ...msg, company_id: conv.company_id })
  await broadcastConversation(conversationId)
  return msg
}

export async function addTagByName(conversationId, companyId, tagName) {
  const tag = await db('tags').where({ company_id: companyId, name: tagName }).first()
  if (!tag) return
  await db('conversation_tags').insert({ conversation_id: conversationId, tag_id: tag.id }).onConflict().ignore()
}

export async function moveToStageByName(conversationId, companyId, stageName) {
  const stage = await db('pipeline_stages as s').join('pipelines as p', 'p.id', 's.pipeline_id')
    .where({ 'p.company_id': companyId, 's.name': stageName }).select('s.id', 'p.id as pipeline_id').first()
  if (!stage) return
  await db('conversations').where({ id: conversationId }).update({ stage_id: stage.id, pipeline_id: stage.pipeline_id, stage_entered_at: now() })
}

/** Asigna al asesor con menos conversaciones abiertas en la empresa (round robin ponderado) */
export async function assignRoundRobin(conversationId, companyId) {
  const agents = await db('company_users as cu').join('users as u', 'u.id', 'cu.user_id')
    .where({ 'cu.company_id': companyId, 'u.active': true, 'u.role': 'agent' }).select('u.id')
  if (!agents.length) return null
  const loads = await db('conversations').where({ company_id: companyId, status: 'open' }).whereNotNull('assigned_user_id')
    .groupBy('assigned_user_id').select('assigned_user_id').count('id as n')
  const loadMap = Object.fromEntries(loads.map((l) => [l.assigned_user_id, Number(l.n)]))
  const pick = agents.sort((a, b) => (loadMap[a.id] || 0) - (loadMap[b.id] || 0))[0]
  await db('conversations').where({ id: conversationId }).update({ assigned_user_id: pick.id })
  return pick.id
}

/** Envía una plantilla aprobada (API oficial). Se usa para escribir fuera de la ventana de 24 horas. */
export async function sendTemplateMessage(conversationId, { name, language, params = [], body, userId }) {
  const conv = await db('conversations').where({ id: conversationId }).first()
  const contact = await db('contacts').where({ id: conv.contact_id }).first()
  const inst = conv.instance_id ? await db('whatsapp_instances').where({ id: conv.instance_id }).first() : null
  if (!inst || inst.provider !== 'meta') throw new Error('Las plantillas solo aplican a números de la API oficial')
  let waId = null, status = 'sent', errorMsg = null
  try { waId = (await providerFor(inst).sendTemplate(inst, contact.phone, { name, language, params }))?.id || null }
  catch (e) { status = 'failed'; errorMsg = e.message.slice(0, 250) }
  const ts = now()
  const [row] = await db('messages').insert({ conversation_id: conversationId, direction: 'out', sender_type: 'user', sender_user_id: userId, type: 'text',
    body: body || `[Plantilla ${name}]`, wa_message_id: waId, status, error: errorMsg, created_at: ts }).returning('id')
  const patch = { last_message_at: ts, last_outbound_at: ts, unread_count: 0 }
  if (!conv.first_response_at) patch.first_response_at = ts
  if (conv.status === 'closed') patch.status = 'open'
  await db('conversations').where({ id: conversationId }).update(patch)
  const msg = await db('messages').where({ id: row.id ?? row }).first()
  emitCompany(conv.company_id, 'message:new', { ...msg, company_id: conv.company_id })
  await broadcastConversation(conversationId)
  if (status === 'failed') { const e = new Error(errorMsg); e.message_row = msg; throw e }
  return msg
}

/** Actualiza el estado de entrega de un mensaje saliente (enviado, entregado, leído, fallido) */
export async function updateMessageStatus(waMessageId, status, error) {
  const msg = await db('messages').where({ wa_message_id: waMessageId }).first()
  if (!msg) return
  const order = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 }
  if (status !== 'failed' && (order[msg.status] ?? 0) >= (order[status] ?? 0)) return
  await db('messages').where({ id: msg.id }).update({ status, error: error || msg.error || null })
  const conv = await db('conversations').where({ id: msg.conversation_id }).first()
  emitCompany(conv.company_id, 'message:status', { id: msg.id, conversation_id: msg.conversation_id, status, error })
}

/** Reintenta un mensaje saliente fallido (texto o archivo) y actualiza el mismo registro */
export async function retryMessage(messageId) {
  const msg = await db('messages').where({ id: messageId }).first()
  if (!msg || msg.direction !== 'out' || msg.status !== 'failed') throw new Error('Solo se pueden reintentar mensajes enviados que fallaron')
  const conv = await db('conversations').where({ id: msg.conversation_id }).first()
  const contact = await db('contacts').where({ id: conv.contact_id }).first()
  const inst = conv.instance_id ? await db('whatsapp_instances').where({ id: conv.instance_id }).first() : null
  if (!inst || inst.status !== 'connected') throw new Error('El número de WhatsApp de esta conversación no está conectado')
  const target = inst.provider === 'evolution' && contact.wa_jid ? contact.wa_jid : contact.phone
  let status = 'sent', waId = null, error = null
  try {
    const r = msg.media_url
      ? await providerFor(inst).sendMedia(inst, target, { base64: readMediaBase64(msg.media_url), mime: msg.media_mime, name: msg.media_name, type: msg.type, caption: msg.body || '' })
      : await providerFor(inst).sendText(inst, target, msg.body)
    waId = r?.id || null
  } catch (e) { status = 'failed'; error = e.code === 131047 ? 'Ventana de 24 horas cerrada: envía una plantilla aprobada' : e.message.slice(0, 250) }
  await db('messages').where({ id: msg.id }).update({ status, wa_message_id: waId, error })
  emitCompany(conv.company_id, 'message:status', { id: msg.id, conversation_id: msg.conversation_id, status, error })
  if (status === 'sent' && !conv.first_response_at && msg.sender_type !== 'system') await db('conversations').where({ id: conv.id }).update({ first_response_at: now() })
  return { ...msg, status, wa_message_id: waId, error }
}
