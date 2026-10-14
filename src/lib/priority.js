import { daysUntil } from './format.js'

export const PRIORITY = {
  alta: { label: 'Alta', order: 0 },
  media: { label: 'Media', order: 1 },
  baja: { label: 'Baja', order: 2 },
}

/**
 * Calcula la prioridad de una cuenta por pagar.
 * Regla:
 *  - Alta: vencida o vence en 7 días o menos, genera intereses/mora,
 *          o corta el servicio y vence en 15 días o menos.
 *  - Media: vence entre 8 y 20 días.
 *  - Baja: el resto.
 * Si la administrativa fijó una prioridad manual, esa manda.
 */
export function computePriority(expense) {
  if (expense.manualPriority) return expense.manualPriority
  const d = daysUntil(expense.dueDate)
  if (d <= 7) return 'alta'
  if (expense.hasInterest) return 'alta'
  if (expense.cutsService && d <= 15) return 'alta'
  if (d <= 20) return 'media'
  return 'baja'
}

export function priorityReason(expense) {
  if (expense.manualPriority) return 'Prioridad fijada manualmente'
  const d = daysUntil(expense.dueDate)
  if (d < 0) return 'Ya está vencida'
  if (d <= 7) return 'Vence en 7 días o menos'
  if (expense.hasInterest) return 'Genera intereses de mora'
  if (expense.cutsService && d <= 15) return 'Cortan el servicio y vence pronto'
  if (d <= 20) return 'Vence en menos de 20 días'
  return 'Hay tiempo'
}

export function sortByPriority(expenses) {
  return [...expenses].sort((a, b) => {
    const pa = PRIORITY[computePriority(a)].order
    const pb = PRIORITY[computePriority(b)].order
    if (pa !== pb) return pa - pb
    return a.dueDate.localeCompare(b.dueDate)
  })
}
