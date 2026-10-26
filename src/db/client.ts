import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '#/env.server'
import * as schema from './schema'

// Supabase pooled (transaction-mode) URL: prepared statements are not supported.
const globalForDb = globalThis as unknown as { __pg?: postgres.Sql }

const client =
  globalForDb.__pg ??
  postgres(env.DATABASE_URL, { prepare: false, max: 5, idle_timeout: 20 })

if (process.env.NODE_ENV !== 'production') globalForDb.__pg = client

export const db = drizzle(client, { schema })
export type Db = typeof db
