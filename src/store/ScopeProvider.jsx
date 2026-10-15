import { useEffect, useMemo, useState } from 'react'
import { ScopeContext } from './useStore.js'

const SCOPE_KEY = 'sigo-empresa'

/** Selección de empresa (o "all" para el consolidado), compartida por toda la app */
export function ScopeProvider({ state, children }) {
  const [companyId, setCompanyIdRaw] = useState(() => {
    try { return localStorage.getItem(SCOPE_KEY) || 'all' } catch { return 'all' }
  })
  useEffect(() => {
    try { localStorage.setItem(SCOPE_KEY, companyId) } catch { /* ignorar */ }
  }, [companyId])

  const value = useMemo(() => {
    const companies = state?.companies || []
    const valid = companyId === 'all' || companies.some((c) => c.id === companyId && c.active)
    const cid = valid ? companyId : 'all'
    const company = cid === 'all' ? null : companies.find((c) => c.id === cid)
    const pick = (list) => (cid === 'all' ? list || [] : (list || []).filter((x) => x.companyId === cid))
    return {
      companyId: cid,
      company,
      companies,
      activeCompanies: companies.filter((c) => c.active),
      setCompanyId: setCompanyIdRaw,
      scoped: state
        ? {
            clients: pick(state.clients),
            invoices: pick(state.invoices),
            expenses: pick(state.expenses),
            recurring: pick(state.recurring),
            accounts: pick(state.accounts),
            reminders: pick(state.reminders),
          }
        : null,
    }
  }, [state, companyId])

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

