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
  const [theme, setThemeState] = useState(() => { try { return localStorage.getItem('crm_theme') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') } catch { return 'light' } })
  const [prefs, setPrefsState] = useState(() => { try { return { notify: true, sound: true, ...JSON.parse(localStorage.getItem('crm_prefs') || '{}') } } catch { return { notify: true, sound: true } } })
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); try { localStorage.setItem('crm_theme', theme) } catch {} }, [theme])
  const setTheme = useCallback((t) => setThemeState(t), [])
  const setPrefs = useCallback((p) => setPrefsState((cur) => { const n = { ...cur, ...p }; try { localStorage.setItem('crm_prefs', JSON.stringify(n)) } catch {}; return n }), [])
  const prefsRef = useRef(prefs); prefsRef.current = prefs
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
    s.on('message:new', (m) => {
      if (m.direction !== 'in') return
      const p = prefsRef.current
      if (p.sound) beep()
      if (p.notify && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try { const n = new Notification('Nuevo mensaje de WhatsApp', { body: (m.body || 'Archivo adjunto').slice(0, 120), tag: `conv-${m.conversation_id}` }); n.onclick = () => { window.focus(); window.location.hash = ''; window.location.pathname = `/bandeja/${m.conversation_id}` } } catch {}
      }
    })
    return () => s.disconnect()
  }, [user, toast])

  const subscribe = useCallback((event, fn) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set())
    listeners.current.get(event).add(fn)
    return () => listeners.current.get(event)?.delete(fn)
  }, [])

  const company = useMemo(() => companies.find((c) => c.id === companyId) || null, [companies, companyId])
  const value = useMemo(() => ({ user, companies, company, companyId, setCompanyId, login, logout, loading, subscribe, toast, toasts, refreshCompanies, socket: socketRef, theme, setTheme, prefs, setPrefs }),
    [user, companies, company, companyId, setCompanyId, login, logout, loading, subscribe, toast, toasts, refreshCompanies, theme, setTheme, prefs, setPrefs])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useStore = () => useContext(Ctx)

/** Sonido corto de aviso (sin archivos externos) */
let audioCtx = null
export function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(880, audioCtx.currentTime); o.frequency.setValueAtTime(1175, audioCtx.currentTime + 0.09)
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25)
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.26)
  } catch {}
}

export function requestNotifications() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
}

/** Suscribe a un evento del socket mientras el componente esté montado */
export function useRealtime(event, fn) {
  const { subscribe } = useStore()
  const ref = useRef(fn); ref.current = fn
  useEffect(() => subscribe(event, (p) => ref.current(p)), [event, subscribe])
}
