/**
 * Capa de persistencia.
 * Hoy guarda en localStorage del navegador. Para pasar a Supabase u otro
 * backend solo hay que reemplazar load/save manteniendo la misma forma del estado.
 */
const KEY = 'sigo-admin-v1'

export function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Sin espacio o modo privado: la app sigue funcionando en memoria.
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignorar
  }
}
