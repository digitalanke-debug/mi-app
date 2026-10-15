/**
 * Cliente mínimo de Evolution API (la pasarela de WhatsApp que ya corre en el servidor).
 * Rutas verificadas contra el código fuente de Evolution API v2:
 *   POST /instance/create, GET /instance/connect/:i, GET /instance/connectionState/:i,
 *   POST /webhook/set/:i, POST /message/sendText/:i, POST /chat/getBase64FromMediaMessage/:i
 * Autenticación: cabecera "apikey".
 */
export function evolutionConfig() {
  const url = (process.env.EVOLUTION_URL || '').replace(/\/$/, '')
  const apiKey = process.env.EVOLUTION_API_KEY || ''
  const instance = process.env.EVOLUTION_INSTANCE || 'sygo-admin'
  return { url, apiKey, instance, configured: !!(url && apiKey) }
}

async function call(method, path, body) {
  const { url, apiKey } = evolutionConfig()
  const res = await fetch(url + path, {
    method,
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) {
    const err = new Error(`Evolution ${method} ${path} → ${res.status}: ${typeof data === 'object' ? JSON.stringify(data).slice(0, 300) : text.slice(0, 300)}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export const evolution = {
  async connectionState() {
    const { instance } = evolutionConfig()
    const r = await call('GET', `/instance/connectionState/${instance}`)
    return r?.instance?.state || r?.state || 'desconocido'
  },
  async createInstance(webhookUrl) {
    const { instance } = evolutionConfig()
    return call('POST', '/instance/create', {
      instanceName: instance,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: true, events: ['MESSAGES_UPSERT'] },
    })
  },
  async setWebhook(webhookUrl) {
    const { instance } = evolutionConfig()
    return call('POST', `/webhook/set/${instance}`, {
      webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: true, events: ['MESSAGES_UPSERT'] },
    })
  },
  async connect() {
    const { instance } = evolutionConfig()
    return call('GET', `/instance/connect/${instance}`)
  },
  async sendText(number, text) {
    const { instance } = evolutionConfig()
    return call('POST', `/message/sendText/${instance}`, { number, text })
  },
  async getMediaBase64(key) {
    const { instance } = evolutionConfig()
    return call('POST', `/chat/getBase64FromMediaMessage/${instance}`, { message: { key }, convertToMp4: false })
  },
}
