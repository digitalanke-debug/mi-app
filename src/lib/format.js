// Utilidades de formato para Colombia (COP, fechas es-CO)

const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

export function cop(value) {
  const n = Number(value) || 0
  return copFormatter.format(n)
}

export function parseMoney(text) {
  if (typeof text === 'number') return text
  const digits = String(text ?? '').replace(/[^\d-]/g, '')
  return digits ? Number(digits) : 0
}

export function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysISO(iso, days) {
  const d = parseISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function toISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function daysBetween(fromISO, toISOValue) {
  const a = parseISO(fromISO)
  const b = parseISO(toISOValue)
  return Math.round((b - a) / 86400000)
}

export function daysUntil(iso) {
  return daysBetween(todayISO(), iso)
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function fmtDate(iso) {
  if (!iso) return ''
  const d = parseISO(iso)
  return `${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`
}

export function fmtDateShort(iso) {
  if (!iso) return ''
  const d = parseISO(iso)
  return `${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]}`
}

export function monthKey(iso) {
  return String(iso).slice(0, 7)
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function relativeDue(iso) {
  const d = daysUntil(iso)
  if (d < 0) return `Vencido hace ${Math.abs(d)} día${Math.abs(d) === 1 ? '' : 's'}`
  if (d === 0) return 'Vence hoy'
  if (d === 1) return 'Vence mañana'
  return `Vence en ${d} días`
}
