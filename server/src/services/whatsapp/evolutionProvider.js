import { config } from '../../config.js'
import { db, now } from '../../db/knex.js'
import { emitCompany } from '../realtime.js'
import { publicInstance } from './public.js'

/**
 * Proveedor EVOLUTION API (https://doc.evolution-api.com)
 * Una "instancia" de Evolution = un WhatsApp Business conectado por QR.
 * Evolution nos avisa por webhook de: QRCODE_UPDATED, CONNECTION_UPDATE, MESSAGES_UPSERT.
 */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${config.evolution.url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: config.evolution.apiKey },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw new Error(`Evolution ${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

const EVENTS = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE']
// Evolution v2 descarta el webhook si no lleva enabled: true
const webhookConfig = (inst) => ({ enabled: true, url: `${config.evolution.webhookBase}/api/whatsapp/webhooks/evolution/${inst.instance_key}`, byEvents: false, base64: true, events: EVENTS })

// Ignora grupos y pide a WhatsApp el historial completo al vincular (para poder importarlo)
const INSTANCE_SETTINGS = { rejectCall: false, msgCall: '', groupsIgnore: true, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: true }

export async function ensureSettings(inst) {
  return api(`/settings/set/${inst.instance_key}`, { method: 'POST', body: INSTANCE_SETTINGS })
}

/** Texto, tipo y nombre de archivo de un mensaje de Baileys/Evolution */
export function describeEvolutionMessage(m) {
  const msg = m.message || {}
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessageV2?.message || msg.documentWithCaptionMessage?.message || msg
  const body = inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption || inner.videoMessage?.caption || inner.documentMessage?.caption || ''
  const type = inner.imageMessage || inner.stickerMessage ? 'image' : inner.audioMessage ? 'audio' : inner.videoMessage ? 'video' : inner.documentMessage ? 'document' : 'text'
  const label = { image: '[imagen]', audio: '[audio]', video: '[video]', document: `[documento${inner.documentMessage?.fileName ? `: ${inner.documentMessage.fileName}` : ''}]` }[type]
  return { body: body || label || (inner.locationMessage ? '[ubicación]' : inner.contactMessage ? '[contacto]' : ''), type, ad: inner.extendedTextMessage?.contextInfo?.externalAdReply || null }
}

/** Número de teléfono real de un mensaje (WhatsApp ahora usa identificadores @lid; el teléfono viene en remoteJidAlt) */
export function phoneFromKey(key = {}) {
  for (const j of [key.remoteJid, key.remoteJidAlt, key.senderPn]) if (j && j.endsWith('@s.whatsapp.net')) return j.split('@')[0]
  return null
}

/** Recorre todos los mensajes guardados por Evolution para un número (más recientes primero) */
export async function* evolutionMessages(inst, { pageSize = 250, maxMessages = 30000 } = {}) {
  let page = 1, seen = 0
  while (seen < maxMessages) {
    const r = await api(`/chat/findMessages/${inst.instance_key}`, { method: 'POST', body: { where: {}, offset: pageSize, page } })
    const recs = r?.messages?.records || []
    for (const m of recs) { seen++; yield m }
    if (!recs.length || page >= (r?.messages?.pages || 0)) break
    page++
  }
}

/** Activa (o repara) el webhook de un número en Evolution */
export async function ensureWebhook(inst) {
  return api(`/webhook/set/${inst.instance_key}`, { method: 'POST', body: { webhook: webhookConfig(inst) } })
}

/**
 * Respaldo del webhook: consulta a Evolution el estado real del número y lo sincroniza en el CRM.
 * Devuelve true si cambió algo.
 */
/** Borra de Evolution las instancias creadas por el CRM que ya no existen en la base de datos */
export async function cleanOrphanInstances(knownKeys) {
  const list = await api('/instance/fetchInstances')
  for (const i of Array.isArray(list) ? list : []) {
    const name = i.name || i.instance?.instanceName
    if (name && name.startsWith('evolution-') && !knownKeys.includes(name)) {
      try { await api(`/instance/delete/${name}`, { method: 'DELETE' }); console.log('Instancia huérfana eliminada de Evolution:', name) } catch (e) { console.warn('huérfana', name, e.message) }
    }
  }
}

export async function syncEvolutionStatus(inst) {
  let state
  try { state = (await api(`/instance/connectionState/${inst.instance_key}`))?.instance?.state } catch { return false }
  if (state === 'open' && inst.status !== 'connected') {
    let phone = inst.phone
    try {
      const list = await api(`/instance/fetchInstances?instanceName=${inst.instance_key}`)
      const jid = (Array.isArray(list) ? list[0] : list)?.ownerJid || ''
      if (jid) phone = `+${jid.split('@')[0]}`
    } catch {}
    await updateInstance(inst.id, { status: 'connected', qr_code: null, connected_at: now(), phone })
    return true
  }
  if (state === 'close' && inst.status === 'connected') { await updateInstance(inst.id, { status: 'disconnected', qr_code: null }); return true }
  return false
}

async function updateInstance(id, patch) {
  await db('whatsapp_instances').where({ id }).update(patch)
  const inst = await db('whatsapp_instances').where({ id }).first()
  emitCompany(inst.company_id, 'instance:update', publicInstance(inst))
  return inst
}

/** Diagnóstico: versión de Evolution y estado detallado de todas sus instancias */
export async function evolutionDiag() {
  const out = {}
  try { out.server = await api('/') } catch (e) { out.server_error = e.message }
  out.webhooks = {}
  for (const i of await db('whatsapp_instances').where({ provider: 'evolution' })) {
    try { const w = await api(`/webhook/find/${i.instance_key}`); out.webhooks[i.instance_key] = { enabled: w?.enabled, url: w?.url, events: w?.events } } catch (e) { out.webhooks[i.instance_key] = e.message }
  }
  try {
    const list = await api('/instance/fetchInstances')
    out.instances = (Array.isArray(list) ? list : []).map((i) => ({
      name: i.name || i.instance?.instanceName, status: i.connectionStatus || i.instance?.status, number: i.number || i.ownerJid,
      disconnectionReasonCode: i.disconnectionReasonCode, disconnectionAt: i.disconnectionAt,
      disconnectionObject: typeof i.disconnectionObject === 'string' ? i.disconnectionObject.slice(0, 600) : i.disconnectionObject,
      updatedAt: i.updatedAt,
    }))
  } catch (e) { out.instances_error = e.message }
  return out
}

export const evolutionProvider = {
  name: 'evolution',

  async createInstance(inst) {
    await api('/instance/create', {
      method: 'POST',
      body: {
        instanceName: inst.instance_key,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: false,
        webhook: webhookConfig(inst),
        ...INSTANCE_SETTINGS,
      },
    })
    return inst
  },

  async connect(inst) {
    try { await ensureWebhook(inst) } catch (e) { console.warn('webhook/set:', e.message) }
    try { await ensureSettings(inst) } catch (e) { console.warn('settings/set:', e.message) }
    const data = await api(`/instance/connect/${inst.instance_key}`)
    const qr = data?.base64 || null
    await updateInstance(inst.id, { status: qr ? 'qr' : 'connecting', qr_code: qr })
    return { qr }
  },

  async disconnect(inst) {
    try { await api(`/instance/logout/${inst.instance_key}`, { method: 'DELETE' }) } catch (e) { console.warn(e.message) }
    await updateInstance(inst.id, { status: 'disconnected', qr_code: null, connected_at: null })
  },

  /** Elimina el número de Evolution (cierra sesión y borra la instancia) */
  async remove(inst) {
    try { await api(`/instance/logout/${inst.instance_key}`, { method: 'DELETE' }) } catch {}
    try { await api(`/instance/delete/${inst.instance_key}`, { method: 'DELETE' }) } catch (e) { console.warn('delete instance:', e.message) }
  },

  async status(inst) {
    const data = await api(`/instance/connectionState/${inst.instance_key}`)
    return data?.instance?.state === 'open' ? 'connected' : 'disconnected'
  },

  /** Envía imagen, documento, video o audio. media = { base64, mime, name, type, caption } */
  async sendMedia(inst, phone, media) {
    const number = phone.replace(/\D/g, '')
    if (media.type === 'audio') {
      const data = await api(`/message/sendWhatsAppAudio/${inst.instance_key}`, { method: 'POST', body: { number, audio: media.base64 } })
      return { id: data?.key?.id || null }
    }
    const data = await api(`/message/sendMedia/${inst.instance_key}`, {
      method: 'POST',
      body: { number, mediatype: media.type === 'image' ? 'image' : media.type === 'video' ? 'video' : 'document', mimetype: media.mime, caption: media.caption || '', media: media.base64, fileName: media.name },
    })
    return { id: data?.key?.id || null }
  },

  /** Descarga el contenido de un mensaje multimedia (base64) */
  async fetchMediaBase64(inst, waMessageId) {
    const data = await api(`/chat/getBase64FromMediaMessage/${inst.instance_key}`, { method: 'POST', body: { message: { key: { id: waMessageId } }, convertToMp4: false } })
    return data?.base64 ? { base64: data.base64, mime: data.mimetype || data.mimeType || '' } : null
  },

  async sendText(inst, phone, body) {
    const data = await api(`/message/sendText/${inst.instance_key}`, {
      method: 'POST',
      body: { number: phone.replace(/\D/g, ''), text: body },
    })
    return { id: data?.key?.id || null }
  },

  /** Traduce un webhook de Evolution a eventos internos */
  async handleWebhook(inst, payload) {
    const event = (payload.event || '').toUpperCase().replace('.', '_')
    const data = payload.data || {}
    if (event === 'QRCODE_UPDATED') {
      const qr = data?.qrcode?.base64 || data?.base64 || null
      if (qr) await updateInstance(inst.id, { status: 'qr', qr_code: qr })
      return null
    }
    if (event === 'CONNECTION_UPDATE') {
      const state = data?.state || data?.status
      if (state === 'open') await updateInstance(inst.id, { status: 'connected', qr_code: null, connected_at: now(), phone: data?.wuid?.split('@')[0] ? `+${data.wuid.split('@')[0]}` : inst.phone })
      else if (state === 'close') await updateInstance(inst.id, { status: 'disconnected', qr_code: null })
      else await updateInstance(inst.id, { status: 'connecting' })
      return null
    }
    if (event === 'MESSAGES_UPSERT') {
      const items = Array.isArray(data) ? data : [data]
      return items.filter((m) => m?.key && !m.key.fromMe && !m.key.remoteJid?.endsWith('@g.us')).map((m) => {
        const msg = m.message || {}
        const desc = describeEvolutionMessage(m)
        // En medios el texto es el pie de foto (vacío si no hay); la etiqueta [imagen] solo se usa en el historial importado
        const body = desc.type === 'text' ? desc.body : (msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || '')
        const mediaMsg = msg.imageMessage || msg.audioMessage || msg.documentMessage || msg.videoMessage || msg.stickerMessage || null
        const type = msg.imageMessage ? 'image' : msg.audioMessage ? 'audio' : msg.documentMessage ? 'document' : msg.videoMessage ? 'video' : msg.stickerMessage ? 'image' : 'text'
        // Anuncios "clic a WhatsApp" de Meta llegan con contextInfo.externalAdReply
        const ad = msg.extendedTextMessage?.contextInfo?.externalAdReply
        return {
          phone: phoneFromKey(m.key) || m.key.remoteJid.split('@')[0],
          name: m.pushName || null,
          body: body || '',
          type,
          waMessageId: m.key.id,
          adReferral: ad ? { source: 'meta_ads', campaign: ad.title || ad.sourceId || 'Meta CTWA' } : null,
          media: mediaMsg ? { base64: m.message?.base64 || m.base64 || null, mime: mediaMsg.mimetype || '', name: mediaMsg.fileName || null } : null,
        }
      })
    }
    return null
  },
}
