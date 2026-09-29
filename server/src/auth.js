import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { db } from './db/knex.js'

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.jwtSecret, { expiresIn: '7d' })
}

export function verifyToken(token) {
  try { return jwt.verify(token, config.jwtSecret) } catch { return null }
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  const payload = token && verifyToken(token)
  if (!payload) return res.status(401).json({ error: 'No autenticado' })
  const user = await db('users').where({ id: payload.sub, active: true }).first()
  if (!user) return res.status(401).json({ error: 'Usuario inactivo' })
  req.user = user
  next()
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  next()
}

/** Verifica que el usuario pertenezca a la empresa indicada en :companyId o ?company_id */
export async function requireCompany(req, res, next) {
  const companyId = Number(req.params.companyId || req.query.company_id || req.body?.company_id)
  if (!companyId) return res.status(400).json({ error: 'Falta company_id' })
  if (req.user.role !== 'admin') {
    const m = await db('company_users').where({ company_id: companyId, user_id: req.user.id }).first()
    if (!m) return res.status(403).json({ error: 'Sin acceso a esta empresa' })
  }
  req.companyId = companyId
  next()
}

export async function userCompanyIds(user) {
  if (user.role === 'admin') return (await db('companies').select('id')).map((c) => c.id)
  return (await db('company_users').where({ user_id: user.id }).select('company_id')).map((c) => c.company_id)
}
