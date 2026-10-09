import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db/knex.js'
import { signToken, requireAuth, userCompanyIds } from '../auth.js'

export const authRouter = Router()

const attempts = new Map() // ip+correo -> {n, until}
function tooMany(ip) {
  const a = attempts.get(ip)
  if (a && a.until > Date.now()) return true
  return false
}
function fail(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 }
  a.n++
  if (a.n >= 8) { a.until = Date.now() + 10 * 60_000; a.n = 0 }
  attempts.set(ip, a)
}

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  const ip = `${req.ip}|${String(email || '').toLowerCase().trim()}`
  if (tooMany(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera 10 minutos.' })
  const user = await db('users').where({ email: String(email || '').toLowerCase().trim() }).first()
  if (!user || !user.active || !(await bcrypt.compare(password || '', user.password_hash))) { fail(ip); return res.status(401).json({ error: 'Correo o contraseña incorrectos' }) }
  attempts.delete(ip)
  const ids = await userCompanyIds(user)
  const companies = await db('companies').whereIn('id', ids).orderBy('name')
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role }, companies })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const ids = await userCompanyIds(req.user)
  const companies = await db('companies').whereIn('id', ids).orderBy('name')
  res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role }, companies })
})
