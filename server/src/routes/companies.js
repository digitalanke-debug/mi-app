import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db/knex.js'
import { requireAdmin, requireCompany } from '../auth.js'

export const companiesRouter = Router()

companiesRouter.post('/', requireAdmin, async (req, res) => {
  const { name, slug, color, sector, description } = req.body
  if (!name) return res.status(400).json({ error: 'Falta el nombre' })
  const s = (slug || name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const [row] = await db('companies').insert({ name, slug: s, color: color || '#2563eb', sector, description }).returning('id')
  const id = row.id ?? row
  await db('company_users').insert({ company_id: id, user_id: req.user.id }).onConflict().ignore()
  const [p] = await db('pipelines').insert({ company_id: id, name: 'Ventas', is_default: true }).returning('id')
  const pid = p.id ?? p
  const stages = ['Nuevo', 'Contactado', 'Calificado', 'Propuesta', 'Ganado', 'Perdido']
  await db('pipeline_stages').insert(stages.map((n, i) => ({ pipeline_id: pid, name: n, position: i, is_won: n === 'Ganado', is_lost: n === 'Perdido' })))
  await db('ai_settings').insert({ company_id: id, agent_name: `Asistente ${name}` })
  res.json(await db('companies').where({ id }).first())
})

companiesRouter.patch('/:companyId', requireCompany, requireAdmin, async (req, res) => {
  const { name, color, sector, description, business_hours, timezone } = req.body
  await db('companies').where({ id: req.companyId }).update({ name, color, sector, description, business_hours, timezone })
  res.json(await db('companies').where({ id: req.companyId }).first())
})

// Equipo
companiesRouter.get('/:companyId/users', requireCompany, async (req, res) => {
  const users = await db('company_users as cu').join('users as u', 'u.id', 'cu.user_id').where('cu.company_id', req.companyId)
    .select('u.id', 'u.name', 'u.email', 'u.role', 'u.active')
  res.json(users)
})

companiesRouter.get('/all-users', requireAdmin, async (req, res) => {
  const users = await db('users').select('id', 'name', 'email', 'role', 'active').orderBy('name')
  const memberships = await db('company_users')
  res.json(users.map((u) => ({ ...u, company_ids: memberships.filter((m) => m.user_id === u.id).map((m) => m.company_id) })))
})

companiesRouter.post('/users', requireAdmin, async (req, res) => {
  const { name, email, password, role, company_ids = [] } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, correo y contraseña son obligatorios' })
  const [row] = await db('users').insert({ name, email: email.toLowerCase().trim(), password_hash: await bcrypt.hash(password, 10), role: role === 'admin' ? 'admin' : 'agent' }).returning('id')
  const id = row.id ?? row
  if (company_ids.length) await db('company_users').insert(company_ids.map((c) => ({ company_id: c, user_id: id })))
  res.json({ id })
})

companiesRouter.patch('/users/:id', requireAdmin, async (req, res) => {
  const { name, role, active, company_ids, password } = req.body
  const patch = {}
  if (name !== undefined) patch.name = name
  if (role !== undefined) patch.role = role
  if (active !== undefined) patch.active = !!active
  if (password) patch.password_hash = await bcrypt.hash(password, 10)
  if (Object.keys(patch).length) await db('users').where({ id: req.params.id }).update(patch)
  if (Array.isArray(company_ids)) {
    await db('company_users').where({ user_id: req.params.id }).del()
    if (company_ids.length) await db('company_users').insert(company_ids.map((c) => ({ company_id: c, user_id: Number(req.params.id) })))
  }
  res.json({ ok: true })
})
