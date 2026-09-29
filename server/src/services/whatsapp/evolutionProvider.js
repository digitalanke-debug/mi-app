import { config } from '../../config.js'
import { db, now } from '../../db/knex.js'
import { emitCompany } from '../realtime.js'

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

async function updateInstance(id, patch) {
  await db('whatsapp_instances').where({ id }).update(patch)
  const inst = await db('whatsapp_instances').where({ id }).first()
  emitCompany(inst.company_id, 'instance:update', inst)
  return inst
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
        webhook: {
          url: `${config.evolution.webhookBase}/api/webhooks/evolution/${inst.instance_key}`,
          byEvents: false,
          base64: true,
          events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE'],
        },
      },
    })
    return inst
  },

  async connect(inst) {
    const data = await api(`/instance/connect/${inst.instance_key}`)
    const qr = data?.base64 || null
    await updateInstance(inst.id, { status: qr ? 'qr' : 'connecting', qr_code: qr })
    return { qr }
  },

  async disconnect(inst) {
    try { await api(`/instance/logout/${inst.instance_key}`, { method: 'DELETE' }) } catch (e) { console.warn(e.message) }
    await updateInstance(inst.id, { status: 'disconnected', qr_code: null, connected_at: null })
  },

  async status(inst) {
    const data = await api(`/instance/connectionState/${inst.instance_key}`)
    return data?.instance?.state === 'open' ? 'connected' : 'disconnected'
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
        const body = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.documentMessage?.caption || ''
        const type = msg.imageMessage ? 'image' : msg.audioMessage ? 'audio' : msg.documentMessage ? 'document' : 'text'
        // Anuncios "clic a WhatsApp" de Meta llegan con contextInfo.externalAdReply
        const ad = msg.extendedTextMessage?.contextInfo?.externalAdReply
        return {
          phone: m.key.remoteJid.split('@')[0],
          name: m.pushName || null,
          body: body || (type !== 'text' ? `[${type}]` : ''),
          type,
          waMessageId: m.key.id,
          adReferral: ad ? { source: 'meta_ads', campaign: ad.title || ad.sourceId || 'Meta CTWA' } : null,
        }
      })
    }
    return null
  },
}
