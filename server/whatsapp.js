/**
 * Integración con WhatsApp vía Evolution API:
 *  - webhook de mensajes entrantes (texto, nota de voz, imagen) -> asistente -> respuesta
 *  - estado y conexión del número (QR)
 *  - envío de recordatorios a clientes desde la app
 */
import express from 'express'
import { evolution, evolutionConfig } from './evolution.js'
import { transcribeAudio, transcribeConfigured } from './transcribe.js'
import { runAgent, agentConfigured } from './agent.js'
import { readState, applyAction, query } from './state.js'
import { requireAuth, requireAdmin } from './auth.js'
import { todayISO } from '../src/lib/format.js'
import { cuentaDeCobroPDF } from './pdf.js'
import { invoiceBalance } from '../src/lib/invoices.js'
import { cop, fmtDate } from '../src/lib/format.js'

const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || ''
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
const CONVERSATION_TTL_MS = 6 * 60 * 60 * 1000
const MAX_HISTORY = 40

export function webhookUrl() {
  return PUBLIC_URL && WEBHOOK_SECRET ? `${PUBLIC_URL}/api/whatsapp/webhook/${WEBHOOK_SECRET}` : ''
}

export async function migrateWhatsApp() {
  await query(`
    CREATE TABLE IF NOT EXISTS wa_conversations (
      phone TEXT PRIMARY KEY,
      messages JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS wa_processed (
      message_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
}

// ---------- utilidades ----------
const digits = (s) => String(s || '').replace(/\D/g, '')

/** Compara por los últimos 10 dígitos para tolerar el indicativo de país */
function sameNumber(a, b) {
  const x = digits(a)
  const y = digits(b)
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10)
}

export function findAllowed(state, candidates) {
  const list = state.settings?.whatsapp?.allowedNumbers || []
  for (const c of candidates) {
    const hit = list.find((n) => sameNumber(n.phone, c))
    if (hit) return hit
  }
  return null
}

/** Extrae lo útil del evento messages.upsert de Evolution */
export function parseIncoming(body) {
  const data = body?.data
  if (!data || body?.event !== 'messages.upsert') return null
  const key = data.key || {}
  if (key.fromMe) return null
  const jid = String(key.remoteJid || '')
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return null
  const msg = data.message || {}
  const candidates = [jid, key.senderPn, key.remoteJidAlt, data.sender, body?.sender].filter(Boolean)
  const base = { id: key.id, jid, candidates, pushName: data.pushName || '', key: { id: key.id, remoteJid: key.remoteJid, fromMe: !!key.fromMe } }
  if (msg.conversation) return { ...base, kind: 'text', text: msg.conversation }
  if (msg.extendedTextMessage?.text) return { ...base, kind: 'text', text: msg.extendedTextMessage.text }
  if (msg.audioMessage) return { ...base, kind: 'audio', base64: msg.base64 || null, mimetype: msg.audioMessage.mimetype || 'audio/ogg' }
  if (msg.imageMessage) return { ...base, kind: 'image', base64: msg.base64 || null, mimetype: (msg.imageMessage.mimetype || 'image/jpeg').split(';')[0], caption: msg.imageMessage.caption || '' }
  if (msg.documentMessage?.mimetype === 'application/pdf') return { ...base, kind: 'pdf', base64: msg.base64 || null, caption: msg.documentMessage.caption || msg.documentMessage.fileName || '' }
  return { ...base, kind: 'other' }
}

async function loadConversation(phone) {
  const r = await query('SELECT messages, updated_at FROM wa_conversations WHERE phone = $1', [phone])
  const row = r.rows[0]
  if (!row) return []
  if (Date.now() - new Date(row.updated_at).getTime() > CONVERSATION_TTL_MS) return []
  return row.messages || []
}

async function saveConversation(phone, messages) {
  // Si la conversación crece demasiado, se reinicia (una conversación nueva, no una edición)
  const trimmed = messages.length > MAX_HISTORY ? [] : messages
  await query(
    'INSERT INTO wa_conversations (phone, messages, updated_at) VALUES ($1, $2, now()) ON CONFLICT (phone) DO UPDATE SET messages = $2, updated_at = now()',
    [phone, JSON.stringify(trimmed)],
  )
}

async function alreadyProcessed(id) {
  if (!id) return false
  const r = await query('INSERT INTO wa_processed (message_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING message_id', [id])
  return r.rowCount === 0
}

/** Procesa un mensaje entrante de principio a fin. deps permite inyectar sendText/transcribe/anthropic en pruebas. */
export async function handleIncoming(incoming, deps = {}) {
  const sendText = deps.sendText || ((n, t) => evolution.sendText(n, t))
  const { state } = await readState({ email: 'whatsapp' })
  const allowed = findAllowed(state, incoming.candidates)
  if (!allowed) {
    console.log(`WhatsApp: mensaje ignorado de número no autorizado (${incoming.candidates[0]})`)
    return { ignored: true }
  }
  if (await alreadyProcessed(incoming.id)) return { ignored: true, duplicate: true }

  const actor = { id: null, email: `whatsapp:${digits(allowed.phone)}` }
  const reply = (t) => sendText(incoming.jid, t)

  // ---- construir el contenido del turno ----
  let content
  if (incoming.kind === 'text') {
    content = [{ type: 'text', text: incoming.text }]
  } else if (incoming.kind === 'audio') {
    if (!(deps.transcribeConfigured ?? transcribeConfigured())) {
      await reply('Todavía no puedo escuchar notas de voz. ¿Me lo escribes?')
      return { replied: true }
    }
    let b64 = incoming.base64
    if (!b64) {
      const media = await (deps.getMedia || ((k) => evolution.getMediaBase64(k)))(incoming.key)
      b64 = media?.base64
    }
    if (!b64) {
      await reply('No pude descargar la nota de voz. ¿Me la reenvías o me lo escribes?')
      return { replied: true }
    }
    const text = await (deps.transcribe || transcribeAudio)(b64, incoming.mimetype)
    if (!text) {
      await reply('No entendí la nota de voz. ¿Me lo escribes?')
      return { replied: true }
    }
    content = [{ type: 'text', text: `(Nota de voz transcrita) ${text}` }]
  } else if (incoming.kind === 'image' || incoming.kind === 'pdf') {
    let b64 = incoming.base64
    if (!b64) {
      const media = await (deps.getMedia || ((k) => evolution.getMediaBase64(k)))(incoming.key)
      b64 = media?.base64
    }
    if (!b64) {
      await reply('No pude descargar el archivo. ¿Me lo reenvías?')
      return { replied: true }
    }
    const block = incoming.kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: incoming.mimetype, data: b64 } }
    content = [block, { type: 'text', text: incoming.caption || 'Te envío este archivo. Dime qué contiene y, si es una factura o un comprobante de pago, propón cómo registrarlo.' }]
  } else {
    await reply('Por ahora entiendo texto, notas de voz, fotos y PDF.')
    return { replied: true }
  }

  const history = await loadConversation(incoming.jid)
  const agentDeps = { anthropic: deps.anthropic, useFallbacks: deps.useFallbacks, sendWhatsApp: sendText, sendInvoicePDF: (st, id, msg, act) => sendInvoicePDF(st, id, msg, act, { sendDocument: deps.sendDocument }) }
  const { reply: answer, messages } = await runAgent({ history, content, actor, actorName: allowed.name || incoming.pushName, deps: agentDeps })
  await saveConversation(incoming.jid, messages)
  await reply(answer)
  return { replied: true, answer }
}

/** Genera el PDF de una cuenta de cobro y lo envía al celular del cliente. Devuelve {ok, enviadoA}. */
export async function sendInvoicePDF(state, invoiceId, message, actor, deps = {}) {
  const inv = state.invoices.find((i) => i.id === invoiceId)
  const client = inv && state.clients.find((c) => c.id === inv.clientId)
  const company = inv && state.companies.find((c) => c.id === inv.companyId)
  if (!inv || !client || !company) throw Object.assign(new Error('Cuenta de cobro no encontrada'), { status: 400 })
  const phone = digits(client.phone)
  if (!phone) throw Object.assign(new Error(`${client.name} no tiene celular registrado`), { status: 400 })
  const pdf = await cuentaDeCobroPDF({ company, client, invoice: inv })
  const caption = message || `Buen día ${client.contact || client.name}. Le compartimos la cuenta de cobro ${inv.number} de ${company.name} por ${cop(invoiceBalance(inv))}, con vencimiento el ${fmtDate(inv.dueDate)}. Quedamos atentos.`
  const number = `${state.settings.countryCode || '57'}${phone}`
  await (deps.sendDocument || ((n, b, f, c) => evolution.sendDocument(n, b, f, c)))(number, pdf.toString('base64'), `${inv.number}.pdf`, caption)
  await applyAction({ type: 'reminder/add', reminder: { clientId: client.id, invoiceId: inv.id, date: todayISO(), channel: 'WhatsApp · cuenta de cobro PDF', message: caption } }, actor)
  return { ok: true, enviadoA: client.name, celular: phone, numero: inv.number }
}

// ---------- router ----------
export function whatsappRouter() {
  const router = express.Router()

  // Webhook de Evolution. Responde de inmediato y procesa en segundo plano.
  router.post('/webhook/:secret', express.json({ limit: '30mb' }), (req, res) => {
    if (!WEBHOOK_SECRET || req.params.secret !== WEBHOOK_SECRET) return res.status(404).end()
    const { apiKey } = evolutionConfig()
    if (apiKey && req.body?.apikey && req.body.apikey !== apiKey) return res.status(403).end()
    res.json({ ok: true })
    const incoming = parseIncoming(req.body)
    if (!incoming) return
    handleIncoming(incoming).catch((e) => {
      console.error('WhatsApp: error procesando mensaje', e)
      evolution.sendText(incoming.jid, 'Tuve un problema procesando tu mensaje. Inténtalo de nuevo en un momento.').catch(() => {})
    })
  })

  router.get('/status', requireAuth, requireAdmin, async (req, res) => {
    const cfg = evolutionConfig()
    const out = {
      evolution: cfg.configured,
      instance: cfg.instance,
      asistente: agentConfigured(),
      voz: transcribeConfigured(),
      webhook: !!webhookUrl(),
      estado: 'sin configurar',
    }
    if (cfg.configured) {
      try {
        out.estado = await evolution.connectionState()
      } catch (e) {
        out.estado = e.status === 404 ? 'sin instancia' : 'error'
        out.detalle = /ECONNREFUSED|ENOTFOUND|fetch failed|timeout/i.test(e.message)
          ? `La app no logra conectarse con Evolution API en ${cfg.url}. En el servidor ejecuta: bash deploy/configurar-whatsapp.sh`
          : e.message
      }
    }
    res.json(out)
  })

  // Crea la instancia si no existe, fija el webhook y devuelve el QR (o el estado si ya está conectada)
  router.post('/connect', requireAuth, requireAdmin, async (req, res) => {
    const cfg = evolutionConfig()
    if (!cfg.configured) return res.status(400).json({ error: 'Falta configurar EVOLUTION_URL y EVOLUTION_API_KEY en el servidor' })
    const url = webhookUrl()
    if (!url) return res.status(400).json({ error: 'Falta PUBLIC_URL o WHATSAPP_WEBHOOK_SECRET en el servidor' })
    let state
    try {
      state = await evolution.connectionState()
    } catch (e) {
      if (e.status !== 404) return res.status(502).json({ error: e.message })
      state = null
    }
    const pickQr = (r) => r?.base64 || r?.qrcode?.base64 || null
    try {
      let qr = null
      let pairingCode = null
      if (!state) {
        const created = await evolution.createInstance(url)
        qr = pickQr(created)
        pairingCode = created?.qrcode?.pairingCode || null
      } else {
        await evolution.setWebhook(url)
        if (state === 'open') return res.json({ estado: 'open', qr: null })
      }
      // El QR puede tardar un momento en generarse: reintenta unas veces
      for (let i = 0; i < 4 && !qr; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        const r = await evolution.connect().catch(() => null)
        if (r?.instance?.state === 'open') return res.json({ estado: 'open', qr: null })
        qr = pickQr(r)
        pairingCode = r?.pairingCode || pairingCode
      }
      return res.json({ estado: 'connecting', qr, pairingCode, detalle: qr ? null : 'Evolution no devolvió el código QR todavía. Pulsa "Generar otro código".' })
    } catch (e) {
      const hint = /ECONNREFUSED|ENOTFOUND|fetch failed|timeout/i.test(e.message)
        ? ' La app no logra conectarse con Evolution API: revisa EVOLUTION_URL y EVOLUTION_NETWORK en el servidor (bash deploy/configurar-whatsapp.sh).'
        : ''
      return res.status(502).json({ error: e.message + hint })
    }
  })

  // Enviar un recordatorio a un cliente desde la app
  router.post('/send-reminder', requireAuth, requireAdmin, express.json(), async (req, res) => {
    const { invoiceId, message } = req.body || {}
    const { state } = await readState(req.user)
    const inv = state.invoices.find((i) => i.id === invoiceId)
    const client = inv && state.clients.find((c) => c.id === inv.clientId)
    const phone = digits(client?.phone)
    if (!inv || !client) return res.status(400).json({ error: 'Cuenta de cobro no encontrada' })
    if (!phone) return res.status(400).json({ error: 'El cliente no tiene celular registrado' })
    if (!message) return res.status(400).json({ error: 'Falta el mensaje' })
    try {
      await evolution.sendText(`${state.settings.countryCode || '57'}${phone}`, message)
    } catch (e) {
      return res.status(502).json({ error: 'WhatsApp no pudo enviar el mensaje: ' + e.message })
    }
    const r = await applyAction({ type: 'reminder/add', reminder: { clientId: client.id, invoiceId: inv.id, date: todayISO(), channel: 'WhatsApp (automático)', message } }, req.user)
    res.json({ ok: true, state: r.state })
  })

  // Enviar la cuenta de cobro en PDF al cliente por WhatsApp
  router.post('/send-invoice', requireAuth, requireAdmin, express.json(), async (req, res) => {
    const { invoiceId, message } = req.body || {}
    const { state } = await readState(req.user)
    try {
      const out = await sendInvoicePDF(state, invoiceId, message, req.user)
      res.json(out)
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message })
    }
  })

  // Probar el asistente desde la app sin WhatsApp (solo admin)
  router.post('/test', requireAuth, requireAdmin, express.json(), async (req, res) => {
    if (!agentConfigured()) return res.status(400).json({ error: 'Falta ANTHROPIC_API_KEY en el servidor' })
    const text = String(req.body?.text || '').trim()
    if (!text) return res.status(400).json({ error: 'Escribe un mensaje' })
    const phone = `prueba:${req.user.id}`
    const history = req.body?.reset ? [] : await loadConversation(phone)
    try {
      const { reply, messages } = await runAgent({ history, content: [{ type: 'text', text }], actor: req.user, actorName: req.user.name, deps: { sendWhatsApp: async () => { throw new Error('En modo prueba no se envían mensajes a clientes') } } })
      await saveConversation(phone, messages)
      res.json({ reply })
    } catch (e) {
      res.status(502).json({ error: e.message })
    }
  })

  return router
}
