import { and, eq, gt } from 'drizzle-orm'
import { sessions } from '#/db/schema'
import type { Db } from '#/db/types'
import { generateSessionToken, hashToken } from './crypto'

export const SESSION_TTL_MS = 90 * 24 * 3600 * 1000
/** Sliding expiry is extended at most this often, to avoid a write per request. */
const REFRESH_AFTER_MS = 3600 * 1000

export async function createSession(db: Db, now: Date) {
  const token = generateSessionToken()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
  })
  return { token, expiresAt }
}

export interface ValidSession {
  id: string
  /** True when the expiry was just extended, so the cookie should be re-issued. */
  refreshed: boolean
}

export async function validateSession(
  db: Db,
  token: string,
  now: Date,
): Promise<ValidSession | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1)
  if (!row) return null

  if (now.getTime() - row.lastUsedAt.getTime() < REFRESH_AFTER_MS) {
    return { id: row.id, refreshed: false }
  }
  await db
    .update(sessions)
    .set({
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .where(eq(sessions.id, row.id))
  return { id: row.id, refreshed: true }
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

export async function deleteAllSessions(db: Db): Promise<void> {
  await db.delete(sessions)
}
