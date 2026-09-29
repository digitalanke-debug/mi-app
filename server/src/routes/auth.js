import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db/knex.js'
import { signToken, requireAuth, userCompanyIds } from '../auth.js'

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  const user = await db('users').where({ email: String(email || '').toLowerCase().trim() }).first()
  if (!user || !user.active || !(await bcrypt.compare(password || '', user.password_hash))) return res.status(401).json({ error: 'Correo o contraseña incorrectos' })
  const ids = await userCompanyIds(user)
  const companies = await db('companies').whereIn('id', ids).orderBy('name')
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role }, companies })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const ids = await userCompanyIds(req.user)
  const companies = await db('companies').whereIn('id', ids).orderBy('name')
  res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role }, companies })
})
