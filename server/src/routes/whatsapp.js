import { Router } from 'express'
import { db } from '../db/knex.js'
import { config } from '../config.js'
import { requireAuth, requireCompany, requireAdmin } from '../auth.js'
import { providerFor } from '../services/whatsapp/index.js'
import { evolutionProvider } from '../services/whatsapp/evolutionProvider.js'
import { handleInbound } from '../services/inbound.js'
import { simulateNewLead, simulateReply, startDemoSimulator, stopDemoSimulator, simulatorRunning } from '../services/demoSimulator.js'

export const whatsappRouter = Router()

whatsappRouter.get('/instances', requireAuth, requireCompany, async (req, res) => {
  res.json(await db('whatsapp_instances').where({ company_id: req.companyId }).orderBy('id'))
})

whatsappRouter.post('/instances', requireAuth, requireCompany, requireAdmin, async (req, res) => {
  const { name, phone, provider } = req.body
  const prov = provider || config.whatsappProvider
  const key = `${prov}-${req.companyId}-${Date.now().toString(36)}`
  const [row] = await db('whatsapp_instances').insert({ company_id: req.companyId, name: name || 'WhatsApp Business', phone, provider: prov, instance_key: key }).returning('id')
  const inst = await db('whatsapp_instances').where({ id: row.id ?? row }).first()
  try { await providerFor(inst).createInstance(inst) } catch (e) { return res.status(502).json({ error: e.message }) }
  res.json(inst)
})

whatsappRouter.post('/instances/:id/connect', requireAuth, async (req, res) => {
  const inst = await db('whatsapp_instances').where({ id: req.params.id }).first()
  if (!inst) return res.status(404).json({ error: 'No existe' })
  try { res.json(await providerFor(inst).connect(inst)) } catch (e) { res.status(502).json({ error: e.message }) }
})

whatsappRouter.post('/instances/:id/disconnect', requireAuth, async (req, res) => {
  const inst = await db('whatsapp_instances').where({ id: req.params.id }).first()
  if (!inst) return res.status(404).json({ error: 'No existe' })
  await providerFor(inst).disconnect(inst)
  res.json({ ok: true })
})

whatsappRouter.delete('/instances/:id', requireAuth, requireAdmin, async (req, res) => {
  const inst = await db('whatsapp_instances').where({ id: req.params.id }).first()
  if (inst) { try { await providerFor(inst).disconnect(inst) } catch {} ; await db('whatsapp_instances').where({ id: inst.id }).del() }
  res.json({ ok: true })
})

// Webhook de Evolution API (sin auth de usuario; Evolution llama aquí)
whatsappRouter.post('/webhooks/evolution/:instanceKey', async (req, res) => {
  const inst = await db('whatsapp_instances').where({ instance_key: req.params.instanceKey }).first()
  if (!inst) return res.status(404).json({ error: 'Instancia desconocida' })
  res.json({ ok: true })
  try {
    const inbound = await evolutionProvider.handleWebhook(inst, req.body || {})
    for (const m of inbound || []) await handleInbound(inst, m)
  } catch (e) { console.error('Webhook Evolution:', e.message) }
})

// Webhook genérico de leads (formularios web, Google Ads Lead Form, n8n, Zapier...)
whatsappRouter.post('/webhooks/lead/:companyId', async (req, res) => {
  const { phone, name, message, source, campaign } = req.body || {}
  if (!phone) return res.status(400).json({ error: 'Falta phone' })
  const inst = await db('whatsapp_instances').where({ company_id: req.params.companyId }).orderBy('status', 'desc').first()
  if (!inst) return res.status(404).json({ error: 'La empresa no tiene instancia de WhatsApp' })
  const tag = source === 'google_ads' ? `[GA-${campaign || 'LEADFORM'}]` : source === 'meta_ads' ? `[META-${campaign || 'LEADFORM'}]` : `[WEB-${campaign || 'FORM'}]`
  const r = await handleInbound(inst, { phone, name, body: `${message || 'Solicitud de información desde formulario'} ${tag}` })
  res.json({ ok: true, conversation_id: r.conversation.id })
})

// Demo
whatsappRouter.post('/demo/new-lead/:instanceId', requireAuth, async (req, res) => {
  try { const r = await simulateNewLead(req.params.instanceId); res.json({ conversation_id: r.conversation.id }) } catch (e) { res.status(400).json({ error: e.message }) }
})
whatsappRouter.post('/demo/reply/:conversationId', requireAuth, async (req, res) => {
  const r = await simulateReply(req.params.conversationId, req.body?.text)
  res.json({ ok: true, message_id: r.message.id })
})
whatsappRouter.get('/demo/simulator', requireAuth, (req, res) => res.json({ running: simulatorRunning() }))
whatsappRouter.post('/demo/simulator', requireAuth, (req, res) => {
  if (req.body?.running) startDemoSimulator({ everyMs: Number(req.body.everyMs) || 60_000 }); else stopDemoSimulator()
  res.json({ running: simulatorRunning() })
})
