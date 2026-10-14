import { daysUntil } from './format.js'

export function invoiceTotal(inv) {
  return (inv.items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0)
}

export function invoicePaid(inv) {
  return (inv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)
}

export function invoiceBalance(inv) {
  return Math.max(0, invoiceTotal(inv) - invoicePaid(inv))
}

/** Estado derivado: pagada | parcial | vencida | pendiente */
export function invoiceStatus(inv) {
  const total = invoiceTotal(inv)
  const paid = invoicePaid(inv)
  if (total > 0 && paid >= total) return 'pagada'
  if (daysUntil(inv.dueDate) < 0) return 'vencida'
  if (paid > 0) return 'parcial'
  return 'pendiente'
}

export const STATUS_LABEL = {
  pagada: 'Pagada',
  parcial: 'Abono parcial',
  vencida: 'Vencida',
  pendiente: 'Pendiente',
}

/** Antigüedad de cartera: agrupa saldos pendientes por tramo de días vencidos */
export function agingBuckets(invoices) {
  const buckets = {
    alDia: 0,
    d1a30: 0,
    d31a60: 0,
    d61a90: 0,
    mas90: 0,
  }
  for (const inv of invoices) {
    const bal = invoiceBalance(inv)
    if (bal <= 0) continue
    const overdue = -daysUntil(inv.dueDate)
    if (overdue <= 0) buckets.alDia += bal
    else if (overdue <= 30) buckets.d1a30 += bal
    else if (overdue <= 60) buckets.d31a60 += bal
    else if (overdue <= 90) buckets.d61a90 += bal
    else buckets.mas90 += bal
  }
  return buckets
}

export function clientBalance(invoices, clientId) {
  return invoices
    .filter((i) => i.clientId === clientId)
    .reduce((s, i) => s + invoiceBalance(i), 0)
}

export function clientOverdue(invoices, clientId) {
  return invoices
    .filter((i) => i.clientId === clientId && invoiceStatus(i) === 'vencida')
    .reduce((s, i) => s + invoiceBalance(i), 0)
}
