import { db } from './knex.js'

const [batch, log] = await db.migrate.latest()
console.log(log.length ? `Migraciones aplicadas (lote ${batch}):\n - ${log.join('\n - ')}` : 'Base de datos al día')
await db.destroy()
