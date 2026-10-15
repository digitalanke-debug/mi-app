/**
 * Migraciones del estado guardado. Se aplican al cargar (navegador o servidor)
 * para que datos creados por versiones anteriores sigan funcionando.
 */
export const DEFAULT_ACCOUNT_ID = 'acc_principal'
export const DEFAULT_COMPANY_ID = 'emp_principal'

export const ACCOUNT_TYPES = {
  banco: 'Cuenta bancaria',
  efectivo: 'Caja menor / efectivo',
  prestamo: 'Préstamo (deuda)',
  otro: 'Otro',
}

export const REGIMENES = {
  ordinario: 'Régimen ordinario (practica retención)',
  simple: 'Régimen simple (no practica retención)',
}

export const DEFAULT_REMINDER_SETTINGS = { auto: false, daysBefore: 3, onDue: true, everyDaysOverdue: 7, hour: 9 }

export function newCompany(partial = {}) {
  return {
    id: DEFAULT_COMPANY_ID,
    name: 'Empresa principal',
    prefix: 'CC',
    nit: '',
    regimen: 'ordinario',
    iva: true,
    address: '',
    city: '',
    phone: '',
    email: '',
    bankInfo: '',
    footer: '',
    active: true,
    ...partial,
  }
}

function withCompany(list, companyId) {
  if (!Array.isArray(list)) return []
  return list.some((x) => !x.companyId) ? list.map((x) => (x.companyId ? x : { ...x, companyId })) : list
}

export function migrateState(state) {
  let s = state
  // v2: cuentas múltiples
  if (!Array.isArray(s.accounts) || s.accounts.length === 0) {
    s = { ...s, accounts: [{ id: DEFAULT_ACCOUNT_ID, name: 'Cuenta principal', type: 'banco', active: true }] }
  }
  const firstId = s.accounts[0].id
  if (s.cash?.movements?.some((m) => !m.accountId)) {
    s = { ...s, cash: { ...s.cash, movements: s.cash.movements.map((m) => (m.accountId ? m : { ...m, accountId: firstId })) } }
  }
  if (!s.settings?.whatsapp) {
    s = { ...s, settings: { ...s.settings, whatsapp: { allowedNumbers: [], assistantName: 'Asistente S&Go' } } }
  }
  if (!Array.isArray(s.reminders)) s = { ...s, reminders: [] }

  // v3: empresas
  if (!Array.isArray(s.companies) || s.companies.length === 0) {
    s = { ...s, companies: [newCompany({ name: s.settings?.firmName || 'Empresa principal' })] }
  }
  const cid = s.companies[0].id
  const clients = withCompany(s.clients, cid)
  const invoices = withCompany(s.invoices, cid)
  const expenses = withCompany(s.expenses, cid)
  const recurring = withCompany(s.recurring, cid)
  const accounts = withCompany(s.accounts, cid)
  const reminders = withCompany(s.reminders, cid)
  if (clients !== s.clients || invoices !== s.invoices || expenses !== s.expenses || recurring !== s.recurring || accounts !== s.accounts || reminders !== s.reminders) {
    s = { ...s, clients, invoices, expenses, recurring, accounts, reminders }
  }
  if (!s.counters) {
    s = { ...s, counters: { [cid]: s.nextInvoiceNumber || 1 } }
  }
  if (s.expenses.some((e) => !Array.isArray(e.tags))) {
    s = { ...s, expenses: s.expenses.map((e) => (Array.isArray(e.tags) ? e : { ...e, tags: [] })) }
  }
  if (!s.settings.reminders) {
    s = { ...s, settings: { ...s.settings, reminders: { ...DEFAULT_REMINDER_SETTINGS } } }
  }
  if (!s.settings.whatsapp.dailySummary) {
    s = { ...s, settings: { ...s.settings, whatsapp: { ...s.settings.whatsapp, dailySummary: { enabled: false, hour: 8 } } } }
  }
  if (s.version !== 3) s = { ...s, version: 3 }
  return s
}

/** Empresa por defecto para crear registros: la indicada si existe y está activa, si no la primera activa */
export function resolveCompanyId(state, wanted) {
  if (wanted && wanted !== 'all' && state.companies.some((c) => c.id === wanted)) return wanted
  return (state.companies.find((c) => c.active) || state.companies[0])?.id
}

export function companyName(state, id) {
  return state.companies.find((c) => c.id === id)?.name ?? 'Empresa'
}
