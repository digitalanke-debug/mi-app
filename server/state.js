import { query, withState } from './db.js'
import { reducer, generateRecurring } from '../src/store/reducer.js'
import { migrateState } from '../src/store/migrate.js'

const ALLOWED_PREFIX = ['client/', 'invoice/', 'expense/', 'recurring/', 'cash/', 'account/', 'reminder/', 'settings/']

export function isAllowedAction(type) {
  return typeof type === 'string' && ALLOWED_PREFIX.some((p) => type.startsWith(p))
}

export function isValidState(s) {
  return s && typeof s === 'object' && Array.isArray(s.clients) && Array.isArray(s.invoices) && Array.isArray(s.expenses) && Array.isArray(s.recurring) && s.cash && Array.isArray(s.cash.movements) && s.settings
}

/** Lee el estado, generando gastos fijos del periodo si hace falta. actor: {id, email} */
export async function readState(actor) {
  return withState(async (row, client) => {
    const next = generateRecurring(row.data)
    if (next !== row.data) {
      const v = row.version + 1
      await client.query('UPDATE app_state SET data = $1, version = $2, updated_at = now() WHERE id = 1', [next, v])
      await client.query('INSERT INTO actions_log (user_id, user_email, action, version) VALUES ($1, $2, $3, $4)', [actor?.id ?? null, actor?.email ?? 'sistema', { type: 'recurring/generate' }, v])
      return { state: next, version: v }
    }
    return { state: migrateState(row.data), version: row.version }
  })
}

/** Aplica una acción del reducer de forma serializada y la registra en la bitácora. */
export async function applyAction(action, actor) {
  const isReplace = action.type === 'replace'
  if (!isReplace && !isAllowedAction(action.type)) throw Object.assign(new Error(`Acción no permitida: ${action.type}`), { status: 400 })
  if (isReplace && !isValidState(action.state)) throw Object.assign(new Error('El estado a restaurar no es válido'), { status: 400 })
  return withState(async (row, client) => {
    const next = isReplace ? generateRecurring(action.state) : reducer(migrateState(row.data), action)
    const v = row.version + 1
    await client.query('UPDATE app_state SET data = $1, version = $2, updated_at = now() WHERE id = 1', [next, v])
    const logged = isReplace ? { type: 'replace', size: JSON.stringify(action.state).length } : action
    await client.query('INSERT INTO actions_log (user_id, user_email, action, version) VALUES ($1, $2, $3, $4)', [actor?.id ?? null, actor?.email ?? 'sistema', logged, v])
    return { state: next, version: v }
  })
}

export { query }
