import knexLib from 'knex'
import { config } from '../config.js'

export function knexConfig() {
  if (config.dbClient === 'pg') {
    return {
      client: 'pg',
      connection: config.databaseUrl,
      pool: { min: 1, max: 10 },
      migrations: { directory: new URL('./migrations', import.meta.url).pathname },
    }
  }
  return {
    client: 'better-sqlite3',
    connection: { filename: config.sqlitePath },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn, done) => {
        conn.pragma('journal_mode = WAL')
        conn.pragma('foreign_keys = ON')
        done(null, conn)
      },
    },
    migrations: { directory: new URL('./migrations', import.meta.url).pathname },
  }
}

export const db = knexLib(knexConfig())
export const now = () => new Date().toISOString()
