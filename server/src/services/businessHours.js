/**
 * Horario de atención de cada empresa (companies.business_hours "08:00-18:00", lunes a viernes, en su zona horaria)
 * y textos que dependen de él para las respuestas automáticas.
 */

function nowParts(company) {
  const tz = company?.timezone || 'America/Bogota'
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]))
  const hour = p.hour === '24' ? '00' : p.hour
  return { day: p.weekday, hhmm: `${hour}:${p.minute}` }
}
const range = (company) => { const [start = '08:00', end = '18:00'] = String(company?.business_hours || '08:00-18:00').split('-'); return { start, end } }
const weekend = (day) => day === 'Sat' || day === 'Sun'

/** "08:00" -> "8:00 a.m.", "18:30" -> "6:30 p.m." */
export function formatHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`
}

export function isOutsideHours(company) {
  const { day, hhmm } = nowParts(company)
  const { start, end } = range(company)
  return weekend(day) || hhmm < start || hhmm >= end
}

/** Cuándo responde un asesor: "en breve", "hoy a partir de las 8:00 a.m.", "mañana a primera hora", "el lunes a primera hora" */
export function whenText(company) {
  const { day, hhmm } = nowParts(company)
  const { start, end } = range(company)
  if (weekend(day) || (day === 'Fri' && hhmm >= end)) return 'el lunes a primera hora'
  if (hhmm < start) return `hoy a partir de las ${formatHour(start)}`
  if (hhmm >= end) return 'mañana a primera hora'
  return 'en breve'
}

export const hoursText = (company) => { const { start, end } = range(company); return `lunes a viernes de ${formatHour(start)} a ${formatHour(end)}` }

/** Variables de las respuestas automáticas: {{cuando}}, {{horario}}, {{empresa}} */
export function fillVars(text, company) {
  return String(text || '')
    .replace(/\{\{\s*cuando\s*\}\}/gi, () => whenText(company))
    .replace(/\{\{\s*horario\s*\}\}/gi, () => hoursText(company))
    .replace(/\{\{\s*empresa\s*\}\}/gi, () => company?.name || '')
}
