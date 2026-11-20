import { db } from '../db/knex.js'
import { saveMedia } from './media.js'

/**
 * Anuncios "clic a WhatsApp" de Meta: cuando alguien escribe desde un anuncio, WhatsApp adjunta al primer mensaje
 * los datos del anuncio (título, texto, imagen, enlace e identificador). Aquí se guardan por conversación.
 */

const clean = (s, n = 500) => (s == null ? null : String(s).slice(0, n))

/** Bytes que Evolution serializa como { "0": 255, "1": 216, … } o como base64 */
function bytesOf(v) {
  if (!v) return null
  if (typeof v === 'string') { try { const b = Buffer.from(v, 'base64'); return b.length > 100 ? b : null } catch { return null } }
  if (typeof v === 'object') { const vals = Array.isArray(v) ? v : v.data && Array.isArray(v.data) ? v.data : Object.values(v); return vals.length > 100 && vals.every((x) => typeof x === 'number') ? Buffer.from(vals) : null }
  return null
}

const platformOf = (app, url = '') => {
  const s = `${app || ''} ${url}`.toLowerCase()
  return s.includes('instagram') || s.includes('ig.me') ? 'instagram' : s.includes('facebook') || s.includes('fb.me') || s.includes('fb.com') ? 'facebook' : null
}

/** Datos del anuncio en un mensaje de Evolution/Baileys (o null si no llegó desde un anuncio) */
export function adFromEvolution(m) {
  const msg = m?.message || {}
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessageV2?.message || msg
  const ctx = m?.contextInfo || Object.values(inner).find((v) => v && typeof v === 'object' && v.contextInfo)?.contextInfo
  const ad = ctx?.externalAdReply
  if (!ad) return null
  // externalAdReply también se usa en vistas previas de enlaces: solo cuenta si viene marcado como anuncio
  const isAd = ad.sourceType === 'ad' || ad.sourceType === 'post' || !!ad.ctwaClid || !!ad.showAdAttribution || /ads?/i.test(String(ctx.conversionSource || '')) || /ctwa/i.test(String(ctx.entryPointConversionSource || ''))
  if (!isAd) return null
  return {
    source_type: clean(ad.sourceType || 'ad', 20), source_id: clean(ad.sourceId, 100), headline: clean(ad.title), body: clean(ad.body, 2000), source_url: clean(ad.sourceUrl, 2000),
    remote_image: ad.thumbnailUrl || ad.originalImageUrl || null, image_bytes: bytesOf(ad.thumbnail), media_type: ad.mediaType === 2 || ad.mediaType === 'VIDEO' ? 'video' : 'image',
    ctwa_clid: clean(ad.ctwaClid), platform: platformOf(ctx.entryPointConversionApp, ad.sourceUrl),
  }
}

/** Datos del anuncio en un mensaje de la API oficial (objeto referral) */
export function adFromMetaReferral(r) {
  if (!r) return null
  return { source_type: clean(r.source_type || 'ad', 20), source_id: clean(r.source_id, 100), headline: clean(r.headline), body: clean(r.body, 2000), source_url: clean(r.source_url, 2000),
    remote_image: r.image_url || r.thumbnail_url || null, image_bytes: null, media_type: r.media_type || 'image', ctwa_clid: clean(r.ctwa_clid), platform: platformOf('', r.source_url) }
}

/** Nombre corto del anuncio para listas y reportes */
export const adLabel = (ad) => ad?.headline || (ad?.source_id ? `Anuncio ${ad.source_id}` : 'Anuncio de Meta')

const META_IMAGE_HOSTS = /(^|\.)(fbcdn\.net|fbsbx\.com|facebook\.com|cdninstagram\.com|whatsapp\.net)$/i
export function isMetaImageUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && META_IMAGE_HOSTS.test(u.hostname) } catch { return false }
}

/** Guarda una copia de la imagen del anuncio: las direcciones de Meta dejan de funcionar a los pocos días */
async function keepImage(ad) {
  try {
    if (ad.image_bytes) return saveMedia({ buffer: ad.image_bytes, mime: 'image/jpeg', name: 'anuncio.jpg' }).url
    // Solo se descarga desde los servidores de imágenes de Meta (la dirección viene dentro del mensaje)
    if (ad.remote_image && isMetaImageUrl(ad.remote_image)) {
      const res = await fetch(ad.remote_image, { signal: AbortSignal.timeout(8000) })
      const mime = (res.headers.get('content-type') || '').split(';')[0]
      if (res.ok && mime.startsWith('image/')) return saveMedia({ buffer: Buffer.from(await res.arrayBuffer()), mime, name: 'anuncio' }).url
    }
  } catch (e) { console.warn('imagen del anuncio:', e.message) }
  return null
}

/**
 * Registra de qué anuncio llegó un mensaje. No duplica (mismo mensaje de WhatsApp).
 * También marca el contacto como Meta Ads si no tenía un origen pagado.
 */
export async function recordAdReferral({ companyId, contactId, conversationId, messageId = null, waMessageId = null, ad, createdAt = null }) {
  if (!ad) return null
  if (waMessageId) {
    const dup = await db('ad_referrals').where({ company_id: companyId, wa_message_id: waMessageId }).first()
    if (dup) return dup
  }
  const row = {
    company_id: companyId, contact_id: contactId, conversation_id: conversationId, message_id: messageId, wa_message_id: waMessageId,
    platform: ad.platform, source_type: ad.source_type, source_id: ad.source_id, headline: ad.headline, body: ad.body, source_url: ad.source_url,
    thumbnail_url: await keepImage(ad), media_type: ad.media_type, ctwa_clid: ad.ctwa_clid, ...(createdAt ? { created_at: createdAt } : {}),
  }
  const [r] = await db('ad_referrals').insert(row).returning('id')
  const contact = await db('contacts').where({ id: contactId }).first()
  if (contact && (contact.source === 'organico' || !contact.source)) await db('contacts').where({ id: contactId }).update({ source: 'meta_ads', campaign: adLabel(ad).slice(0, 250) })
  return db('ad_referrals').where({ id: r.id ?? r }).first()
}

/** Anuncios por conversación: { [conversation_id]: [referral, …] } (más reciente primero) */
export async function adsByConversation(conversationIds) {
  if (!conversationIds.length) return {}
  const rows = await db('ad_referrals').whereIn('conversation_id', conversationIds).orderBy('created_at', 'desc')
  const out = {}
  for (const r of rows) (out[r.conversation_id] = out[r.conversation_id] || []).push(r)
  return out
}
