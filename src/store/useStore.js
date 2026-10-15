import { createContext, useContext } from 'react'

export const StoreContext = createContext(null)
export const ScopeContext = createContext(null)

/**
 * Modo de almacenamiento:
 *  - 'local': todo en el navegador (localStorage). Es el modo por defecto en desarrollo.
 *  - 'api':   el backend en server/ guarda el estado en PostgreSQL y aplica las acciones.
 */
export const STORAGE_MODE = import.meta.env.VITE_STORAGE || (import.meta.env.DEV ? 'local' : 'api')

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore debe usarse dentro de AppStoreProvider')
  const scope = useContext(ScopeContext)
  return scope ? { ...ctx, ...scope } : ctx
}
