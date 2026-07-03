import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool)

  // eslint-disable-next-line no-console
  console.log('Running migrations…')
  await migrate(db, { migrationsFolder: './db/migrations' })
  // eslint-disable-next-line no-console
  console.log('Migrations complete.')

  await pool.end()
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', err)
  process.exit(1)
})
