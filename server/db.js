import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
})

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'lectura')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INT PRIMARY KEY,
      data JSONB NOT NULL,
      version INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS actions_log (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id),
      user_email TEXT,
      action JSONB NOT NULL,
      version INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
}

export async function query(text, params) {
  return pool.query(text, params)
}

/** Ejecuta fn dentro de una transacción con el estado bloqueado (serializa las acciones). */
export async function withState(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query('SELECT data, version FROM app_state WHERE id = 1 FOR UPDATE')
    const row = res.rows[0]
    const result = await fn(row, client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
