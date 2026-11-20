import { db } from '../db/knex.js'
import { emitCompany } from './realtime.js'
import { fillVars, isOutsideHours } from './businessHours.js'
import { sendOutbound, addTagByName, moveToStageByName, logActivity, broadcastConversation } from './conversations.js'

/**
 * Menú de bienvenida: el CRM envía opciones numeradas, el cliente responde con un número (o una palabra clave)
 * y recibe la respuesta guardada de esa opción. Se guarda el servicio de interés para medir qué trae cada anuncio.
 */

const MENU_TTL_MS = 24 * 3600_000
const WORDS = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 }
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/️|⃣/g, '').trim()
const parse = (s) => { try { return s ? JSON.parse(s) : null } catch { return null } }

export const DEFAULT_AFTER_HOURS = '🌙 En este momento estamos fuera de horario, pero puede elegir una opción y dejarnos su consulta: un asesor le escribe {{cuando}}.'

/** Texto del menú; fuera de horario agrega el aviso al final (así no llega un segundo mensaje) */
export function menuText(a, { outside = false } = {}) {
  return [a.intro?.trim(), (a.options || []).map((o, i) => `${i + 1}. ${o.label}`).join('\n'), outside ? (a.after_hours?.trim() || DEFAULT_AFTER_HOURS) : null].filter(Boolean).join('\n\n')
}

/** Opción elegida a partir del texto del cliente, o null */
export function matchMenuOption(text, options = []) {
  const t = norm(text)
  if (!t || !options.length) return null
  // "1", "1.", "1)", "opción 2", "la 3", "1️⃣": solo en mensajes cortos, para no confundir números de teléfono o edades
  if (t.length <= 20) {
    const m = t.match(/(?:^|\D)(\d{1,2})(?!\d)/)
    const n = m ? Number(m[1]) : Object.entries(WORDS).find(([w]) => new RegExp(`(^|\\s)${w}(\\s|$)`).test(t))?.[1]
    if (n >= 1 && n <= options.length) return { option: options[n - 1], index: n - 1 }
  }
  // Palabras clave de cada opción ("traslado", "sobrevivientes"…)
  for (const [i, o] of options.entries()) {
    const kws = String(o.keywords || '').split(',').map(norm).filter((k) => k.length >= 3)
    if (kws.some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t))) return { option: o, index: i }
  }
  return null
}

/** Envía el menú y deja la conversación esperando la respuesta */
export async function sendMenu(conversationId, a, company) {
  if (!a?.options?.length) return
  const outside = !!company && isOutsideHours(company)
  await sendOutbound(conversationId, { body: fillVars(menuText(a, { outside }), company), senderType: 'bot' })
  if (outside) await logActivity(company.id, conversationId, 'outside_hours.notice', { via: 'menu' })
  const state = { options: a.options, retry: a.retry || '', sent_at: new Date().toISOString(), tries: 0 }
  await db('conversations').where({ id: conversationId }).update({ menu_state: JSON.stringify(state) })
}

/**
 * Procesa un mensaje del cliente cuando la conversación espera una opción del menú.
 * Devuelve la opción elegida, o null.
 */
export async function handleMenuReply(conv, message) {
  const state = parse(conv.menu_state)
  if (!state) return null
  const clear = () => db('conversations').where({ id: conv.id }).update({ menu_state: null })
  if (Date.now() - new Date(state.sent_at).getTime() > MENU_TTL_MS || message.type !== 'text') { await clear(); return null }
  const hit = matchMenuOption(message.body, state.options)
  if (!hit) {
    // Un solo recordatorio; si vuelve a escribir otra cosa, lo atiende el asesor
    if (!state.tries) {
      await db('conversations').where({ id: conv.id }).update({ menu_state: JSON.stringify({ ...state, tries: 1 }) })
      await sendOutbound(conv.id, { body: fillVars(state.retry, null) || `Para ubicar su caso, responda solo con el número de la opción (1 a ${state.options.length}).`, senderType: 'bot' })
    } else {
      await clear()
      await logActivity(conv.company_id, conv.id, 'menu.skip', {})
    }
    return null
  }
  const o = hit.option
  await clear()
  const company = await db('companies').where({ id: conv.company_id }).first()
  if (o.reply?.trim()) await sendOutbound(conv.id, { body: fillVars(o.reply, company), senderType: 'bot' })
  if (o.service?.trim()) await db('conversations').where({ id: conv.id }).update({ service: o.service.trim() })
  if (o.tag) await addTagByName(conv.id, conv.company_id, o.tag)
  if (o.stage) await moveToStageByName(conv.id, conv.company_id, o.stage)
  if (o.notify) emitCompany(conv.company_id, 'notification', { conversation_id: conv.id, body: `Un cliente eligió "${o.label}" en el menú de bienvenida` })
  await logActivity(conv.company_id, conv.id, 'menu.option', { option: hit.index + 1, label: o.label, service: o.service || null })
  await broadcastConversation(conv.id)
  return o
}
