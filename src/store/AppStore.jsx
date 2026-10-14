import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { StoreContext, STORAGE_MODE } from './useStore.js'
import { reducer, generateRecurring, cashBalance } from './reducer.js'
import { load, save, clear } from './storage.js'
import { buildSeed, emptyState } from './seed.js'
import { api } from './api.js'

function initLocal() {
  const saved = load()
  return generateRecurring(saved ?? buildSeed())
}

function downloadJSON(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sygo-admin-respaldo-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function parseBackup(text) {
  const parsed = JSON.parse(text)
  if (!parsed || !Array.isArray(parsed.clients) || !parsed.cash) throw new Error('Archivo no válido')
  return parsed
}

export function AppStoreProvider({ children }) {
  return STORAGE_MODE === 'api' ? <ApiProvider>{children}</ApiProvider> : <LocalProvider>{children}</LocalProvider>
}

// ---------------- Modo local ----------------
function LocalProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, initLocal)
  useEffect(() => {
    save(state)
  }, [state])

  const value = useMemo(
    () => ({
      mode: 'local',
      state,
      dispatch,
      balance: cashBalance(state),
      user: { name: 'Modo local', role: 'admin' },
      canEdit: true,
      saving: false,
      error: null,
      clearError() {},
      logout() {},
      resetToSeed() { clear(); dispatch({ type: 'replace', state: generateRecurring(buildSeed()) }) },
      resetEmpty() { clear(); dispatch({ type: 'replace', state: emptyState() }) },
      exportJSON() { downloadJSON(state) },
      importJSON(text) { dispatch({ type: 'replace', state: generateRecurring(parseBackup(text)) }) },
    }),
    [state],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

// ---------------- Modo API ----------------
function ApiProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = cargando, null = sin sesión
  const [state, setState] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const queue = useRef(Promise.resolve())

  const loadState = useCallback(async () => {
    const r = await api.state()
    setState(r.state)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await api.me()
        if (!alive) return
        setUser(r.user)
        await loadState()
      } catch (e) {
        if (!alive) return
        if (e.status === 401) setUser(null)
        else setError('No se pudo conectar con el servidor. ' + e.message)
      }
    })()
    return () => { alive = false }
  }, [loadState])

  // Las acciones se envían en orden; el servidor devuelve el estado resultante.
  const dispatch = useCallback((action) => {
    setSaving(true)
    queue.current = queue.current
      .then(() => api.action(action))
      .then((r) => { setState(r.state) })
      .catch((e) => {
        setError(e.message)
        if (e.status === 401) setUser(null)
        else loadState().catch(() => {})
      })
      .finally(() => setSaving(false))
    return queue.current
  }, [loadState])

  const login = useCallback(async (email, password) => {
    const r = await api.login(email, password)
    setUser(r.user)
    await loadState()
  }, [loadState])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    setUser(null)
    setState(null)
  }, [])

  const value = useMemo(
    () => ({
      mode: 'api',
      state,
      dispatch,
      balance: state ? cashBalance(state) : 0,
      user,
      canEdit: user?.role === 'admin',
      saving,
      error,
      clearError: () => setError(null),
      login,
      logout,
      reload: loadState,
      resetToSeed: () => dispatch({ type: 'replace', state: buildSeed() }),
      resetEmpty: () => dispatch({ type: 'replace', state: emptyState() }),
      exportJSON: () => state && downloadJSON(state),
      importJSON: (text) => dispatch({ type: 'replace', state: parseBackup(text) }),
    }),
    [state, dispatch, user, saving, error, login, logout, loadState],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
