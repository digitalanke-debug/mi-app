import { monthKey, todayISO } from './format.js'
import { invoiceTotal, invoiceBalance } from './invoices.js'

const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0)

function groupSum(items, keyFn, amountFn) {
  const out = {}
  for (const it of items) {
    for (const k of keyFn(it)) out[k] = (out[k] || 0) + amountFn(it)
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([nombre, valor]) => ({ nombre, valor }))
}

/**
 * Informe mensual de una empresa (o consolidado con companyId = 'all').
 * month: 'AAAA-MM'. Todo en pesos.
 */
export function monthlyReport(state, companyId = 'all', month = monthKey(todayISO())) {
  const inScope = (x) => companyId === 'all' || x.companyId === companyId
  const invoices = state.invoices.filter(inScope)
  const expenses = state.expenses.filter(inScope)
  const accounts = state.accounts.filter(inScope)
  const accountIds = new Set(accounts.map((a) => a.id))
  const movements = state.cash.movements.filter((m) => accountIds.has(m.accountId))
  const clientName = (id) => state.clients.find((c) => c.id === id)?.name ?? 'Cliente'

  const facturas = invoices.filter((i) => monthKey(i.issueDate) === month)
  const facturado = sum(facturas, invoiceTotal)
  const honorarios = sum(facturas, (i) => sum(i.items.filter((it) => it.kind === 'honorarios'), (it) => it.amount))
  const gastosReembolsables = facturado - honorarios

  const pagos = invoices.flatMap((i) => (i.payments || []).filter((p) => monthKey(p.date) === month).map((p) => ({ ...p, clientId: i.clientId, number: i.number })))
  const cobrado = sum(pagos, (p) => p.amount)

  const gastosPagados = expenses.filter((e) => e.status === 'pagado' && monthKey(e.paidAt || e.dueDate) === month)
  const gastosPendientes = expenses.filter((e) => e.status !== 'pagado' && monthKey(e.dueDate) === month)
  const totalGastosPagados = sum(gastosPagados, (e) => e.amount)
  const totalGastosPendientes = sum(gastosPendientes, (e) => e.amount)

  const otrosEgresos = movements.filter((m) => m.type === 'egreso' && !m.ref && monthKey(m.date) === month)
  const otrosIngresos = movements.filter((m) => m.type === 'ingreso' && !m.ref && monthKey(m.date) === month)
  const totalOtrosEgresos = sum(otrosEgresos, (m) => m.amount)
  const totalOtrosIngresos = sum(otrosIngresos, (m) => m.amount)

  const gastosDelMes = [...gastosPagados, ...gastosPendientes]
  const porCategoria = groupSum(gastosDelMes, (e) => [e.category || 'Sin categoría'], (e) => e.amount)
  const porEtiqueta = groupSum(gastosDelMes, (e) => (e.tags?.length ? e.tags : ['Sin etiqueta']), (e) => e.amount)
  const porCliente = groupSum(facturas, (i) => [clientName(i.clientId)], invoiceTotal)
  const cobrosPorCliente = groupSum(pagos, (p) => [clientName(p.clientId)], (p) => p.amount)

  const porEmpresa = companyId === 'all'
    ? state.companies.filter((c) => c.active).map((c) => {
        const r = monthlyReport(state, c.id, month)
        return { empresaId: c.id, empresa: c.name, facturado: r.facturado, cobrado: r.cobrado, gastosPagados: r.totalGastosPagados, gastosPendientes: r.totalGastosPendientes, resultado: r.resultado }
      })
    : null

  const carteraPendiente = sum(invoices, invoiceBalance)

  return {
    month,
    facturado, honorarios, gastosReembolsables, facturas: facturas.length,
    cobrado, pagos: pagos.length,
    totalGastosPagados, totalGastosPendientes, totalOtrosEgresos, totalOtrosIngresos,
    resultado: cobrado + totalOtrosIngresos - totalGastosPagados - totalOtrosEgresos,
    carteraPendiente,
    porCategoria, porEtiqueta, porCliente, cobrosPorCliente, porEmpresa,
    gastosPagados, gastosPendientes,
  }
}

/** Últimos N meses como 'AAAA-MM' (el actual primero) */
export function lastMonths(n = 12) {
  const out = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number)
  const nombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${nombres[m - 1]} ${y}`
}
