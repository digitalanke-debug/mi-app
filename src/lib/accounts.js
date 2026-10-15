/** Cálculos de saldos por cuenta y consolidados */

export function accountBalance(state, accountId) {
  return state.cash.movements.reduce((s, m) => {
    if (m.accountId !== accountId) return s
    if (m.type === 'ingreso' || m.type === 'ajuste') return s + m.amount
    if (m.type === 'egreso') return s - m.amount
    return s
  }, 0)
}

export function isLoan(account) {
  return account?.type === 'prestamo'
}

/**
 * Totales consolidados:
 *  - disponible: suma de cuentas que no son préstamo
 *  - deudas: lo que se debe en préstamos (saldo negativo convertido a positivo)
 *  - neto: disponible - deudas
 */
export function totals(state, companyId = 'all') {
  let disponible = 0
  let deudas = 0
  const porCuenta = {}
  for (const a of state.accounts) {
    const b = accountBalance(state, a.id)
    porCuenta[a.id] = b
    if (!a.active) continue
    if (companyId !== 'all' && a.companyId !== companyId) continue
    if (isLoan(a)) deudas += Math.max(0, -b)
    else disponible += b
  }
  return { disponible, deudas, neto: disponible - deudas, porCuenta }
}

/** Cuenta por defecto para registrar pagos y cobros: la primera activa que no sea préstamo */
export function defaultAccountId(state, companyId) {
  const pool = companyId && companyId !== 'all' ? state.accounts.filter((x) => x.companyId === companyId) : state.accounts
  const a = pool.find((x) => x.active && !isLoan(x)) || pool[0] || state.accounts[0]
  return a?.id
}

export function accountName(state, id) {
  return state.accounts.find((a) => a.id === id)?.name ?? 'Cuenta'
}
