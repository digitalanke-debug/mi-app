import { db } from '../db/knex.js'

const STAGES = [
  ['Nuevo', '#64748b'], ['Contactado', '#0ea5e9'], ['Calificado', '#8b5cf6'], ['Propuesta', '#f59e0b'],
  ['Ganado', '#16a34a', { is_won: true }], ['Perdido', '#dc2626', { is_lost: true }],
]
const TAGS = [['Caliente', '#dc2626'], ['Tibio', '#f59e0b'], ['Frío', '#0ea5e9'], ['Google Ads', '#2563eb'], ['Meta Ads', '#7c3aed'], ['Referido', '#16a34a'], ['Sin respuesta', '#64748b']]

/** Configuración inicial de una empresa nueva: pipeline, etiquetas, respuestas rápidas, automatizaciones y agente IA (apagado) */
export async function applyCompanyDefaults(company) {
  const id = company.id
  const name = company.name
  const [p] = await db('pipelines').insert({ company_id: id, name: 'Ventas', is_default: true }).returning('id')
  const pid = p.id ?? p
  await db('pipeline_stages').insert(STAGES.map(([n, color, extra], i) => ({ pipeline_id: pid, name: n, color, position: i, is_won: !!extra?.is_won, is_lost: !!extra?.is_lost })))
  await db('tags').insert(TAGS.map(([n, color]) => ({ company_id: id, name: n, color })))
  await db('quick_replies').insert([
    { company_id: id, shortcut: 'saludo', body: `¡Hola {{nombre}}! Gracias por escribir a ${name}. Soy {{agente}}, ¿en qué te puedo ayudar?` },
    { company_id: id, shortcut: 'horario', body: 'Nuestro horario de atención es de lunes a viernes de 8:00 a.m. a 6:00 p.m.' },
    { company_id: id, shortcut: 'cita', body: '¿Te parece si agendamos una llamada? Dime qué día y hora te queda bien.' },
    { company_id: id, shortcut: 'docs', body: 'Para avanzar necesito que me envíes por aquí: cédula y los documentos relacionados con tu caso.' },
  ])
  const A = (o) => ({ company_id: id, enabled: true, conditions: '{}', ...o, actions: JSON.stringify(o.actions), conditions: JSON.stringify(o.conditions || {}) })
  await db('automations').insert([
    A({ name: 'Bienvenida automática', trigger: 'new_conversation', actions: [{ type: 'reply', body: `¡Hola! Bienvenido a ${name} 👋. En un momento uno de nuestros asesores te atenderá. Mientras tanto, cuéntanos en qué te podemos ayudar.` }, { type: 'move_stage', stage_name: 'Nuevo' }] }),
    A({ name: 'Etiquetar leads de Google Ads', trigger: 'new_conversation', conditions: { source: 'google_ads' }, actions: [{ type: 'add_tag', tag_name: 'Google Ads' }] }),
    A({ name: 'Etiquetar leads de Meta Ads', trigger: 'new_conversation', conditions: { source: 'meta_ads' }, actions: [{ type: 'add_tag', tag_name: 'Meta Ads' }] }),
    A({ name: 'Asignación automática (round robin)', trigger: 'new_conversation', actions: [{ type: 'assign', mode: 'round_robin' }] }),
    A({ name: 'Palabra clave: precio', trigger: 'keyword', conditions: { keywords: ['precio', 'costo', 'cuánto vale', 'cuanto vale', 'valor'] }, actions: [{ type: 'add_tag', tag_name: 'Caliente' }, { type: 'move_stage', stage_name: 'Calificado' }] }),
    A({ name: 'Fuera de horario', trigger: 'outside_hours', actions: [{ type: 'reply', body: 'Gracias por escribirnos. En este momento estamos fuera de horario (L-V 8am a 6pm). Te responderemos a primera hora. 🙌' }] }),
    A({ name: 'Sin respuesta 2 horas', trigger: 'inactivity', conditions: { minutes: 120, who: 'us' }, actions: [{ type: 'add_tag', tag_name: 'Sin respuesta' }, { type: 'notify', body: 'Lead lleva más de 2 horas sin respuesta' }] }),
    A({ name: 'Agente IA responde primero', trigger: 'message_in', enabled: false, conditions: { ai_only_when_no_human_reply_minutes: 3 }, actions: [{ type: 'ai_reply' }] }),
  ])
  await db('ai_settings').insert({ company_id: id, enabled: false, agent_name: `Asistente ${name}`,
    instructions: `Eres el asistente virtual de ${name}. Responde en español colombiano, de forma cálida, breve y profesional. Entiende la necesidad del cliente, pide su nombre y ciudad, y ofrece agendar con un asesor. No inventes precios ni promesas legales.`,
    knowledge: 'Horario: lunes a viernes 8:00 a.m. a 6:00 p.m.' }).onConflict('company_id').ignore()
}
