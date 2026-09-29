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
    const ids = await userCompanyIds(user)
    ids.forEach((id) => socket.join(`company:${id}`))
    socket.join(`user:${user.id}`)
    next()
  })
  io.on('connection', (socket) => {
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
