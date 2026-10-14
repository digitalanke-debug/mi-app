import { db } from '../db/knex.js'
import { evolutionContacts } from './whatsapp/evolutionProvider.js'

const isPlaceholder = (c) => !c.name || c.name === 'Contacto de WhatsApp' || c.name === c.phone || c.name === `+${c.phone}`
const cleanName = (n, digits) => {
  const s = String(n || '').trim()
  return s && s.replace(/\D/g, '') !== digits && s !== 'Você' ? s.slice(0, 120) : null
}

/**
 * Trae al CRM los contactos del WhatsApp conectado por QR, con el nombre guardado en el celular.
 * No crea conversaciones ni envía mensajes. A los contactos que ya existían solo les completa el nombre si no lo tenían.
 */
export async function syncWhatsappContacts(inst) {
  const list = await evolutionContacts(inst)
  const own = String(inst.phone || '').replace(/\D/g, '')
  const existing = await db('contacts').where({ company_id: inst.company_id }).select('id', 'phone', 'name', 'wa_jid', 'wa_lid')
  const byPhone = new Map(existing.map((c) => [c.phone, c]))
  const byLid = new Map(existing.flatMap((c) => [c.wa_lid, c.wa_jid].filter((j) => j?.endsWith('@lid')).map((j) => [j, c])))
  let created = 0, named = 0, skipped = 0
  const toInsert = []
  for (const ct of list) {
    const jid = ct.remoteJid || ct.id || ''
    const digits = jid.split('@')[0]
    const name = cleanName(ct.pushName || ct.name, digits)
    if (jid.endsWith('@lid')) {
      // Sin número: solo sirve para poner nombre a un contacto que ya está en el CRM
      const c = byLid.get(jid)
      if (c && name && isPlaceholder(c)) { await db('contacts').where({ id: c.id }).update({ name }); c.name = name; named++ } else skipped++
      continue
    }
    if (!jid.endsWith('@s.whatsapp.net') || digits.length < 8 || digits.length > 15 || digits === own) { skipped++; continue }
    const c = byPhone.get(digits)
    if (c) {
      if (name && isPlaceholder(c)) { await db('contacts').where({ id: c.id }).update({ name }); c.name = name; named++ }
      continue
    }
    const row = { company_id: inst.company_id, phone: digits, wa_jid: jid, name: name || `+${digits}`, source: 'organico' }
    toInsert.push(row); byPhone.set(digits, row); created++
  }
  for (let i = 0; i < toInsert.length; i += 200) await db('contacts').insert(toInsert.slice(i, i + 200))
  return { total: list.length, created, named, skipped }
}
