import { Router } from 'express'
import { db, now } from '../db/knex.js'
import { requireCompany, canAccessCompany } from '../auth.js'
import { resolveRecipients, broadcastSummary, emitBroadcast, personalize } from '../services/broadcasts.js'
import { saveMedia } from '../services/media.js'

export const broadcastsRouter = Router()

async function own(req, res, next) {
  const b = await db('broadcasts').where({ id: req.params.id }).first()
  if (!b || !(await canAccessCompany(req.user, b.company_id))) return res.status(404).json({ error: 'No existe' })
  req.broadcast = b
  next()
}

broadcastsRouter.get('/', requireCompany, async (req, res) => {
  const rows = await db('broadcasts').where({ company_id: req.companyId }).orderBy('id', 'desc').limit(100).select('id')
  res.json(await Promise.all(rows.map((r) => broadcastSummary(r.id))))
})

/** Vista previa: cuántos destinatarios y una muestra del mensaje personalizado */
broadcastsRouter.post('/preview', requireCompany, async (req, res) => {
  const r = await resolveRecipients(req.companyId, req.body)
  const realIds = r.ids.filter((x) => typeof x === 'number')
  const sample = realIds.length ? await db('contacts').whereIn('id', realIds.slice(0, 200)).select('id', 'name', 'phone', 'wa_jid') : []
  const company = await db('companies').where({ id: req.companyId }).first()
  res.json({ total: r.total, new_contacts: r.ids.length - realIds.length, invalid: r.invalid, sample: sample.slice(0, 8), example: personalize(req.body.body, sample[0] || { name: 'Ana María' }, company) })
})

/** Crea la difusión y (si start=true) empieza a enviarla */
broadcastsRouter.post('/', requireCompany, async (req, res) => {
  const { name, body, media, instance_id, delay_min = 20, delay_max = 45, start = true } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Ponle un nombre a la difusión' })
  if (!body?.trim() && !media) return res.status(400).json({ error: 'Escribe el mensaje o adjunta un archivo' })
  const inst = await db('whatsapp_instances').where({ id: Number(instance_id), company_id: req.companyId }).first()
  if (!inst) return res.status(400).json({ error: 'Elige el número de WhatsApp desde el que se enviará' })
  const { ids, invalid } = await resolveRecipients(req.companyId, { ...req.body, createMissing: true })
  if (!ids.length) return res.status(400).json({ error: 'La lista no tiene destinatarios válidos' })
  let saved = null
  if (media?.base64) { try { saved = saveMedia({ base64: media.base64, mime: media.mime, name: media.name }) } catch (e) { return res.status(400).json({ error: e.message }) } }
  const dmin = Math.max(8, Number(delay_min) || 20), dmax = Math.max(dmin, Number(delay_max) || 45)
  const [row] = await db('broadcasts').insert({
    company_id: req.companyId, instance_id: inst.id, created_by: req.user.id, name: name.trim(), body: body || '',
    media_url: saved?.url || null, media_name: saved?.name || null, media_mime: saved?.mime || null, media_size: saved?.size || null, media_type: saved?.type || null,
    status: start ? 'sending' : 'draft', delay_min: dmin, delay_max: dmax, total: ids.length, started_at: start ? now() : null, next_at: null,
  }).returning('id')
  const id = row.id ?? row
  for (let i = 0; i < ids.length; i += 300) await db('broadcast_recipients').insert(ids.slice(i, i + 300).map((cid) => ({ broadcast_id: id, contact_id: cid })))
  res.json({ ...(await emitBroadcast(id)), invalid })
})

broadcastsRouter.get('/:id', own, async (req, res) => {
  const recipients = await db('broadcast_recipients as r').join('contacts as ct', 'ct.id', 'r.contact_id').where('r.broadcast_id', req.broadcast.id)
    .leftJoin('messages as m', 'm.id', 'r.message_id').leftJoin('conversations as c', 'c.id', 'm.conversation_id')
    .orderBy('r.id').select('r.id', 'r.status', 'r.error', 'r.sent_at', 'ct.name', 'ct.phone', 'ct.wa_jid', 'm.status as delivery', 'c.id as conversation_id')
  res.json({ ...(await broadcastSummary(req.broadcast.id)), recipients })
})

const setStatus = (status, extra = {}) => async (req, res) => {
  const b = req.broadcast
  if (['done', 'cancelled'].includes(b.status)) return res.status(400).json({ error: 'La difusión ya terminó' })
  await db('broadcasts').where({ id: b.id }).update({ status, ...extra, ...(status === 'sending' ? { last_error: null, started_at: b.started_at || now() } : {}), ...(status === 'cancelled' ? { finished_at: now() } : {}) })
  res.json(await emitBroadcast(b.id))
}
broadcastsRouter.post('/:id/pause', own, setStatus('paused'))
broadcastsRouter.post('/:id/resume', own, setStatus('sending', { next_at: null }))
broadcastsRouter.post('/:id/cancel', own, setStatus('cancelled'))

/** Vuelve a poner en cola los destinatarios que fallaron */
broadcastsRouter.post('/:id/retry-failed', own, async (req, res) => {
  const n = await db('broadcast_recipients').where({ broadcast_id: req.broadcast.id, status: 'failed' }).update({ status: 'pending', error: null })
  await db('broadcasts').where({ id: req.broadcast.id }).update({ status: 'sending', finished_at: null, last_error: null, next_at: null })
  res.json({ requeued: n, ...(await emitBroadcast(req.broadcast.id)) })
})
