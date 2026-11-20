import { db, now } from '../db/knex.js'
import { evolutionMessages } from './whatsapp/evolutionProvider.js'
import { adFromEvolution, recordAdReferral } from './adReferrals.js'

/**
 * Recupera de qué anuncio llegaron los chats que ya están en el CRM.
 * Evolution guarda el mensaje original con los datos del anuncio; aquí se cruzan con los mensajes del CRM.
 * Se ejecuta una sola vez por número (queda anotado en `integrations`), salvo que se pida con force.
 */
export async function backfillAdReferrals(inst, { force = false } = {}) {
  const marker = `ad_backfill:${inst.id}`
  const done = await db('integrations').where({ company_id: inst.company_id, provider: marker }).first()
  if (done && !force) return { skipped: true }
  let scanned = 0, withAd = 0, recorded = 0
  for await (const m of evolutionMessages(inst)) {
    scanned++
    if (!m?.key?.id || m.key.fromMe) continue
    const ad = adFromEvolution(m)
    if (!ad) continue
    withAd++
    const msg = await db('messages as m').join('conversations as c', 'c.id', 'm.conversation_id')
      .where({ 'c.company_id': inst.company_id, 'm.wa_message_id': m.key.id }).select('m.id', 'm.created_at', 'c.id as conversation_id', 'c.contact_id').first()
    if (!msg) continue
    const before = await db('ad_referrals').where({ company_id: inst.company_id, wa_message_id: m.key.id }).first()
    await recordAdReferral({ companyId: inst.company_id, contactId: msg.contact_id, conversationId: msg.conversation_id, messageId: msg.id, waMessageId: m.key.id, ad, createdAt: msg.created_at })
    if (!before) recorded++
  }
  if (!scanned) return { scanned, withAd, recorded } // Evolution aún no tiene mensajes de este número: se reintenta en el próximo arranque
  const data = { status: 'done', last_sync_at: now(), config: JSON.stringify({ scanned, withAd, recorded }) }
  if (done) await db('integrations').where({ id: done.id }).update(data)
  else await db('integrations').insert({ company_id: inst.company_id, provider: marker, ...data })
  return { scanned, withAd, recorded }
}
