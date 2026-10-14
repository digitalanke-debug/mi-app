import { monthKey, todayISO, uid } from '../lib/format.js'

export function cashBalance(state) {
  return state.cash.movements.reduce((s, m) => {
    if (m.type === 'ingreso' || m.type === 'ajuste') return s + m.amount
    if (m.type === 'egreso') return s - m.amount
    return s
  }, 0)
}

/**
 * Genera las cuentas por pagar del mes actual y del siguiente a partir de
 * los gastos fijos recurrentes que aún no tengan registro para ese periodo.
 */
export function generateRecurring(state, today = todayISO()) {
  const [y, m] = today.split('-').map(Number)
  const periods = [
    { y, m },
    m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 },
  ]
  const existing = new Set(
    state.expenses.filter((e) => e.recurringId).map((e) => `${e.recurringId}|${e.period}`),
  )
  const nuevos = []
  for (const rec of state.recurring) {
    if (!rec.active) continue
    for (const p of periods) {
      const period = `${p.y}-${String(p.m).padStart(2, '0')}`
      if (existing.has(`${rec.id}|${period}`)) continue
      const lastDay = new Date(p.y, p.m, 0).getDate()
      const day = Math.min(rec.dayOfMonth, lastDay)
      const dueDate = `${period}-${String(day).padStart(2, '0')}`
      // No generar el periodo actual si su fecha ya pasó hace más de 45 días (evita ruido al crear reglas viejas)
      nuevos.push({
        id: uid('exp'),
        concept: rec.concept,
        supplier: rec.supplier,
        category: rec.category,
        amount: rec.amount,
        dueDate,
        status: 'pendiente',
        manualPriority: null,
        cutsService: !!rec.cutsService,
        hasInterest: false,
        recurringId: rec.id,
        period,
        notes: '',
      })
    }
  }
  if (!nuevos.length) return state
  return { ...state, expenses: [...state.expenses, ...nuevos] }
}

export function reducer(state, action) {
  switch (action.type) {
    case 'replace':
      return action.state

    // ---------- Clientes ----------
    case 'client/add':
      return { ...state, clients: [...state.clients, { id: uid('cli'), ...action.client }] }
    case 'client/update':
      return {
        ...state,
        clients: state.clients.map((c) => (c.id === action.id ? { ...c, ...action.client } : c)),
      }
    case 'client/remove':
      return {
        ...state,
        clients: state.clients.filter((c) => c.id !== action.id),
        invoices: state.invoices.filter((i) => i.clientId !== action.id),
      }

    // ---------- Facturas / cuentas de cobro ----------
    case 'invoice/add': {
      const number = action.invoice.number || `CC-${new Date().getFullYear()}-${String(state.nextInvoiceNumber).padStart(3, '0')}`
      return {
        ...state,
        nextInvoiceNumber: state.nextInvoiceNumber + 1,
        invoices: [...state.invoices, { id: uid('inv'), payments: [], ...action.invoice, number }],
      }
    }
    case 'invoice/update':
      return {
        ...state,
        invoices: state.invoices.map((i) => (i.id === action.id ? { ...i, ...action.invoice } : i)),
      }
    case 'invoice/remove':
      return { ...state, invoices: state.invoices.filter((i) => i.id !== action.id) }
    case 'invoice/payment': {
      // Registra un abono y lo suma a la caja
      const inv = state.invoices.find((i) => i.id === action.id)
      if (!inv) return state
      const client = state.clients.find((c) => c.id === inv.clientId)
      const payment = { id: uid('pay'), date: action.date, amount: action.amount, note: action.note || '' }
      const movement = {
        id: uid('mov'),
        date: action.date,
        type: 'ingreso',
        amount: action.amount,
        description: `Pago ${client?.name ?? 'cliente'} - ${inv.number}`,
        ref: { kind: 'invoice', id: inv.id },
      }
      return {
        ...state,
        invoices: state.invoices.map((i) => (i.id === inv.id ? { ...i, payments: [...i.payments, payment] } : i)),
        cash: { ...state.cash, movements: [...state.cash.movements, movement] },
      }
    }

    // ---------- Cuentas por pagar ----------
    case 'expense/add':
      return {
        ...state,
        expenses: [
          ...state.expenses,
          { id: uid('exp'), status: 'pendiente', manualPriority: null, cutsService: false, hasInterest: false, notes: '', ...action.expense },
        ],
      }
    case 'expense/update':
      return {
        ...state,
        expenses: state.expenses.map((e) => (e.id === action.id ? { ...e, ...action.expense } : e)),
      }
    case 'expense/remove':
      return { ...state, expenses: state.expenses.filter((e) => e.id !== action.id) }
    case 'expense/pay': {
      // Marca una o varias cuentas como pagadas y descuenta de caja
      const ids = new Set(action.ids)
      const date = action.date || todayISO()
      const movements = []
      const expenses = state.expenses.map((e) => {
        if (!ids.has(e.id) || e.status === 'pagado') return e
        movements.push({
          id: uid('mov'),
          date,
          type: 'egreso',
          amount: e.amount,
          description: `Pago ${e.concept}${e.supplier ? ' - ' + e.supplier : ''}`,
          ref: { kind: 'expense', id: e.id },
        })
        return { ...e, status: 'pagado', paidAt: date }
      })
      return { ...state, expenses, cash: { ...state.cash, movements: [...state.cash.movements, ...movements] } }
    }
    case 'expense/unpay': {
      // Revierte un pago: vuelve a pendiente y quita el movimiento de caja
      return {
        ...state,
        expenses: state.expenses.map((e) => (e.id === action.id ? { ...e, status: 'pendiente', paidAt: undefined } : e)),
        cash: {
          ...state.cash,
          movements: state.cash.movements.filter((m) => !(m.ref?.kind === 'expense' && m.ref.id === action.id)),
        },
      }
    }

    // ---------- Gastos fijos recurrentes ----------
    case 'recurring/add':
      return generateRecurring({ ...state, recurring: [...state.recurring, { id: uid('rec'), active: true, ...action.rule }] })
    case 'recurring/update':
      return {
        ...state,
        recurring: state.recurring.map((r) => (r.id === action.id ? { ...r, ...action.rule } : r)),
      }
    case 'recurring/remove':
      return {
        ...state,
        recurring: state.recurring.filter((r) => r.id !== action.id),
        // Conserva lo ya pagado; elimina lo pendiente generado por la regla
        expenses: state.expenses.filter((e) => !(e.recurringId === action.id && e.status !== 'pagado')),
      }
    case 'recurring/generate':
      return generateRecurring(state)

    // ---------- Caja ----------
    case 'cash/movement':
      return {
        ...state,
        cash: {
          ...state.cash,
          movements: [...state.cash.movements, { id: uid('mov'), ref: null, ...action.movement }],
        },
      }
    case 'cash/remove':
      return { ...state, cash: { ...state.cash, movements: state.cash.movements.filter((m) => m.id !== action.id) } }
    case 'cash/setBalance': {
      // Crea un ajuste para que el saldo quede exactamente en el valor indicado
      const current = cashBalance(state)
      const diff = action.balance - current
      if (diff === 0) return state
      return {
        ...state,
        cash: {
          ...state.cash,
          movements: [
            ...state.cash.movements,
            { id: uid('mov'), date: todayISO(), type: 'ajuste', amount: diff, description: action.description || 'Ajuste de saldo', ref: null },
          ],
        },
      }
    }

    // ---------- Recordatorios ----------
    case 'reminder/add':
      return { ...state, reminders: [...state.reminders, { id: uid('rem'), ...action.reminder }] }

    // ---------- Configuración ----------
    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.settings } }

    default:
      return state
  }
}

export { monthKey }
