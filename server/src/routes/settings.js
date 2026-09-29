import { Router } from 'express'
import { db } from '../db/knex.js'
import { requireCompany, requireAdmin } from '../auth.js'
import { aiAvailable } from '../services/ai.js'

export const settingsRouter = Router()

// Contactos
settingsRouter.get('/contacts', requireCompany, async (req, res) => {
  const { q } = req.query
  let query = db('contacts').where({ company_id: req.companyId })
  if (q) query = query.where((b) => b.whereLike('name', `%${q}%`).orWhereLike('phone', `%${q}%`))
  const contacts = await query.orderBy('created_at', 'desc').limit(500)
  const convs = await db('conversations').where({ company_id: req.companyId }).select('contact_id', 'id', 'status', 'stage_id')
  res.json(contacts.map((c) => ({ ...c, conversations: convs.filter((v) => v.contact_id === c.id) })))
})
settingsRouter.patch('/contacts/:id', async (req, res) => {
  const { name, email, document, city, source, campaign, notes } = req.body
  await db('contacts').where({ id: req.params.id }).update({ name, email, document, city, source, campaign, notes })
  res.json(await db('contacts').where({ id: req.params.id }).first())
})
settingsRouter.delete('/contacts/:id', requireAdmin, async (req, res) => {
  // Derecho de supresión (habeas data): elimina contacto, conversaciones y mensajes
  await db('contacts').where({ id: req.params.id }).del()
  res.json({ ok: true })
})

// Etiquetas
settingsRouter.get('/tags', requireCompany, async (req, res) => res.json(await db('tags').where({ company_id: req.companyId }).orderBy('name')))
settingsRouter.post('/tags', requireCompany, async (req, res) => {
  const [row] = await db('tags').insert({ company_id: req.companyId, name: req.body.name, color: req.body.color || '#64748b' }).returning('id')
  res.json(await db('tags').where({ id: row.id ?? row }).first())
})
settingsRouter.delete('/tags/:id', async (req, res) => { await db('tags').where({ id: req.params.id }).del(); res.json({ ok: true }) })

// Pipelines y etapas
settingsRouter.get('/pipelines', requireCompany, async (req, res) => {
  const pipelines = await db('pipelines').where({ company_id: req.companyId }).orderBy('id')
  const stages = await db('pipeline_stages').whereIn('pipeline_id', pipelines.map((p) => p.id)).orderBy('position')
  res.json(pipelines.map((p) => ({ ...p, stages: stages.filter((s) => s.pipeline_id === p.id) })))
})
settingsRouter.post('/pipelines/:pipelineId/stages', async (req, res) => {
  const max = await db('pipeline_stages').where({ pipeline_id: req.params.pipelineId }).max('position as m').first()
  const [row] = await db('pipeline_stages').insert({ pipeline_id: req.params.pipelineId, name: req.body.name, color: req.body.color || '#94a3b8', position: (max?.m ?? -1) + 1 }).returning('id')
  res.json(await db('pipeline_stages').where({ id: row.id ?? row }).first())
})
settingsRouter.patch('/stages/:id', async (req, res) => {
  const { name, color, position, is_won, is_lost } = req.body
  await db('pipeline_stages').where({ id: req.params.id }).update({ name, color, position, is_won, is_lost })
  res.json(await db('pipeline_stages').where({ id: req.params.id }).first())
})
settingsRouter.delete('/stages/:id', async (req, res) => { await db('pipeline_stages').where({ id: req.params.id }).del(); res.json({ ok: true }) })

// Respuestas rápidas
settingsRouter.get('/quick-replies', requireCompany, async (req, res) => res.json(await db('quick_replies').where({ company_id: req.companyId }).orderBy('shortcut')))
settingsRouter.post('/quick-replies', requireCompany, async (req, res) => {
  const [row] = await db('quick_replies').insert({ company_id: req.companyId, shortcut: req.body.shortcut, body: req.body.body }).returning('id')
  res.json(await db('quick_replies').where({ id: row.id ?? row }).first())
})
settingsRouter.delete('/quick-replies/:id', async (req, res) => { await db('quick_replies').where({ id: req.params.id }).del(); res.json({ ok: true }) })

// Automatizaciones
settingsRouter.get('/automations', requireCompany, async (req, res) => {
  const rows = await db('automations').where({ company_id: req.companyId }).orderBy('id')
  res.json(rows.map((r) => ({ ...r, conditions: JSON.parse(r.conditions || '{}'), actions: JSON.parse(r.actions || '[]') })))
})
settingsRouter.post('/automations', requireCompany, async (req, res) => {
  const { name, trigger, conditions = {}, actions = [], enabled = true } = req.body
  const [row] = await db('automations').insert({ company_id: req.companyId, name, trigger, conditions: JSON.stringify(conditions), actions: JSON.stringify(actions), enabled }).returning('id')
  res.json(await db('automations').where({ id: row.id ?? row }).first())
})
settingsRouter.patch('/automations/:id', async (req, res) => {
  const { name, trigger, conditions, actions, enabled } = req.body
  const patch = {}
  if (name !== undefined) patch.name = name
  if (trigger !== undefined) patch.trigger = trigger
  if (conditions !== undefined) patch.conditions = JSON.stringify(conditions)
  if (actions !== undefined) patch.actions = JSON.stringify(actions)
  if (enabled !== undefined) patch.enabled = !!enabled
  await db('automations').where({ id: req.params.id }).update(patch)
  res.json(await db('automations').where({ id: req.params.id }).first())
})
settingsRouter.delete('/automations/:id', async (req, res) => { await db('automations').where({ id: req.params.id }).del(); res.json({ ok: true }) })

// Agente IA
settingsRouter.get('/ai', requireCompany, async (req, res) => {
  const s = await db('ai_settings').where({ company_id: req.companyId }).first()
  res.json({ ...s, api_key_configured: aiAvailable() })
})
settingsRouter.put('/ai', requireCompany, async (req, res) => {
  const { enabled, model, agent_name, instructions, knowledge, handoff_on_request, max_bot_turns } = req.body
  await db('ai_settings').insert({ company_id: req.companyId, enabled, model, agent_name, instructions, knowledge, handoff_on_request, max_bot_turns })
    .onConflict('company_id').merge()
  res.json(await db('ai_settings').where({ company_id: req.companyId }).first())
})
