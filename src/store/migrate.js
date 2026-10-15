/**
 * Migraciones del estado guardado. Se aplican al cargar (navegador o servidor)
 * para que datos creados por versiones anteriores sigan funcionando.
 */
export const DEFAULT_ACCOUNT_ID = 'acc_principal'

export const ACCOUNT_TYPES = {
  banco: 'Cuenta bancaria',
  efectivo: 'Caja menor / efectivo',
  prestamo: 'Préstamo (deuda)',
  otro: 'Otro',
}

export function migrateState(state) {
  let s = state
  // v2: cuentas múltiples
  if (!Array.isArray(s.accounts) || s.accounts.length === 0) {
    s = {
      ...s,
      accounts: [{ id: DEFAULT_ACCOUNT_ID, name: 'Cuenta principal', type: 'banco', active: true }],
    }
  }
  const firstId = s.accounts[0].id
  if (s.cash?.movements?.some((m) => !m.accountId)) {
    s = {
      ...s,
      cash: { ...s.cash, movements: s.cash.movements.map((m) => (m.accountId ? m : { ...m, accountId: firstId })) },
    }
  }
  if (!s.settings?.whatsapp) {
    s = { ...s, settings: { ...s.settings, whatsapp: { allowedNumbers: [], assistantName: 'Asistente S&Go' } } }
  }
  if (!Array.isArray(s.reminders)) s = { ...s, reminders: [] }
  if (s.version !== 2) s = { ...s, version: 2 }
  return s
}
