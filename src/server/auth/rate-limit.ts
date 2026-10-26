import { lt, sql } from 'drizzle-orm'
import { rateLimits } from '#/db/schema'
import type { Db } from '#/db/types'

export interface Limit {
  windowSeconds: number
  max: number
}

/**
 * Fixed-window counter in the database. Every call counts, including rejected
 * ones, so hammering an endpoint keeps it locked. Returns true when allowed.
 */
export async function hit(
  db: Db,
  key: string,
  limit: Limit,
  now: Date,
): Promise<boolean> {
  const ms = limit.windowSeconds * 1000
  const windowStart = new Date(Math.floor(now.getTime() / ms) * ms)
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count })
  return (row?.count ?? Infinity) <= limit.max
}

/** Drop counters from windows that can no longer matter. */
export async function pruneRateLimits(db: Db, now: Date): Promise<void> {
  await db
    .delete(rateLimits)
    .where(
      lt(rateLimits.windowStart, new Date(now.getTime() - 24 * 3600 * 1000)),
    )
}
