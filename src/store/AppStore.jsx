import { useEffect, useMemo, useReducer } from 'react'
import { StoreContext } from './useStore.js'
import { reducer, generateRecurring, cashBalance } from './reducer.js'
import { load, save, clear } from './storage.js'
import { buildSeed, emptyState } from './seed.js'

function init() {
  const saved = load()
  const base = saved ?? buildSeed()
  return generateRecurring(base)
}

export function AppStoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, init)

  useEffect(() => {
    save(state)
  }, [state])

  const api = useMemo(
    () => ({
      state,
      dispatch,
      balance: cashBalance(state),
      resetToSeed() {
        clear()
        dispatch({ type: 'replace', state: generateRecurring(buildSeed()) })
      },
      resetEmpty() {
        clear()
        dispatch({ type: 'replace', state: emptyState() })
      },
      exportJSON() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `sigo-admin-respaldo-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      },
      importJSON(text) {
        const parsed = JSON.parse(text)
        if (!parsed || !Array.isArray(parsed.clients) || !parsed.cash) throw new Error('Archivo no válido')
        dispatch({ type: 'replace', state: generateRecurring(parsed) })
      },
    }),
    [state],
  )

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}
