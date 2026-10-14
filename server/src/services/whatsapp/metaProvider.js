import crypto from 'node:crypto'
import { config } from '../../config.js'
import { db, now } from '../../db/knex.js'
import { emitCompany } from '../realtime.js'
import { readMediaBase64 } from '../media.js'
import { publicInstance } from './public.js'

/**
 * Proveedor API OFICIAL de WhatsApp (Meta Cloud API).
 * Cada instancia guarda en `config` (JSON): phone_number_id, waba_id, access_token, app_secret (opcional).
 * Meta envía todos los eventos a un solo webhook: /api/whatsapp/webhooks/meta
 */
export const cfgOf = (inst) => { try { return JSON.parse(inst.config || '{}') } catch { return {} } }
const graph = (path) => `${config.meta.graphBase}/${config.meta.version}/${path}`

async function call(inst, path, { method = 'GET', body, form } = {}) {
  const c = cfgOf(inst)
  if (!c.access_token) throw new Error('Falta el token de acceso de Meta')
  const res = await fetch(graph(path), {
    method,
    headers: { Authorization: `Bearer ${c.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    const e = data.error || {}
    const err = new Error(`Meta ${e.code || res.status}: ${e.error_user_msg || e.message || 'error desconocido'}`)
    err.code = e.code
    throw err
  }
  return data
}

async function updateInstance(id, patch) {
  await db('whatsapp_instances').where({ id }).update(patch)
  const inst = await db('whatsapp_instances').where({ id }).first()
  emitCompany(inst.company_id, 'instance:update', publicInstance(inst))
  return inst
}

/** Token con el que Meta verifica el webhook. Fijo por instalación. */
export function webhookVerifyToken() {
  return config.meta.verifyToken || crypto.createHmac('sha256', config.jwtSecret).update('meta-webhook-verify').digest('hex').slice(0, 32)
}

/** Verifica la firma X-Hub-Signature-256 con el app secret */
export function validSignature(rawBody, header, appSecret) {
  if (!appSecret) return true
  if (!header || !rawBody) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(String(header))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** ¿Está abierta la ventana de 24 horas para escribir texto libre? */
export function windowOpen(lastInboundAt) {
  return !!lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() < 24 * 3600_000
}

const MEDIA_KIND = { image: 'image', video: 'video', audio: 'audio', document: 'document' }

export const metaProvider = {
  name: 'meta',

  async createInstance(inst) { return this.connect(inst) },

  /** En la API oficial no hay QR: "conectar" = verificar credenciales y suscribir la app a la cuenta */
  async connect(inst) {
    const c = cfgOf(inst)
    if (!c.phone_number_id) throw new Error('Falta el Phone Number ID')
    try {
      const info = await call(inst, `${c.phone_number_id}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`)
      if (c.waba_id) { try { await call(inst, `${c.waba_id}/subscribed_apps`, { method: 'POST' }) } catch (e) { console.warn('subscribed_apps:', e.message) } }
      const updated = await updateInstance(inst.id, { status: 'connected', connected_at: now(), qr_code: null, phone: info.display_phone_number ? `+${String(info.display_phone_number).replace(/\D/g, '')}` : inst.phone })
      return { ok: true, verified_name: info.verified_name, quality: info.quality_rating, instance: publicInstance(updated) }
    } catch (e) {
      await updateInstance(inst.id, { status: 'disconnected' })
      throw e
    }
  },

  async disconnect(inst) { await updateInstance(inst.id, { status: 'disconnected', connected_at: null }) },

  async status(inst) { return inst.status },

  async sendText(inst, phone, body) {
    const c = cfgOf(inst)
    const data = await call(inst, `${c.phone_number_id}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone.replace(/\D/g, ''), type: 'text', text: { preview_url: true, body } } })
    return { id: data.messages?.[0]?.id || null }
  },

  /** Sube el archivo a Meta y lo envía. media = { url, mime, name, type, caption } o { base64, ... } */
  async sendMedia(inst, phone, media) {
    const c = cfgOf(inst)
    const b64 = media.base64 || readMediaBase64(media.url)
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', media.mime)
    form.append('file', new Blob([Buffer.from(b64, 'base64')], { type: media.mime }), media.name || 'archivo')
    const up = await call(inst, `${c.phone_number_id}/media`, { method: 'POST', form })
    const kind = MEDIA_KIND[media.type] || 'document'
    const payload = { id: up.id }
    if (kind !== 'audio' && media.caption) payload.caption = media.caption
    if (kind === 'document') payload.filename = media.name || 'documento'
    const data = await call(inst, `${c.phone_number_id}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to: phone.replace(/\D/g, ''), type: kind, [kind]: payload } })
    return { id: data.messages?.[0]?.id || null }
  },

  /** Envía una plantilla aprobada. params = valores para {{1}}, {{2}}… del cuerpo */
  async sendTemplate(inst, phone, { name, language, params = [] }) {
    const c = cfgOf(inst)
    const template = { name, language: { code: language } }
    if (params.length) template.components = [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t) })) }]
    const data = await call(inst, `${c.phone_number_id}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to: phone.replace(/\D/g, ''), type: 'template', template } })
    return { id: data.messages?.[0]?.id || null }
  },

  /** Plantillas aprobadas de la cuenta (WABA) */
  async listTemplates(inst) {
    const c = cfgOf(inst)
    if (!c.waba_id) throw new Error('Falta el WABA ID para consultar plantillas')
    const data = await call(inst, `${c.waba_id}/message_templates?fields=name,status,language,category,components&limit=200`)
    return (data.data || []).filter((t) => t.status === 'APPROVED').map((t) => {
      const body = (t.components || []).find((x) => x.type === 'BODY')?.text || ''
      const header = (t.components || []).find((x) => x.type === 'HEADER')
      const vars = [...new Set((body.match(/{{\s*(\d+)\s*}}/g) || []).map((m) => Number(m.replace(/\D/g, ''))))].sort((a, b) => a - b)
      return { name: t.name, language: t.language, category: t.category, body, vars: vars.length, header_format: header?.format || null }
    })
  },

  /** Descarga un medio entrante: id de Meta -> URL temporal -> bytes */
  async fetchMediaById(inst, mediaId) {
    const c = cfgOf(inst)
    const meta = await call(inst, mediaId)
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${c.access_token}` } })
    if (!res.ok) throw new Error(`Descarga de medio ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    return { base64: buf.toString('base64'), mime: meta.mime_type || res.headers.get('content-type') || '' }
  },

  async fetchMediaBase64() { return null },
}

/**
 * Traduce un "change" del webhook de Meta a mensajes entrantes y estados.
 * Devuelve { inbound: [...], statuses: [...] }
 */
export async function parseMetaChange(inst, value) {
  const inbound = []
  const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]))
  for (const m of value.messages || []) {
    let body = '', type = 'text', media = null
    const kind = m.type
    if (kind === 'text') body = m.text?.body || ''
    else if (['image', 'video', 'audio', 'document', 'sticker'].includes(kind)) {
      const obj = m[kind] || {}
      type = kind === 'sticker' ? 'image' : kind
      body = obj.caption || ''
      try { const f = await metaProvider.fetchMediaById(inst, obj.id); media = { base64: f.base64, mime: obj.mime_type || f.mime, name: obj.filename || null } }
      catch (e) { console.error('Medio entrante de Meta:', e.message); body = body || `[${kind}]` }
    } else if (kind === 'button') body = m.button?.text || ''
    else if (kind === 'interactive') body = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '[respuesta interactiva]'
    else if (kind === 'location') body = `Ubicación: ${m.location?.name || ''} https://maps.google.com/?q=${m.location?.latitude},${m.location?.longitude}`
    else if (kind === 'contacts') body = `Contacto compartido: ${(m.contacts || []).map((x) => `${x.name?.formatted_name} ${x.phones?.[0]?.phone || ''}`).join(', ')}`
    else if (kind === 'reaction') continue
    else body = `[${kind || 'mensaje no soportado'}]`
    // Anuncios "clic a WhatsApp" (Meta Ads) llegan con referral
    const adReferral = m.referral ? { source: 'meta_ads', campaign: m.referral.headline || m.referral.source_id || 'Meta CTWA' } : null
    inbound.push({ phone: m.from, name: names[m.from] || null, body, type, waMessageId: m.id, adReferral, media })
  }
  const statuses = (value.statuses || []).map((s) => ({ id: s.id, status: s.status, error: s.errors?.[0] ? `${s.errors[0].code}: ${s.errors[0].title}` : null }))
  return { inbound, statuses }
}
