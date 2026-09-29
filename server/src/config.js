import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'cambiar-en-produccion',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // DB_CLIENT: better-sqlite3 (demo/local) | pg (producción)
  dbClient: process.env.DB_CLIENT || 'better-sqlite3',
  sqlitePath: process.env.SQLITE_PATH || path.join(here, '..', 'data', 'crm.sqlite'),
  databaseUrl: process.env.DATABASE_URL || '',
  // WHATSAPP_PROVIDER: demo | evolution
  whatsappProvider: process.env.WHATSAPP_PROVIDER || 'demo',
  evolution: {
    url: process.env.EVOLUTION_URL || 'http://evolution:8080',
    apiKey: process.env.EVOLUTION_API_KEY || '',
    webhookBase: process.env.WEBHOOK_BASE_URL || 'http://server:4000',
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  demoAutoLeads: process.env.DEMO_AUTO_LEADS !== 'false',
}
