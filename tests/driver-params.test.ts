import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import type { Db } from '../src/db/types'
import { assignThread, touchThread } from '../src/server/mail/threading'

/**
 * Production uses drizzle's postgres-js driver, tests use PGlite. The two disagree about a raw
 * `Date` inside sql`` (postgres-js throws ERR_INVALID_ARG_TYPE at send time, PGlite accepts it),
 * which once broke saving sent mail. This runs the real driver against a client that only records
 * the parameters it would have sent.
 */
function recordingDb() {
  const sent: unknown[][] = []
  const client = postgres('postgres://u:p@127.0.0.1:1/db', { prepare: false })
  const unsafe = (query: string, params: unknown[] = []) => {
    sent.push(params)
    // Lookups find nothing (so the whole threading flow runs); inserts return a generated id.
    const rows = /^\s*insert/i.test(query)
      ? [['00000000-0000-4000-8000-000000000000']]
      : []
    return Object.assign(Promise.resolve(rows), {
      values: () => Promise.resolve(rows),
    })
  }
  Object.assign(client, { unsafe })
  return { db: drizzle(client, { schema }) as unknown as Db, sent }
}

const hasDate = (sent: unknown[][]) =>
  sent.flat().some((p) => p instanceof Date)

describe('postgres-js parameters', () => {
  it('assignThread sends no raw Date parameters', async () => {
    const { db, sent } = recordingDb()
    await assignThread(db, {
      messageId: '<a@x>',
      inReplyTo: '<b@x>',
      references: ['<b@x>'],
      subject: 'Re: Plan',
      addresses: ['ada@example.com'],
      date: new Date('2026-01-01T10:00:00Z'),
      ownDomain: 'tanakadev.digital',
    })
    expect(sent.length).toBeGreaterThan(1)
    expect(hasDate(sent)).toBe(false)
  })

  it('touchThread sends no raw Date parameters', async () => {
    const { db, sent } = recordingDb()
    await touchThread(db, 'tid', new Date('2026-01-01T10:00:00Z'), [
      'a@x.example',
    ])
    expect(sent).toHaveLength(1)
    expect(hasDate(sent)).toBe(false)
  })
})
