import { db, now } from '../db/knex.js'
import { evolutionMessages, describeEvolutionMessage, phoneFromKey, lidFromKey } from './whatsapp/evolutionProvider.js'
import { findContactByLid, setContactPhone } from './contactIdentity.js'
import { logActivity } from './conversations.js'
import { detectSource } from './inbound.js'

const tsOf = (t) => {
  const n = typeof t === 'object' && t !== null ? Number(t.low ?? t.toString()) : Number(t)
  return new Date((n > 1e12 ? n : n * 1000) || Date.now()).toISOString()
}

/**
 * Importa al CRM el historial que Evolution guardó al vincular el número.
 * Idempotente: no duplica mensajes ya importados (usa el id de WhatsApp).
 * No dispara automatizaciones ni bienvenidas.
 */
export async function importEvolutionHistory(inst, { days = 365 } = {}) {
  const since = Date.now() - days * 86400_000
  const company = await db('companies').where({ id: inst.company_id }).first()
  const pipeline = await db('pipelines').where({ company_id: company.id }).orderBy('is_default', 'desc').first()
  const firstStage = pipeline ? await db('pipeline_stages').where({ pipeline_id: pipeline.id }).orderBy('position').first() : null

  // Agrupa por teléfono
  const byPhone = new Map()
  const lidToPhone = new Map() // @lid -> teléfono, cuando algún mensaje trae ambos
  let scanned = 0, skippedNoPhone = 0, skippedOld = 0
  for await (const m of evolutionMessages(inst)) {
    scanned++
    const jid = m.key?.remoteJid || ''
    if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) continue
    const realPhone = phoneFromKey(m.key)
    const lid = lidFromKey(m.key)
    if (lid && realPhone) lidToPhone.set(lid, realPhone)
    const isLid = !realPhone && jid.endsWith('@lid')
    if (!realPhone && !isLid) { skippedNoPhone++; continue }
    const phone = realPhone || jid.split('@')[0]
    const created_at = tsOf(m.messageTimestamp)
    if (new Date(created_at).getTime() < since) { skippedOld++; continue }
    const d = describeEvolutionMessage(m)
    if (!d.body) continue
    const entry = byPhone.get(phone) || { name: null, msgs: [], jid: realPhone ? `${realPhone}@s.whatsapp.net` : jid, lid: null, hidden: !realPhone }
    if (lid) entry.lid = lid
    if (!m.key.fromMe && m.pushName && !entry.name) entry.name = m.pushName
    entry.msgs.push({ id: m.key.id, fromMe: !!m.key.fromMe, body: d.body, type: d.type, created_at, ad: d.ad })
    byPhone.set(phone, entry)
  }

  // Chats que llegaron con número oculto pero en otro mensaje WhatsApp sí reveló el teléfono: se unen
  for (const [key, e] of [...byPhone]) {
    const real = e.hidden && lidToPhone.get(e.jid)
    if (!real) continue
    const target = byPhone.get(real) || { name: null, msgs: [], jid: `${real}@s.whatsapp.net`, lid: e.jid, hidden: false }
    target.msgs.push(...e.msgs); target.name = target.name || e.name; target.lid = target.lid || e.jid
    byPhone.set(real, target); byPhone.delete(key)
  }

  let contactsCreated = 0, conversationsCreated = 0, messagesImported = 0
  const recentLimit = Date.now() - 7 * 86400_000
  for (const [phone, { name, msgs, jid, lid, hidden }] of byPhone) {
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at))
    const first = msgs[0], last = msgs[msgs.length - 1]
    let contact = await db('contacts').where({ company_id: company.id, phone }).first()
    if (!contact && lid) {
      contact = await findContactByLid(company.id, lid)
      if (contact && !hidden) contact = await setContactPhone(contact, phone, { verified: true })
    }
    if (!contact) {
      const ad = msgs.find((x) => x.ad)?.ad
      const firstIn = msgs.find((x) => !x.fromMe)
      const src = (firstIn && detectSource(firstIn.body)) || (ad ? { source: 'meta_ads', campaign: ad.title || 'Meta CTWA' } : null)
      const [row] = await db('contacts').insert({ company_id: company.id, phone, wa_jid: jid, wa_lid: lid, name: name || (jid.endsWith('@lid') ? 'Contacto de WhatsApp' : `+${phone}`), source: src?.source || 'organico', campaign: src?.campaign || null, created_at: first.created_at }).returning('id')
      contact = await db('contacts').where({ id: row.id ?? row }).first()
      contactsCreated++
    } else {
      const patch = {}
      if (!contact.wa_jid) patch.wa_jid = jid
      if (lid && !contact.wa_lid) patch.wa_lid = lid
      if (name && (!contact.name || contact.name === contact.phone || contact.name === `+${phone}` || contact.name === 'Contacto de WhatsApp')) patch.name = name
      if (Object.keys(patch).length) await db('contacts').where({ id: contact.id }).update(patch)
    }

    let conv = await db('conversations').where({ company_id: company.id, contact_id: contact.id }).orderBy('id', 'desc').first()
    if (!conv) {
      const lastIn = [...msgs].reverse().find((x) => !x.fromMe)
      const lastOut = [...msgs].reverse().find((x) => x.fromMe)
      const firstIn = msgs.find((x) => !x.fromMe)
      const firstReply = firstIn ? msgs.find((x) => x.fromMe && x.created_at >= firstIn.created_at) : null
      const open = new Date(last.created_at).getTime() >= recentLimit
      const [row] = await db('conversations').insert({
        company_id: company.id, instance_id: inst.id, contact_id: contact.id, pipeline_id: pipeline?.id || null, stage_id: firstStage?.id || null,
        status: open ? 'open' : 'closed', opened_at: first.created_at, stage_entered_at: first.created_at, closed_at: open ? null : last.created_at,
        first_response_at: firstReply?.created_at || null, last_message_at: last.created_at, last_inbound_at: lastIn?.created_at || null, last_outbound_at: lastOut?.created_at || null,
        unread_count: 0, ai_enabled: false, created_at: first.created_at,
      }).returning('id')
      conv = await db('conversations').where({ id: row.id ?? row }).first()
      conversationsCreated++
      await logActivity(company.id, conv.id, 'conversation.imported', { messages: msgs.length })
    }

    const existing = new Set((await db('messages').where({ conversation_id: conv.id }).whereNotNull('wa_message_id').select('wa_message_id')).map((r) => r.wa_message_id))
    const rows = msgs.filter((x) => x.id && !existing.has(x.id)).map((x) => ({
      conversation_id: conv.id, direction: x.fromMe ? 'out' : 'in', sender_type: x.fromMe ? 'user' : 'contact', type: x.type === 'text' ? 'text' : x.type,
      body: x.body, wa_message_id: x.id, status: x.fromMe ? 'delivered' : 'delivered', created_at: x.created_at,
    }))
    for (let i = 0; i < rows.length; i += 200) await db('messages').insert(rows.slice(i, i + 200))
    messagesImported += rows.length
    // Si la conversación ya existía, actualiza la última actividad cuando el historial es más reciente
    if (rows.length && (!conv.last_message_at || last.created_at > conv.last_message_at)) await db('conversations').where({ id: conv.id }).update({ last_message_at: last.created_at })
  }

  await db('whatsapp_instances').where({ id: inst.id }).update({ connected_at: inst.connected_at || now() })
  return { scanned, chats: byPhone.size, contactsCreated, conversationsCreated, messagesImported, skippedNoPhone, skippedOld }
}
