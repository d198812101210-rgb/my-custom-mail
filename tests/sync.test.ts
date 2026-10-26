import { beforeEach, describe, expect, it } from 'vitest'
import { messages } from '../src/db/schema'
import type { Db } from '../src/db/types'
import { ingestReceivedEmail } from '../src/server/mail/ingest'
import { syncReceivedEmails } from '../src/server/mail/sync'
import { createTestDb } from './db'
import { FakeMail, FakeStore, OWN_DOMAIN, makeEmail } from './fakes'

let db: Db
let mail: FakeMail
let store: FakeStore
const deps = () => ({ db, mail, store, ownDomain: OWN_DOMAIN })

beforeEach(async () => {
  db = (await createTestDb()).db
  mail = new FakeMail()
  store = new FakeStore()
})

const addEmails = (n: number) => {
  for (let i = 0; i < n; i++) {
    mail.add(
      makeEmail({
        id: `e${i}`,
        subject: `Subject ${i}`,
        from: `s${i}@example.com`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      }),
    )
  }
}

describe('syncReceivedEmails', () => {
  it('imports only what is missing', async () => {
    addEmails(5)
    await ingestReceivedEmail(deps(), 'e4')
    const before = mail.getCalls
    const result = await syncReceivedEmails(deps())
    expect(result).toEqual({ scanned: 5, imported: 4, failed: 0 })
    expect(mail.getCalls - before).toBe(4)
    expect(await db.select().from(messages)).toHaveLength(5)
  })

  it('is harmless to run twice', async () => {
    addEmails(3)
    await syncReceivedEmails(deps())
    const second = await syncReceivedEmails(deps())
    expect(second.imported).toBe(0)
    expect(await db.select().from(messages)).toHaveLength(3)
  })

  it('walks several pages to backfill', async () => {
    addEmails(230)
    const result = await syncReceivedEmails(deps())
    expect(result).toEqual({ scanned: 230, imported: 230, failed: 0 })
  }, 60_000)

  it('stops at the first fully-imported page unless asked for a full sync', async () => {
    addEmails(150)
    await syncReceivedEmails(deps())
    // Simulate an old gap that a quick sync would not look at.
    mail.add(
      makeEmail({
        id: 'old',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        subject: 'old',
      }),
    )
    const quick = await syncReceivedEmails(deps())
    expect(quick.imported).toBe(0)
    const full = await syncReceivedEmails(deps(), { full: true })
    expect(full.imported).toBe(1)
  }, 60_000)

  it('keeps going when one email fails and reports it', async () => {
    addEmails(3)
    mail.failNextGet = true
    const logs: string[] = []
    const result = await syncReceivedEmails(deps(), {
      log: (l) => logs.push(l),
    })
    expect(result).toMatchObject({ imported: 2, failed: 1 })
    const again = await syncReceivedEmails(deps(), { full: true })
    expect(again.imported).toBe(1)
    expect(await db.select().from(messages)).toHaveLength(3)
  })
})
