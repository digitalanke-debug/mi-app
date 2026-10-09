import express from 'express'
import cors from 'cors'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { db } from './db/knex.js'
import { requireAuth, verifyToken } from './auth.js'
import { UPLOAD_DIR } from './services/media.js'
import { initRealtime } from './services/realtime.js'
import { authRouter } from './routes/auth.js'
import { companiesRouter } from './routes/companies.js'
import { whatsappRouter } from './routes/whatsapp.js'
import { conversationsRouter } from './routes/conversations.js'
import { settingsRouter } from './routes/settings.js'
import { dashboardRouter } from './routes/dashboard.js'
import { marketingRouter } from './routes/marketing.js'
import { checkInactivity } from './services/automations.js'
import { startDemoSimulator } from './services/demoSimulator.js'

const app = express()
// Los archivos adjuntos requieren sesión: cabecera Bearer o ?t=<token> (para <img src>)
async function requireAuthOrToken(req, res, next) {
  const header = req.headers.authorization || ''
  const tok = header.startsWith('Bearer ') ? header.slice(7) : req.query.t
  if (!tok || !verifyToken(tok)) return res.status(401).end()
  next()
}
app.set('trust proxy', 1) // detrás de Caddy/Nginx
app.disable('x-powered-by')
if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'cambiar-en-produccion') console.warn('ADVERTENCIA: JWT_SECRET por defecto en producción')
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '30mb' }))
app.use('/uploads', requireAuthOrToken, express.static(UPLOAD_DIR, { maxAge: '7d', index: false }))

app.get('/api/health', (req, res) => res.json({ ok: true, provider: config.whatsappProvider, db: config.dbClient }))
app.use('/api/auth', authRouter)
app.use('/api/whatsapp', whatsappRouter) // incluye webhooks públicos
app.use('/api/companies', requireAuth, companiesRouter)
app.use('/api/conversations', requireAuth, conversationsRouter)
app.use('/api/dashboard', requireAuth, dashboardRouter)
app.use('/api/marketing', requireAuth, marketingRouter)
app.use('/api', requireAuth, settingsRouter)

// En producción sirve el build del cliente desde el mismo proceso
const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, '..', '..', 'client', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api|socket\.io).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Error interno' })
})

const server = http.createServer(app)
initRealtime(server, true)

await db.migrate.latest()
if (config.seedOnEmpty) {
  const u = await db('users').count('id as n').first()
  if (!Number(u?.n)) { console.log('Base vacía: cargando datos demo…'); await import('./db/seed.js') }
}
setInterval(() => checkInactivity().catch((e) => console.error('inactivity:', e.message)), 60_000)
if (config.whatsappProvider === 'demo' && config.demoAutoLeads) startDemoSimulator({ everyMs: 90_000 })

server.listen(config.port, () => {
  console.log(`CRM API en http://localhost:${config.port} | proveedor WhatsApp: ${config.whatsappProvider} | BD: ${config.dbClient}`)
})
