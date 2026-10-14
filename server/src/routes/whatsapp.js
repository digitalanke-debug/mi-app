import { Router } from 'express'
import { db } from '../db/knex.js'
import { config } from '../config.js'
import { requireAuth, requireCompany, requireAdmin } from '../auth.js'
import { providerFor, publicInstance } from '../services/whatsapp/index.js'
import { metaProvider, parseMetaChange, validSignature, webhookVerifyToken, cfgOf } from '../services/whatsapp/metaProvider.js'
import { updateMessageStatus } from '../services/conversations.js'
import { canAccessCompany } from '../auth.js'
import { evolutionProvider } from '../services/whatsapp/evolutionProvider.js'
import { handleInbound } from '../services/inbound.js'
import { simulateNewLead, simulateReply, startDemoSimulator, stopDemoSimulator, simulatorRunning } from '../services/demoSimulator.js'

export const whatsappRouter = Router()

whatsappRouter.get('/instances', requireAuth, requireCompany, async (req, res) => {
  res.json((await db('whatsapp_instances').where({ company_id: req.companyId }).orderBy('id')).map(publicInstance))
})

/** Datos para configurar el webhook en Meta (URL y token de verificación) */
whatsappRouter.get('/meta/setup', requireAuth, requireAdmin, (req, res) => {
  res.json({ callback_url: `${req.protocol}://${req.get('host')}/api/whatsapp/webhooks/meta`, verify_token: webhookVerifyToken(), graph_version: config.meta.version })
})

const META_KEYS = ['phone_number_id', 'waba_id', 'access_token', 'app_secret']
function mergeMetaConfig(current, incoming) {
  const c = { ...current }
  for (const k of META_KEYS) if (incoming[k] !== undefined && !String(incoming[k]).startsWith('••••')) c[k] = String(incoming[k]).trim()
  return c
}

/** Actualiza credenciales de un número de la API oficial */
whatsappRouter.patch('/instances/:id/meta', requireAuth, requireAdmin, async (req, res) => {
  const inst = await db('whatsapp_instances').where({ id: req.params.id }).first()
  if (!inst || inst.provider !== 'meta') return res.status(404).json({ error: 'No existe' })
  const c = mergeMetaConfig(cfgOf(inst), req.body || {})
  await db('whatsapp_instances').where({ id: inst.id }).update({ config: JSON.stringify(c), name: req.body.name || inst.name, instance_key: `meta-${c.phone_number_id}` })
  const fresh = await db('whatsapp_instances').where({ id: inst.id }).first()
  try { res.json(await metaProvider.connect(fresh)) } catch (e) { res.status(400).json({ error: e.message }) }
})

/** Plantillas aprobadas del número (API oficial) */
whatsappRouter.get('/instances/:id/templates', requireAuth, async (req, res) => {
  const inst = await db('whatsapp_instances').where({ id: req.params.id }).first()
  if (!inst || !(await canAccessCompany(req.user, inst.company_id))) return res.status(404).json({ error: 'No existe' })
  if (inst.provider !== 'meta') return res.json([])
  try { res.json(await metaProvider.listTemplates(inst)) } catch (e) { res.status(400).json({ error: e.message }) }
})

whatsappRouter.post('/instances', requireAuth, requireCompany, async (req, res) => {
  const { name, phone, provider } = req.body
  const prov = provider || config.whatsappProvider
  if (prov === 'meta' && req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores pueden conectar números de la API oficial' })
  let key = `${prov}-${req.companyId}-${Date.now().toString(36)}`
  let cfg = null
  if (prov === 'meta') {
    const c = mergeMetaConfig({}, req.body.meta || {})
    if (!c.phone_number_id || !c.access_token) return res.status(400).json({ error: 'Phone Number ID y token de acceso son obligatorios' })
    if (await db('whatsapp_instances').where({ instance_key: `meta-${c.phone_number_id}` }).first()) return res.status(400).json({ error: 'Ese número ya está conectado en el CRM' })
    key = `meta-${c.phone_number_id}`
    cfg = JSON.stringify(c)
  }
  const [row] = await db('whatsapp_instances').insert({ company_id: req.companyId, name: name || 'WhatsApp Business', phone, provider: prov, instance_key: key, config: cfg }).returning('id')
  const inst = await db('whatsapp_instances').where({ id: row.id ?? row }).first()
  try { await providerFor(inst).createInstance(inst) } catch (e) {
    if (prov === 'meta') return res.status(400).json({ error: e.message, instance: publicInstance(await db('whatsapp_instances').where({ id: inst.id }).first()) })
    return res.status(502).json({ error: e.message })
  }
  res.json(publicInstance(await db('whatsapp_instances').where({ id: inst.id }).first()))
})

whatsappRouter.post('/instances/:id/connect', requireAuth, async (req, res) => {
  const inst = await db('whatsapp_instances').where({ id: req.params.id }).first()
  if (!inst || !(await canAccessCompany(req.user, inst.company_id))) return res.status(404).json({ error: 'No existe' })
  try { res.json(await providerFor(inst).connect(inst)) } catch (e) { res.status(502).json({ error: e.message }) }
})

whatsappRouter.post('/instances/:id/disconnect', requireAuth, async (req, res) => {
  const inst = await db('whatsapp_instances').where({ id: req.params.id }).first()
  if (!inst || !(await canAccessCompany(req.user, inst.company_id))) return res.status(404).json({ error: 'No existe' })
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

// Webhook de la API oficial (Meta). GET = verificación, POST = eventos de todos los números.
whatsappRouter.get('/webhooks/meta', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === webhookVerifyToken()) return res.status(200).send(String(req.query['hub.challenge'] || ''))
  res.status(403).send('Token de verificación inválido')
})
whatsappRouter.post('/webhooks/meta', async (req, res) => {
  const body = req.body || {}
  if (body.object !== 'whatsapp_business_account') return res.sendStatus(404)
  // Verifica la firma antes de procesar (si el número tiene app secret configurado)
  const changes = (body.entry || []).flatMap((e) => e.changes || []).filter((c) => c.field === 'messages')
  const jobs = []
  for (const ch of changes) {
    const pnid = ch.value?.metadata?.phone_number_id
    const inst = pnid && await db('whatsapp_instances').where({ instance_key: `meta-${pnid}` }).first()
    if (!inst) { console.warn('Webhook Meta: número sin configurar', pnid); continue }
    if (!validSignature(req.rawBody, req.headers['x-hub-signature-256'], cfgOf(inst).app_secret)) return res.sendStatus(401)
    jobs.push({ inst, value: ch.value })
  }
  res.sendStatus(200) // Meta exige respuesta rápida; se procesa después
  for (const { inst, value } of jobs) {
    try {
      const { inbound, statuses } = await parseMetaChange(inst, value)
      for (const m of inbound) await handleInbound(inst, m)
      for (const s of statuses) await updateMessageStatus(s.id, s.status, s.error)
    } catch (e) { console.error('Webhook Meta:', e.message) }
  }
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
// Demo: el cliente envía una imagen de prueba
whatsappRouter.post('/demo/media/:conversationId', requireAuth, async (req, res) => {
  const conv = await db('conversations').where({ id: req.params.conversationId }).first()
  const inst = await db('whatsapp_instances').where({ id: conv.instance_id }).first()
  const contact = await db('contacts').where({ id: conv.contact_id }).first()
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAIAAABOx7AjAAAAgElEQVR42u3QMQEAAAgDoGk/aa/BBWQcVKkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAtwG9JgABGZ6+NwAAAABJRU5ErkJggg=='
  const r = await handleInbound(inst, { phone: contact.phone, name: contact.name, body: 'Te envío el documento', type: 'image', media: { base64: png, mime: 'image/png', name: 'cedula.png' } })
  res.json({ ok: true, message_id: r.message.id })
})
whatsappRouter.get('/demo/simulator', requireAuth, (req, res) => res.json({ running: simulatorRunning() }))
whatsappRouter.post('/demo/simulator', requireAuth, (req, res) => {
  if (req.body?.running) startDemoSimulator({ everyMs: Number(req.body.everyMs) || 60_000 }); else stopDemoSimulator()
  res.json({ running: simulatorRunning() })
})
