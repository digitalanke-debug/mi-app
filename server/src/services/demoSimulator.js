import { db } from '../db/knex.js'
import { handleInbound } from './inbound.js'

/**
 * Simulador para la DEMO: cada cierto tiempo crea un lead nuevo o hace que un
 * cliente existente conteste, en las instancias demo conectadas.
 */
const LEADS = [
  ['Ricardo Salazar', 'Hola, vi su anuncio en Google, quiero información [GA-BUSQUEDA-MARCA]'],
  ['Mónica Vargas', 'Buenas tardes, ¿cuánto cuesta la asesoría?'],
  ['Julián Ospina', 'Hola, me recomendó un amigo [REF-CARLOS]'],
  ['Sandra Quintero', 'Vi el anuncio en Instagram, quiero saber más [IG-LEADS-SEPT]'],
  ['Esteban Mejía', 'Buenos días, necesito hablar con un asesor'],
  ['Claudia Rincón', 'Hola, ¿ustedes atienden en Medellín?'],
]
const REPLIES = ['Gracias, quedo atento', '¿Me pueden llamar mañana en la mañana?', 'Listo, ¿qué documentos necesito?', 'Ok, ¿cuánto vale?', 'Perfecto, muchas gracias']

let timer = null
let phoneSeq = 900

export async function simulateNewLead(instanceId) {
  const inst = await db('whatsapp_instances').where({ id: instanceId }).first()
  if (!inst) throw new Error('Instancia no existe')
  const [name, body] = LEADS[Math.floor(Math.random() * LEADS.length)]
  phoneSeq++
  return handleInbound(inst, { phone: `5731${String(1000000 + phoneSeq * 613).slice(-7)}`, name, body })
}

export async function simulateReply(conversationId, text) {
  const conv = await db('conversations').where({ id: conversationId }).first()
  const inst = await db('whatsapp_instances').where({ id: conv.instance_id }).first()
  const contact = await db('contacts').where({ id: conv.contact_id }).first()
  return handleInbound(inst, { phone: contact.phone, name: contact.name, body: text || REPLIES[Math.floor(Math.random() * REPLIES.length)] })
}

export function startDemoSimulator({ everyMs = 90_000 } = {}) {
  stopDemoSimulator()
  timer = setInterval(async () => {
    try {
      const insts = await db('whatsapp_instances').where({ provider: 'demo', status: 'connected' })
      if (!insts.length) return
      const inst = insts[Math.floor(Math.random() * insts.length)]
      if (Math.random() < 0.5) return simulateNewLead(inst.id)
      const conv = await db('conversations').where({ instance_id: inst.id, status: 'open' }).orderByRaw('RANDOM()').first()
      if (conv) return simulateReply(conv.id)
    } catch (e) { console.error('Simulador demo:', e.message) }
  }, everyMs)
  return timer
}

export function stopDemoSimulator() { if (timer) clearInterval(timer); timer = null }
export const simulatorRunning = () => !!timer
