import { Router } from 'express'
import { db, now } from '../db/knex.js'
import { requireCompany } from '../auth.js'
import { loadConversation, sendOutbound, broadcastConversation, logActivity } from '../services/conversations.js'
import { aiRespond } from '../services/automations.js'
import { emitCompany } from '../services/realtime.js'

export const conversationsRouter = Router()

async function canAccess(req, res, next) {
  const conv = await db('conversations').where({ id: req.params.id }).first()
  if (!conv) return res.status(404).json({ error: 'Conversación no existe' })
  if (req.user.role !== 'admin') {
    const m = await db('company_users').where({ company_id: conv.company_id, user_id: req.user.id }).first()
    if (!m) return res.status(403).json({ error: 'Sin acceso' })
  }
  req.conv = conv
  next()
}

// Lista de la bandeja
conversationsRouter.get('/', requireCompany, async (req, res) => {
  const { status = 'open', assigned, tag, stage, q, mine, limit = 200 } = req.query
  let query = db('conversations as c').where('c.company_id', req.companyId)
  if (status !== 'all') query = query.where('c.status', status)
  if (mine === '1') query = query.where('c.assigned_user_id', req.user.id)
  if (assigned === 'none') query = query.whereNull('c.assigned_user_id')
  else if (assigned) query = query.where('c.assigned_user_id', Number(assigned))
  if (stage) query = query.where('c.stage_id', Number(stage))
  if (tag) query = query.whereIn('c.id', db('conversation_tags').where('tag_id', Number(tag)).select('conversation_id'))
  if (q) query = query.whereIn('c.contact_id', db('contacts').where('company_id', req.companyId).where((b) => b.whereLike('name', `%${q}%`).orWhereLike('phone', `%${q}%`)).select('id'))
  const rows = await query.orderBy('c.last_message_at', 'desc').limit(Number(limit)).select('c.id')
  const out = []
  for (const r of rows) out.push(await loadConversation(r.id))
  res.json(out)
})

conversationsRouter.get('/:id', canAccess, async (req, res) => {
  const conv = await loadConversation(req.conv.id)
  const contact = await db('contacts').where({ id: conv.contact_id }).first()
  const messages = await db('messages as m').leftJoin('users as u', 'u.id', 'm.sender_user_id').where('m.conversation_id', conv.id)
    .orderBy('m.created_at', 'asc').select('m.*', 'u.name as sender_name')
  const notes = await db('notes as n').leftJoin('users as u', 'u.id', 'n.user_id').where('n.conversation_id', conv.id).orderBy('n.created_at', 'desc').select('n.*', 'u.name as user_name')
  const tasks = await db('tasks').where({ conversation_id: conv.id }).orderBy('due_at')
  const activity = await db('activity_log as a').leftJoin('users as u', 'u.id', 'a.user_id').where('a.conversation_id', conv.id).orderBy('a.created_at', 'desc').limit(50).select('a.*', 'u.name as user_name')
  res.json({ conversation: conv, contact, messages, notes, tasks, activity })
})

conversationsRouter.post('/:id/messages', canAccess, async (req, res) => {
  const { body } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'Mensaje vacío' })
  const conv = req.conv
  if (!conv.assigned_user_id) await db('conversations').where({ id: conv.id }).update({ assigned_user_id: req.user.id })
  const msg = await sendOutbound(conv.id, { body: body.trim(), senderType: 'user', userId: req.user.id })
  res.json(msg)
})

conversationsRouter.post('/:id/read', canAccess, async (req, res) => {
  await db('conversations').where({ id: req.conv.id }).update({ unread_count: 0 })
  await broadcastConversation(req.conv.id)
  res.json({ ok: true })
})

conversationsRouter.patch('/:id', canAccess, async (req, res) => {
  const { assigned_user_id, stage_id, status, service, value, ai_enabled } = req.body
  const patch = {}
  const conv = req.conv
  if (assigned_user_id !== undefined) { patch.assigned_user_id = assigned_user_id || null; await logActivity(conv.company_id, conv.id, 'assigned', { to: assigned_user_id }, req.user.id) }
  if (stage_id !== undefined && stage_id !== conv.stage_id) {
    patch.stage_id = stage_id; patch.stage_entered_at = now()
    const st = await db('pipeline_stages').where({ id: stage_id }).first()
    if (st?.is_won || st?.is_lost) { patch.status = 'closed'; patch.closed_at = now() }
    await logActivity(conv.company_id, conv.id, 'stage_changed', { to: st?.name }, req.user.id)
  }
  if (status !== undefined) { patch.status = status; patch.closed_at = status === 'closed' ? now() : null; await logActivity(conv.company_id, conv.id, `status.${status}`, {}, req.user.id) }
  if (service !== undefined) patch.service = service
  if (value !== undefined) patch.value = Number(value) || 0
  if (ai_enabled !== undefined) patch.ai_enabled = !!ai_enabled
  if (Object.keys(patch).length) await db('conversations').where({ id: conv.id }).update(patch)
  res.json(await broadcastConversation(conv.id))
})

conversationsRouter.post('/:id/tags/:tagId', canAccess, async (req, res) => {
  await db('conversation_tags').insert({ conversation_id: req.conv.id, tag_id: Number(req.params.tagId) }).onConflict().ignore()
  res.json(await broadcastConversation(req.conv.id))
})
conversationsRouter.delete('/:id/tags/:tagId', canAccess, async (req, res) => {
  await db('conversation_tags').where({ conversation_id: req.conv.id, tag_id: Number(req.params.tagId) }).del()
  res.json(await broadcastConversation(req.conv.id))
})

conversationsRouter.post('/:id/notes', canAccess, async (req, res) => {
  const [row] = await db('notes').insert({ conversation_id: req.conv.id, user_id: req.user.id, body: req.body.body }).returning('id')
  res.json(await db('notes').where({ id: row.id ?? row }).first())
})

conversationsRouter.post('/:id/tasks', canAccess, async (req, res) => {
  const [row] = await db('tasks').insert({ company_id: req.conv.company_id, conversation_id: req.conv.id, user_id: req.body.user_id || req.user.id, title: req.body.title, due_at: req.body.due_at || null }).returning('id')
  res.json(await db('tasks').where({ id: row.id ?? row }).first())
})
conversationsRouter.patch('/tasks/:taskId', async (req, res) => {
  await db('tasks').where({ id: req.params.taskId }).update({ done: !!req.body.done })
  res.json({ ok: true })
})

// Pedir al agente IA que sugiera/envíe una respuesta ahora
conversationsRouter.post('/:id/ai-reply', canAccess, async (req, res) => {
  await db('conversations').where({ id: req.conv.id }).update({ ai_enabled: true })
  const r = await aiRespond(req.conv.id, { conditions: { ai_only_when_no_human_reply_minutes: 0 } })
  res.json(r || { text: null, skipped: true })
})

conversationsRouter.post('/:id/typing', canAccess, (req, res) => {
  emitCompany(req.conv.company_id, 'typing', { conversationId: req.conv.id, user: req.user.name })
  res.json({ ok: true })
})
