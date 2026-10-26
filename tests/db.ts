import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../src/db/schema'

let shared:
  Promise<ReturnType<typeof drizzle<typeof schema, PGlite>>> | undefined

/**
 * In-memory Postgres with the real migrations applied. One instance per test
 * file (migrating is slow); every call returns it emptied.
 */
export async function createTestDb() {
  shared ??= (async () => {
    const db = drizzle(new PGlite(), { schema })
    await migrate(db, { migrationsFolder: './drizzle' })
    return db
  })()
  const db = await shared
  await db.execute(
    sql`truncate table attachments, messages, threads, sessions, otp_codes, rate_limits restart identity cascade`,
  )
  return { db }
}
