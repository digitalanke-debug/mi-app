import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { api, getToken, setToken } from './api.js'

const Ctx = createContext(null)

export function StoreProvider({ children }) {
  const [user, setUser] = useState(null)
  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyIdState] = useState(() => { try { return Number(localStorage.getItem('crm_company')) || null } catch { return null } })
  const [loading, setLoading] = useState(!!getToken())
  const [toasts, setToasts] = useState([])
  const socketRef = useRef(null)
  const listeners = useRef(new Map())

  const toast = useCallback((text, kind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])

  const login = useCallback(async (email, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { email, password } })
    setToken(d.token); setUser(d.user); setCompanies(d.companies)
    if (!d.companies.find((c) => c.id === companyId)) setCompanyIdState(d.companies[0]?.id || null)
  }, [companyId])

  const logout = useCallback(() => { setToken(null); setUser(null); setCompanies([]); socketRef.current?.disconnect() }, [])

  const setCompanyId = useCallback((id) => { setCompanyIdState(id); try { localStorage.setItem('crm_company', id) } catch {} }, [])

  const refreshCompanies = useCallback(async () => { const d = await api('/auth/me'); setCompanies(d.companies) }, [])

  useEffect(() => {
    if (!getToken()) { setLoading(false); return }
    api('/auth/me').then((d) => {
      setUser(d.user); setCompanies(d.companies)
      setCompanyIdState((cur) => d.companies.find((c) => c.id === cur) ? cur : (d.companies[0]?.id || null))
    }).catch(() => setToken(null)).finally(() => setLoading(false))
    const onLogout = () => setUser(null)
    window.addEventListener('crm:logout', onLogout)
    return () => window.removeEventListener('crm:logout', onLogout)
  }, [])

  // Socket en tiempo real
  useEffect(() => {
    if (!user) return
    const s = io({ auth: { token: getToken() } })
    socketRef.current = s
    const forward = (event) => (payload) => listeners.current.get(event)?.forEach((fn) => fn(payload))
    for (const ev of ['message:new', 'conversation:update', 'instance:update', 'notification', 'typing']) s.on(ev, forward(ev))
    s.on('notification', (n) => toast(n.body, 'warn'))
    return () => s.disconnect()
  }, [user, toast])

  const subscribe = useCallback((event, fn) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set())
    listeners.current.get(event).add(fn)
    return () => listeners.current.get(event)?.delete(fn)
  }, [])

  const company = useMemo(() => companies.find((c) => c.id === companyId) || null, [companies, companyId])
  const value = useMemo(() => ({ user, companies, company, companyId, setCompanyId, login, logout, loading, subscribe, toast, toasts, refreshCompanies, socket: socketRef }),
    [user, companies, company, companyId, setCompanyId, login, logout, loading, subscribe, toast, toasts, refreshCompanies])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useStore = () => useContext(Ctx)

/** Suscribe a un evento del socket mientras el componente esté montado */
export function useRealtime(event, fn) {
  const { subscribe } = useStore()
  const ref = useRef(fn); ref.current = fn
  useEffect(() => subscribe(event, (p) => ref.current(p)), [event, subscribe])
}
