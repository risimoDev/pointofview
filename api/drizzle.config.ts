import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // event и audit_log — TimescaleDB hypertables; create_hypertable() и
  // compression policy остаются в init.sql / ручной миграции,
  // drizzle управляет только DDL таблиц/индексов.
  verbose: true,
  strict: true,
})
