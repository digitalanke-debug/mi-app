import { monthKey, todayISO, uid } from '../lib/format.js'
import { migrateState, resolveCompanyId } from './migrate.js'
import { defaultAccountId, totals } from '../lib/accounts.js'

/** Saldo disponible consolidado (todas las cuentas activas que no son préstamo) */
export function cashBalance(state) {
  return totals(state).disponible
}

/**
 * Genera las cuentas por pagar del mes actual y del siguiente a partir de
 * los gastos fijos recurrentes que aún no tengan registro para ese periodo.
 */
export function generateRecurring(input, today = todayISO()) {
  const state = migrateState(input)
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
        tags: rec.tags || [],
        companyId: rec.companyId,
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
      return { ...state, clients: [...state.clients, { id: uid('cli'), ...action.client, companyId: resolveCompanyId(state, action.client?.companyId) }] }
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
      const client = state.clients.find((c) => c.id === action.invoice.clientId)
      const companyId = resolveCompanyId(state, action.invoice.companyId || client?.companyId)
      const company = state.companies.find((c) => c.id === companyId)
      const counters = { ...(state.counters || {}) }
      const n = counters[companyId] || 1
      const number = action.invoice.number || `${company?.prefix || 'CC'}-${new Date().getFullYear()}-${String(n).padStart(3, '0')}`
      if (!action.invoice.number) counters[companyId] = n + 1
      return {
        ...state,
        counters,
        invoices: [...state.invoices, { id: uid('inv'), payments: [], ...action.invoice, number, companyId }],
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
      const accountId = action.accountId || defaultAccountId(state, inv.companyId)
      const payment = { id: uid('pay'), date: action.date, amount: action.amount, note: action.note || '', accountId }
      const movement = {
        id: uid('mov'),
        date: action.date,
        type: 'ingreso',
        amount: action.amount,
        accountId,
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
          { id: uid('exp'), status: 'pendiente', manualPriority: null, cutsService: false, hasInterest: false, notes: '', tags: [], ...action.expense, companyId: resolveCompanyId(state, action.expense?.companyId) },
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
      const firstExpense = state.expenses.find((e) => ids.has(e.id))
      const accountId = action.accountId || defaultAccountId(state, firstExpense?.companyId)
      const movements = []
      const expenses = state.expenses.map((e) => {
        if (!ids.has(e.id) || e.status === 'pagado') return e
        movements.push({
          id: uid('mov'),
          date,
          type: 'egreso',
          amount: e.amount,
          accountId,
          description: `Pago ${e.concept}${e.supplier ? ' - ' + e.supplier : ''}`,
          ref: { kind: 'expense', id: e.id },
        })
        return { ...e, status: 'pagado', paidAt: date, paidFromAccountId: accountId }
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
      return generateRecurring({ ...state, recurring: [...state.recurring, { id: uid('rec'), active: true, tags: [], ...action.rule, companyId: resolveCompanyId(state, action.rule?.companyId) }] })
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
          movements: [...state.cash.movements, { id: uid('mov'), ref: null, accountId: defaultAccountId(state), ...action.movement }],
        },
      }
    case 'cash/remove':
      return { ...state, cash: { ...state.cash, movements: state.cash.movements.filter((m) => m.id !== action.id) } }
    case 'cash/setBalance': {
      // Crea un ajuste para que el saldo de la cuenta quede exactamente en el valor indicado.
      // En préstamos el "saldo" se expresa como deuda (positiva) y se guarda en negativo.
      const accountId = action.accountId || defaultAccountId(state)
      const account = state.accounts.find((a) => a.id === accountId)
      const target = account?.type === 'prestamo' ? -Math.abs(action.balance) : action.balance
      const current = totals(state).porCuenta[accountId] || 0
      const diff = target - current
      if (diff === 0) return state
      return {
        ...state,
        cash: {
          ...state.cash,
          movements: [
            ...state.cash.movements,
            { id: uid('mov'), date: action.date || todayISO(), type: 'ajuste', amount: diff, accountId, description: action.description || 'Ajuste de saldo', ref: null },
          ],
        },
      }
    }
    case 'cash/transfer': {
      // Traslado entre cuentas: egreso en origen, ingreso en destino. Un abono a préstamo es un traslado banco -> préstamo.
      if (!action.fromId || !action.toId || action.fromId === action.toId || !(action.amount > 0)) return state
      const tid = uid('trf')
      const date = action.date || todayISO()
      const from = state.accounts.find((a) => a.id === action.fromId)?.name ?? 'cuenta'
      const to = state.accounts.find((a) => a.id === action.toId)?.name ?? 'cuenta'
      const desc = action.description || `Traslado ${from} → ${to}`
      return {
        ...state,
        cash: {
          ...state.cash,
          movements: [
            ...state.cash.movements,
            { id: uid('mov'), date, type: 'egreso', amount: action.amount, accountId: action.fromId, description: desc, ref: { kind: 'transfer', id: tid } },
            { id: uid('mov'), date, type: 'ingreso', amount: action.amount, accountId: action.toId, description: desc, ref: { kind: 'transfer', id: tid } },
          ],
        },
      }
    }
    case 'cash/removeTransfer':
      return { ...state, cash: { ...state.cash, movements: state.cash.movements.filter((m) => !(m.ref?.kind === 'transfer' && m.ref.id === action.id)) } }

    // ---------- Cuentas (bancos, caja menor, préstamos) ----------
    case 'account/add': {
      const id = uid('acc')
      const account = { id, active: true, type: 'banco', ...action.account, companyId: resolveCompanyId(state, action.account?.companyId) }
      let next = { ...state, accounts: [...state.accounts, account] }
      const initial = Number(action.initialBalance) || 0
      if (initial) {
        const amount = account.type === 'prestamo' ? -Math.abs(initial) : initial
        next = {
          ...next,
          cash: { ...next.cash, movements: [...next.cash.movements, { id: uid('mov'), date: todayISO(), type: 'ajuste', amount, accountId: id, description: 'Saldo inicial', ref: null }] },
        }
      }
      return next
    }
    case 'account/update':
      return { ...state, accounts: state.accounts.map((a) => (a.id === action.id ? { ...a, ...action.account } : a)) }
    case 'account/remove': {
      // Solo se elimina si no tiene movimientos; si los tiene, se desactiva.
      const has = state.cash.movements.some((m) => m.accountId === action.id)
      if (has || state.accounts.length <= 1) return { ...state, accounts: state.accounts.map((a) => (a.id === action.id ? { ...a, active: false } : a)) }
      return { ...state, accounts: state.accounts.filter((a) => a.id !== action.id) }
    }

    // ---------- Recordatorios ----------
    case 'reminder/add': {
      const inv = state.invoices.find((i) => i.id === action.reminder?.invoiceId)
      return { ...state, reminders: [...state.reminders, { id: uid('rem'), ...action.reminder, companyId: resolveCompanyId(state, action.reminder?.companyId || inv?.companyId) }] }
    }

    // ---------- Empresas ----------
    case 'company/add': {
      const id = uid('emp')
      return { ...state, companies: [...state.companies, { id, active: true, prefix: 'CC', regimen: 'ordinario', iva: true, ...action.company }], counters: { ...(state.counters || {}), [id]: 1 } }
    }
    case 'company/update':
      return { ...state, companies: state.companies.map((c) => (c.id === action.id ? { ...c, ...action.company } : c)) }
    case 'company/remove': {
      const used = state.clients.some((x) => x.companyId === action.id) || state.expenses.some((x) => x.companyId === action.id) || state.accounts.some((x) => x.companyId === action.id)
      if (used || state.companies.length <= 1) return { ...state, companies: state.companies.map((c) => (c.id === action.id ? { ...c, active: false } : c)) }
      return { ...state, companies: state.companies.filter((c) => c.id !== action.id) }
    }

    // ---------- Configuración ----------
    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.settings } }

    default:
      return state
  }
}

export { monthKey }
