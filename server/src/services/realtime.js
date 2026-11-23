import { Server } from 'socket.io'
import { verifyToken, userCompanyIds } from '../auth.js'
import { db } from '../db/knex.js'

let io = null

export function initRealtime(httpServer, origin) {
  io = new Server(httpServer, { cors: { origin, credentials: true } })
  io.use(async (socket, next) => {
    const payload = verifyToken(socket.handshake.auth?.token)
    if (!payload) return next(new Error('No autenticado'))
    const user = await db('users').where({ id: payload.sub }).first()
    if (!user) return next(new Error('Usuario no existe'))
    socket.user = user
    socket.data.user = { id: user.id, name: user.name }
    const ids = await userCompanyIds(user)
    ids.forEach((id) => socket.join(`company:${id}`))
    socket.join(`user:${user.id}`)
    next()
  })
  io.on('connection', (socket) => {
    // Configuración de avisos del navegador de cada usuario (para la pantalla Revisión)
    socket.on('prefs', (p = {}) => { socket.data.prefs = { notify: !!p.notify, sound: !!p.sound, permission: String(p.permission || 'unsupported').slice(0, 12) } })
    socket.on('typing', ({ conversationId, companyId }) => {
      socket.to(`company:${companyId}`).emit('typing', { conversationId, user: socket.user.name })
    })
  })
  return io
}

export function emitCompany(companyId, event, payload) {
  io?.to(`company:${companyId}`).emit(event, payload)
}

export function emitUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload)
}

/** Usuarios conectados ahora a una empresa, con la configuración de avisos de su navegador */
export async function onlineUsers(companyId) {
  if (!io) return []
  const out = new Map()
  for (const s of await io.in(`company:${companyId}`).fetchSockets()) {
    const u = s.data.user
    if (!u) continue
    const cur = out.get(u.id) || { id: u.id, name: u.name, sessions: 0, prefs: [] }
    cur.sessions++
    if (s.data.prefs) cur.prefs.push(s.data.prefs)
    out.set(u.id, cur)
  }
  return [...out.values()]
}
