import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

config({ path: '.env.local' })

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set (put it in .env.local).')
  process.exit(1)
}

const client = postgres(url, { prepare: false, max: 1 })
try {
  await migrate(drizzle(client), { migrationsFolder: './drizzle' })
  console.log('Migrations applied.')
} finally {
  await client.end()
}
