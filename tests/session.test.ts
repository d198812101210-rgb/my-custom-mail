import { beforeEach, describe, expect, it } from 'vitest'
import { sessions } from '../src/db/schema'
import type { Db } from '../src/db/types'
import {
  createSession,
  deleteAllSessions,
  deleteSession,
  SESSION_TTL_MS,
  validateSession,
} from '../src/server/auth/session'
import { createTestDb } from './db'

let db: Db
const t0 = new Date(Date.UTC(2026, 0, 1))

beforeEach(async () => {
  db = (await createTestDb()).db
})

describe('sessions', () => {
  it('stores only a hash of the token', async () => {
    const { token } = await createSession(db, t0)
    const [row] = await db.select().from(sessions)
    expect(row?.tokenHash).not.toBe(token)
    expect(JSON.stringify(row)).not.toContain(token)
    expect(token.length).toBeGreaterThanOrEqual(43) // 256 bits, base64url
  })

  it('validates a live session and rejects unknown tokens', async () => {
    const { token } = await createSession(db, t0)
    expect(await validateSession(db, token, t0)).toMatchObject({ refreshed: false })
    expect(await validateSession(db, 'nope', t0)).toBeNull()
  })

  it('expires 90 days after last use', async () => {
    const { token } = await createSession(db, t0)
    const justBefore = new Date(t0.getTime() + SESSION_TTL_MS - 1000)
    expect(await validateSession(db, token, justBefore)).not.toBeNull()
  })

  it('rejects after 90 days without use', async () => {
    const { token } = await createSession(db, t0)
    const after = new Date(t0.getTime() + SESSION_TTL_MS + 1000)
    expect(await validateSession(db, token, after)).toBeNull()
  })

  it('slides the expiry forward when used', async () => {
    const { token } = await createSession(db, t0)
    const day60 = new Date(t0.getTime() + 60 * 24 * 3600 * 1000)
    expect(await validateSession(db, token, day60)).toMatchObject({ refreshed: true })
    const day120 = new Date(t0.getTime() + 120 * 24 * 3600 * 1000)
    expect(await validateSession(db, token, day120)).not.toBeNull()
  })

  it('logout deletes the session row', async () => {
    const { token } = await createSession(db, t0)
    await deleteSession(db, token)
    expect(await validateSession(db, token, t0)).toBeNull()
    expect(await db.select().from(sessions)).toHaveLength(0)
  })

  it('log out everywhere deletes all sessions', async () => {
    const a = await createSession(db, t0)
    const b = await createSession(db, t0)
    await deleteAllSessions(db)
    expect(await validateSession(db, a.token, t0)).toBeNull()
    expect(await validateSession(db, b.token, t0)).toBeNull()
  })
})
