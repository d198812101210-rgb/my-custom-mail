import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { messages, threads } from '../src/db/schema'
import { createTestDb } from './db'

describe('schema migration', () => {
  it('enables RLS on every table and defines no policies', async () => {
    const { db } = await createTestDb()
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(
      sql`select c.relname, c.relrowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`,
    )
    const names = rows.rows.map((r) => r.relname).sort()
    expect(names).toEqual(
      ['attachments', 'messages', 'otp_codes', 'rate_limits', 'sessions', 'threads'],
    )
    expect(rows.rows.every((r) => r.relrowsecurity)).toBe(true)
    const policies = await db.execute(sql`select 1 from pg_policies`)
    expect(policies.rows).toHaveLength(0)
  })

  it('maintains the generated search column', async () => {
    const { db } = await createTestDb()
    const [t] = await db
      .insert(threads)
      .values({ normalizedSubject: 'invoice' })
      .returning()
    await db.insert(messages).values({
      threadId: t.id,
      direction: 'in',
      fromAddress: 'billing@example.com',
      subject: 'Your invoice',
      textBody: 'Please find the quarterly report attached',
      sentOrReceivedAt: new Date(),
    })
    const hit = await db.execute(
      sql`select 1 from messages where search @@ plainto_tsquery('simple', 'quarterly')`,
    )
    const miss = await db.execute(
      sql`select 1 from messages where search @@ plainto_tsquery('simple', 'nothing')`,
    )
    expect(hit.rows).toHaveLength(1)
    expect(miss.rows).toHaveLength(0)
  })

  it('rejects an unknown folder', async () => {
    const { db } = await createTestDb()
    const [t] = await db.insert(threads).values({ normalizedSubject: 'x' }).returning()
    await expect(
      db.insert(messages).values({
        threadId: t.id,
        direction: 'in',
        folder: 'spam',
        fromAddress: 'a@b.c',
        sentOrReceivedAt: new Date(),
      }),
    ).rejects.toThrow()
  })
})
