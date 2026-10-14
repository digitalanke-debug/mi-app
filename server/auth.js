import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { query } from './db.js'

const SECRET = process.env.JWT_SECRET
if (!SECRET || SECRET.length < 16) {
  throw new Error('Falta JWT_SECRET (mínimo 16 caracteres) en las variables de entorno')
}
const COOKIE = 'sigo_session'
const PROD = process.env.NODE_ENV === 'production'

export function hashPassword(p) {
  return bcrypt.hash(p, 10)
}

export async function verifyPassword(p, hash) {
  return bcrypt.compare(p, hash)
}

export function setSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email, name: user.name }, SECRET, { expiresIn: '12h' })
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: PROD,
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  })
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' })
}

/** Middleware: exige sesión válida y usuario activo */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE]
  if (!token) return res.status(401).json({ error: 'No has iniciado sesión' })
  try {
    const payload = jwt.verify(token, SECRET)
    const r = await query('SELECT id, email, name, role, active FROM users WHERE id = $1', [payload.sub])
    const user = r.rows[0]
    if (!user || !user.active) return res.status(401).json({ error: 'Sesión no válida' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Sesión expirada' })
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede hacer esto' })
  next()
}

// Límite simple de intentos de inicio de sesión por IP (en memoria)
const attempts = new Map()
export function loginLimiter(req, res, next) {
  const ip = req.ip
  const now = Date.now()
  const entry = attempts.get(ip) || { count: 0, since: now }
  if (now - entry.since > 15 * 60 * 1000) {
    entry.count = 0
    entry.since = now
  }
  if (entry.count >= 10) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' })
  entry.count += 1
  attempts.set(ip, entry)
  next()
}

/** Crea el primer administrador si la tabla de usuarios está vacía */
export async function ensureAdmin() {
  const r = await query('SELECT COUNT(*)::int AS n FROM users')
  if (r.rows[0].n > 0) return
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    console.warn('No hay usuarios y faltan ADMIN_EMAIL / ADMIN_PASSWORD: nadie podrá entrar.')
    return
  }
  await query('INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)', [
    email.toLowerCase(),
    process.env.ADMIN_NAME || 'Administradora',
    await hashPassword(password),
    'admin',
  ])
  console.log(`Usuario administrador creado: ${email}`)
}
