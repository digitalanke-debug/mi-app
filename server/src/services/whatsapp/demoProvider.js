import QRCode from 'qrcode'
import { db, now } from '../../db/knex.js'
import { emitCompany } from '../realtime.js'

/**
 * Proveedor DEMO: simula el flujo de WhatsApp Business por QR sin conectar
 * ningún teléfono. Genera un QR de prueba, se "conecta" a los pocos segundos
 * y simula respuestas del cliente para poder probar la bandeja en vivo.
 */
const timers = new Map()

async function updateInstance(id, patch) {
  await db('whatsapp_instances').where({ id }).update(patch)
  const inst = await db('whatsapp_instances').where({ id }).first()
  emitCompany(inst.company_id, 'instance:update', inst)
  return inst
}

export const demoProvider = {
  name: 'demo',

  async createInstance(inst) { return inst },

  async connect(inst) {
    const qr = await QRCode.toDataURL(`DEMO-WHATSAPP-${inst.instance_key}-${Date.now()}`, { width: 260, margin: 1 })
    await updateInstance(inst.id, { status: 'qr', qr_code: qr })
    clearTimeout(timers.get(inst.id))
    timers.set(inst.id, setTimeout(async () => {
      await updateInstance(inst.id, { status: 'connecting', qr_code: null })
      timers.set(inst.id, setTimeout(() => updateInstance(inst.id, { status: 'connected', connected_at: now(), qr_code: null }), 1500))
    }, 7000))
    return { qr }
  },

  async disconnect(inst) {
    clearTimeout(timers.get(inst.id))
    await updateInstance(inst.id, { status: 'disconnected', qr_code: null, connected_at: null })
  },

  async status(inst) { return inst.status },

  async sendMedia() { return { id: `demo-${Date.now()}` } },
  async fetchMediaBase64() { return null },

  async sendText(inst, phone, body) {
    return { id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
  },
}
