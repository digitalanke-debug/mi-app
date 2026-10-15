import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, query } from './db.js'
import { ensureAdmin, requireAuth, requireAdmin, loginLimiter, setSession, clearSession, verifyPassword, hashPassword } from './auth.js'
import { emptyState } from '../src/store/seed.js'
import { readState, applyAction, isAllowedAction, isValidState } from './state.js'
import { whatsappRouter, migrateWhatsApp } from './whatsapp.js'
import { cuentaDeCobroPDF } from './pdf.js'
import { startScheduler } from './scheduler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const app = express()

app.set('trust proxy', 1)
app.use(express.json({ limit: '30mb' }))
app.use(cookieParser())

// ---------- Autenticación ----------
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const r = await query('SELECT * FROM users WHERE email = $1 AND active', [email])
  const user = r.rows[0]
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' })
  }
  setSession(res, user)
  res.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', (req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

app.post('/api/auth/password', requireAuth, async (req, res) => {
  const current = String(req.body?.current || '')
  const next = String(req.body?.next || '')
  if (next.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' })
  const r = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
  if (!(await verifyPassword(current, r.rows[0].password_hash))) return res.status(400).json({ error: 'La contraseña actual no es correcta' })
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), req.user.id])
  res.json({ ok: true })
})

// ---------- Usuarios (solo admin) ----------
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT id, email, name, role, active, created_at FROM users ORDER BY id')
  res.json({ users: r.rows })
})

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, name, password, role } = req.body || {}
  if (!email || !name || !password || !['admin', 'lectura'].includes(role)) return res.status(400).json({ error: 'Datos incompletos' })
  if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' })
  try {
    const r = await query(
      'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, active, created_at',
      [String(email).trim().toLowerCase(), String(name).trim(), await hashPassword(String(password)), role],
    )
    res.json({ user: r.rows[0] })
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un usuario con ese correo' })
    throw e
  }
})

app.patch('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  const { role, active, password, name } = req.body || {}
  if (id === req.user.id && active === false) return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' })
  if (role && !['admin', 'lectura'].includes(role)) return res.status(400).json({ error: 'Rol no válido' })
  if (password && String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' })
  const sets = []
  const vals = []
  if (role) { vals.push(role); sets.push(`role = $${vals.length}`) }
  if (typeof active === 'boolean') { vals.push(active); sets.push(`active = $${vals.length}`) }
  if (name) { vals.push(String(name).trim()); sets.push(`name = $${vals.length}`) }
  if (password) { vals.push(await hashPassword(String(password))); sets.push(`password_hash = $${vals.length}`) }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' })
  vals.push(id)
  const r = await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, email, name, role, active, created_at`, vals)
  res.json({ user: r.rows[0] })
})

// ---------- Estado y acciones ----------
app.get('/api/state', requireAuth, async (req, res) => {
  res.json(await readState(req.user))
})

app.post('/api/actions', requireAuth, async (req, res) => {
  const action = req.body?.action
  if (!action || typeof action.type !== 'string') return res.status(400).json({ error: 'Acción no válida' })
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Tu usuario es de solo lectura' })
  if (action.type !== 'replace' && !isAllowedAction(action.type)) return res.status(400).json({ error: `Acción no permitida: ${action.type}` })
  if (action.type === 'replace' && !isValidState(action.state)) return res.status(400).json({ error: 'El estado a restaurar no es válido' })
  res.json(await applyAction(action, req.user))
})

app.use('/api/whatsapp', whatsappRouter())

// Cuenta de cobro en PDF (descarga o vista en el navegador)
app.get('/api/invoices/:id/pdf', requireAuth, async (req, res) => {
  const { state } = await readState(req.user)
  const inv = state.invoices.find((i) => i.id === req.params.id)
  const client = inv && state.clients.find((c) => c.id === inv.clientId)
  const company = inv && state.companies.find((c) => c.id === inv.companyId)
  if (!inv || !client || !company) return res.status(404).json({ error: 'Cuenta de cobro no encontrada' })
  const pdf = await cuentaDeCobroPDF({ company, client, invoice: inv })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${inv.number}.pdf"`)
  res.send(pdf)
})

app.get('/api/log', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100)
  const r = await query('SELECT id, user_email, action, version, created_at FROM actions_log ORDER BY id DESC LIMIT $1', [limit])
  res.json({ log: r.rows })
})

app.get('/api/health', (req, res) => res.json({ ok: true }))

// ---------- Archivos estáticos (la app React compilada) ----------
const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist, { index: false, maxAge: '1h' }))
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))

// ---------- Errores ----------
app.use((err, req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role }
}

async function main() {
  await migrate()
  await migrateWhatsApp()
  const r = await query('SELECT 1 FROM app_state WHERE id = 1')
  if (!r.rowCount) await query('INSERT INTO app_state (id, data, version) VALUES (1, $1, 0)', [emptyState()])
  await ensureAdmin()
  startScheduler()
  app.listen(PORT, () => console.log(`API lista en el puerto ${PORT}`))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
