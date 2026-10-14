import { db, now } from '../db/knex.js'
import { emitCompany } from './realtime.js'
import { sendOutbound, logActivity } from './conversations.js'

/**
 * Normaliza un teléfono escrito a mano. Colombia: 10 dígitos que empiezan por 3 -> se antepone 57.
 */
export function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 && d.startsWith('3')) d = `57${d}`
  return d.length >= 11 && d.length <= 15 ? d : null
}

/** Lee una lista pegada: una línea por contacto, "número" o "nombre, número" o "número, nombre" (también ; o tabulador) */
export function parsePastedList(text) {
  const out = [], invalid = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const l = line.trim(); if (!l) continue
    const parts = l.split(/[;,\t]/).map((x) => x.trim()).filter(Boolean)
    const phonePart = parts.find((p) => (p.match(/\d/g) || []).length >= 10)
    const phone = normalizePhone(phonePart)
    if (!phone) { invalid.push(l); continue }
    const name = parts.filter((p) => p !== phonePart).join(' ').trim() || null
    out.push({ phone, name })
  }
  const seen = new Set()
  return { rows: out.filter((r) => (seen.has(r.phone) ? false : seen.add(r.phone))), invalid }
}

/** Resuelve los contactos destinatarios según el criterio. No crea nada (salvo createMissing en listas pegadas). */
export async function resolveRecipients(companyId, { mode, tag_id, stage_id, numbers, createMissing = false }) {
  if (mode === 'paste') {
    const { rows, invalid } = parsePastedList(numbers)
    const ids = []
    let created = 0
    for (const r of rows) {
      let c = await db('contacts').where({ company_id: companyId, phone: r.phone }).first()
      if (!c && createMissing) {
        const [row] = await db('contacts').insert({ company_id: companyId, phone: r.phone, name: r.name || `+${r.phone}`, source: 'organico', notes: 'Agregado desde una lista de difusión' }).returning('id')
        c = { id: row.id ?? row }; created++
      } else if (c && r.name && (c.name === c.phone || c.name === `+${c.phone}` || c.name === 'Contacto de WhatsApp') && createMissing) {
        await db('contacts').where({ id: c.id }).update({ name: r.name })
      }
      ids.push(c ? c.id : `nuevo:${r.phone}`)
    }
    return { ids, invalid, created, total: ids.length }
  }
  let q = db('contacts as ct').where('ct.company_id', companyId)
  if (mode === 'tag') q = q.whereIn('ct.id', db('conversations as c').join('conversation_tags as ctg', 'ctg.conversation_id', 'c.id').where('ctg.tag_id', Number(tag_id)).select('c.contact_id'))
  if (mode === 'stage') q = q.whereIn('ct.id', db('conversations').where({ company_id: companyId, stage_id: Number(stage_id) }).select('contact_id'))
  const ids = (await q.distinct('ct.id')).map((r) => r.id)
  return { ids, invalid: [], created: 0, total: ids.length }
}

const rand = (a, b) => Math.round(a + Math.random() * Math.max(0, b - a))
const firstName = (n) => (n && !/^\+?\d+$/.test(n) && n !== 'Contacto de WhatsApp' ? n.split(' ')[0] : '')

/** Personaliza el texto: {{nombre}} -> primer nombre del contacto (o vacío), {{empresa}} -> empresa */
export function personalize(body, contact, company) {
  const nombre = firstName(contact.name)
  return String(body || '')
    .replace(/{{\s*nombre\s*}}/gi, nombre)
    .replace(/{{\s*empresa\s*}}/gi, company?.name || '')
    .replace(/[ \t]+([,.!?])/g, '$1').replace(/¡\s+/g, '¡').replace(/[ \t]{2,}/g, ' ')
}

export async function broadcastSummary(id) {
  const b = await db('broadcasts as b').leftJoin('whatsapp_instances as w', 'w.id', 'b.instance_id').leftJoin('users as u', 'u.id', 'b.created_by')
    .where('b.id', id).select('b.*', 'w.name as instance_name', 'w.status as instance_status', 'u.name as created_by_name').first()
  if (!b) return null
  const counts = await db('broadcast_recipients').where({ broadcast_id: id }).groupBy('status').select('status').count('id as n')
  const c = Object.fromEntries(counts.map((x) => [x.status, Number(x.n)]))
  return { ...b, pending: c.pending || 0, sent: c.sent || 0, failed: c.failed || 0, total: (c.pending || 0) + (c.sent || 0) + (c.failed || 0) }
}

async function emitBroadcast(id) {
  const b = await broadcastSummary(id)
  if (b) emitCompany(b.company_id, 'broadcast:update', b)
  return b
}

/** Envía al siguiente destinatario pendiente de una difusión */
async function sendNext(b) {
  const inst = b.instance_id ? await db('whatsapp_instances').where({ id: b.instance_id }).first() : null
  if (!inst || inst.status !== 'connected') {
    await db('broadcasts').where({ id: b.id }).update({ status: 'paused', last_error: 'El número de WhatsApp no está conectado. Conéctalo y reanuda la difusión.' })
    return emitBroadcast(b.id)
  }
  const r = await db('broadcast_recipients').where({ broadcast_id: b.id, status: 'pending' }).orderBy('id').first()
  if (!r) {
    await db('broadcasts').where({ id: b.id }).update({ status: 'done', finished_at: now(), next_at: null })
    return emitBroadcast(b.id)
  }
  const contact = await db('contacts').where({ id: r.contact_id }).first()
  const company = await db('companies').where({ id: b.company_id }).first()
  try {
    // Usa la conversación del contacto en ese número, o crea una (sin disparar bienvenidas)
    let conv = await db('conversations').where({ company_id: b.company_id, contact_id: contact.id }).orderBy('id', 'desc').first()
    if (!conv) {
      const pipeline = await db('pipelines').where({ company_id: b.company_id }).orderBy('is_default', 'desc').first()
      const stage = pipeline ? await db('pipeline_stages').where({ pipeline_id: pipeline.id }).orderBy('position').first() : null
      const ts = now()
      const [row] = await db('conversations').insert({ company_id: b.company_id, instance_id: inst.id, contact_id: contact.id, pipeline_id: pipeline?.id || null, stage_id: stage?.id || null,
        status: 'pending', opened_at: ts, stage_entered_at: ts, last_message_at: ts, unread_count: 0, ai_enabled: false, assigned_user_id: b.created_by }).returning('id')
      conv = await db('conversations').where({ id: row.id ?? row }).first()
    } else if (conv.instance_id !== inst.id) {
      await db('conversations').where({ id: conv.id }).update({ instance_id: inst.id })
    }
    const saved = b.media_url ? { url: b.media_url, name: b.media_name, mime: b.media_mime, size: b.media_size, type: b.media_type } : null
    const msg = await sendOutbound(conv.id, { body: personalize(b.body, contact, company), senderType: 'user', userId: b.created_by, savedMedia: saved })
    const ok = msg.status !== 'failed'
    await db('broadcast_recipients').where({ id: r.id }).update({ status: ok ? 'sent' : 'failed', error: ok ? null : (msg.error || 'Error de envío'), message_id: msg.id, sent_at: now() })
    await logActivity(b.company_id, conv.id, 'broadcast.sent', { broadcast: b.name, ok }, b.created_by)
  } catch (e) {
    await db('broadcast_recipients').where({ id: r.id }).update({ status: 'failed', error: e.message.slice(0, 250), sent_at: now() })
  }
  await db('broadcasts').where({ id: b.id }).update({ next_at: new Date(Date.now() + rand(b.delay_min, b.delay_max) * 1000).toISOString() })
  return emitBroadcast(b.id)
}

let running = false
/** Se ejecuta cada pocos segundos: avanza las difusiones en curso respetando la pausa entre mensajes */
export async function broadcastTick() {
  if (running) return
  running = true
  try {
    const active = await db('broadcasts').where({ status: 'sending' })
    for (const b of active) {
      if (b.next_at && new Date(b.next_at).getTime() > Date.now()) continue
      await sendNext(b)
    }
  } catch (e) { console.error('Difusiones:', e.message) } finally { running = false }
}

export { emitBroadcast }
