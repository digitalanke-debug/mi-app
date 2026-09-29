import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { db } from '../db/knex.js'

const client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null

const HANDOFF_TOOL = {
  name: 'entregar_a_humano',
  description: 'Úsala cuando el cliente pida hablar con una persona, cuando la consulta requiera un asesor (precios exactos, casos legales complejos, quejas) o cuando ya tengas los datos para agendar. Después de llamarla, despídete brevemente indicando que un asesor continuará.',
  input_schema: {
    type: 'object',
    properties: {
      motivo: { type: 'string', description: 'Por qué se entrega al asesor' },
      resumen: { type: 'string', description: 'Resumen del caso para el asesor: nombre, ciudad, servicio de interés y necesidad' },
    },
    required: ['motivo', 'resumen'],
    additionalProperties: false,
  },
  strict: true,
}

function buildSystem(company, settings) {
  return [
    settings.instructions || `Eres el asistente virtual de ${company.name}.`,
    '',
    'Reglas:',
    '- Responde en máximo 3 frases cortas, como un mensaje de WhatsApp. Sin listas largas ni formato Markdown.',
    '- Haz una sola pregunta por mensaje para calificar el lead.',
    '- Nunca inventes precios, plazos legales ni resultados garantizados.',
    '- Si no sabes algo o el cliente pide un humano, usa la herramienta entregar_a_humano.',
    '',
    `Información de la empresa (${company.name}, ${company.sector || ''}):`,
    company.description || '',
    settings.knowledge || '',
  ].join('\n')
}

/** Respuesta demo sin API key: reglas simples para que la demo funcione sin costo */
function demoReply(text, company, settings) {
  const t = text.toLowerCase()
  if (/(humano|asesor|persona|llamar|llamada)/.test(t)) return { text: 'Claro, ya le paso tu caso a un asesor para que te contacte en breve. 🙌', handoff: { motivo: 'El cliente pidió un asesor', resumen: `Cliente solicita asesor. Mensaje: "${text}"` } }
  if (/(precio|costo|valor|cu[aá]nto)/.test(t)) return { text: 'La primera consulta de 20 minutos no tiene costo. El valor del servicio depende de tu caso, un asesor te lo confirma. ¿Me cuentas en qué ciudad estás?', handoff: null }
  if (/(horario|hora|atienden)/.test(t)) return { text: 'Atendemos de lunes a viernes de 8:00 a.m. a 6:00 p.m., de forma virtual en toda Colombia. ¿Qué servicio te interesa?', handoff: null }
  if (/(hola|buen[oa]s)/.test(t) && t.length < 30) return { text: `¡Hola! Soy ${settings.agent_name || 'el asistente'} de ${company.name}. ¿En qué te puedo ayudar hoy?`, handoff: null }
  return { text: `Entiendo. Para orientarte mejor, ¿me confirmas tu nombre y el servicio que te interesa? Así agendamos una llamada sin costo con un asesor de ${company.name}.`, handoff: null }
}

/**
 * Genera la respuesta del agente para una conversación.
 * Devuelve { text, handoff: {motivo, resumen} | null, model, demo }
 */
export async function agentReply(conversationId) {
  const conv = await db('conversations').where({ id: conversationId }).first()
  const company = await db('companies').where({ id: conv.company_id }).first()
  const settings = (await db('ai_settings').where({ company_id: conv.company_id }).first()) || {}
  const history = await db('messages').where({ conversation_id: conversationId }).whereIn('sender_type', ['contact', 'user', 'bot'])
    .orderBy('created_at', 'asc').limit(30)
  const lastIn = [...history].reverse().find((m) => m.direction === 'in')
  if (!lastIn) return null

  if (!client) return { ...demoReply(lastIn.body || '', company, settings), model: 'demo', demo: true }

  // Historial de WhatsApp -> turnos user/assistant (los del asesor humano van como assistant con prefijo)
  const messages = []
  for (const m of history) {
    const role = m.direction === 'in' ? 'user' : 'assistant'
    const text = m.sender_type === 'user' ? `[Asesor humano]: ${m.body}` : (m.body || '')
    if (!text.trim()) continue
    if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += `\n${text}`
    else messages.push({ role, content: text })
  }
  if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(inicio de conversación)' })
  if (messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: '(continúa)' })

  const model = settings.model || 'claude-opus-5-5'
  const response = await client.beta.messages.create({
    model,
    max_tokens: 1024,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: buildSystem(company, settings), cache_control: { type: 'ephemeral' } }],
    tools: [HANDOFF_TOOL],
    messages,
  })

  if (response.stop_reason === 'refusal') return { text: 'Voy a pasar tu consulta a un asesor para ayudarte mejor.', handoff: { motivo: 'El modelo declinó responder', resumen: lastIn.body }, model, demo: false }

  let text = ''
  let handoff = null
  for (const block of response.content) {
    if (block.type === 'text') text += block.text
    if (block.type === 'tool_use' && block.name === 'entregar_a_humano') handoff = block.input
  }
  if (!text.trim() && handoff) text = 'Perfecto, un asesor continuará contigo en breve. 🙌'
  return { text: text.trim(), handoff, model: response.model || model, demo: false }
}

export const aiAvailable = () => !!client
