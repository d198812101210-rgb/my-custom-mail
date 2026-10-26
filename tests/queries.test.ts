import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { attachments, messages } from '../src/db/schema'
import type { Db } from '../src/db/types'
import {
  markThreadRead,
  moveMessages,
  moveThread,
  setRead,
} from '../src/server/mail/actions'
import { ingestReceivedEmail } from '../src/server/mail/ingest'
import {
  getThread,
  listThreads,
  toTsQuery,
  unreadCounts,
} from '../src/server/mail/queries'
import { createTestDb } from './db'
import { FakeMail, FakeStore, OWN_DOMAIN, attachment, makeEmail } from './fakes'

let db: Db
let mail: FakeMail
const store = new FakeStore()
const ingest = (id: string) =>
  ingestReceivedEmail({ db, mail, store, ownDomain: OWN_DOMAIN }, id)
const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n))

beforeEach(async () => {
  db = (await createTestDb()).db
  mail = new FakeMail()
})

const add = async (
  id: string,
  over: Parameters<typeof makeEmail>[0] extends infer T
    ? Partial<T>
    : never = {},
  atts = [],
) => {
  mail.add(makeEmail({ id, ...over }), atts)
  await ingest(id)
}
const idOf = async (resendId: string) =>
  (await db.select().from(messages).where(eq(messages.resendId, resendId)))[0]
    ?.id ?? ''

describe('toTsQuery', () => {
  it('makes prefix terms joined with AND', () => {
    expect(toTsQuery('inv 42')).toBe('inv:* & 42:*')
  })
  it('strips tsquery operators and punctuation', () => {
    expect(toTsQuery("a' | b & !c <-> d:*")).toBe('a:* & b:* & c:* & d:*')
    expect(toTsQuery("'; drop table messages; --")).toBe(
      'drop:* & table:* & messages:*',
    )
    expect(toTsQuery('  !!! ')).toBeNull()
  })
  it('handles non-latin letters', () => {
    expect(toTsQuery('Привет мир')).toBe('Привет:* & мир:*')
  })
})

describe('listThreads', () => {
  it('lists one row per thread, newest first, with the latest message', async () => {
    await add('a1', { subject: 'Plan', messageId: '<a1@x>', createdAt: at(1) })
    await add('a2', {
      subject: 'Re: Plan',
      text: 'second reply body',
      headers: { 'in-reply-to': '<a1@x>' },
      createdAt: at(3),
    })
    await add('b1', {
      subject: 'Other',
      from: 'zed@other.com',
      createdAt: at(2),
    })
    const { threads, nextCursor } = await listThreads(db, { folder: 'inbox' })
    expect(nextCursor).toBeNull()
    expect(threads.map((t) => t.subject)).toEqual(['Re: Plan', 'Other'])
    expect(threads[0]).toMatchObject({
      count: 2,
      unread: 2,
      snippet: 'second reply body',
      fromAddress: 'alice@example.com',
      receivedFor: ['test@tanakadev.digital'],
    })
  })

  it('counts unread per thread and updates when read', async () => {
    await add('a1', { messageId: '<a1@x>', createdAt: at(1) })
    await add('a2', { headers: { 'in-reply-to': '<a1@x>' }, createdAt: at(2) })
    await setRead(db, [await idOf('a1')], true)
    const [t] = (await listThreads(db, { folder: 'inbox' })).threads
    expect(t).toMatchObject({ count: 2, unread: 1 })
    await markThreadRead(db, t?.id ?? '')
    expect(
      (await listThreads(db, { folder: 'inbox' })).threads[0]?.unread,
    ).toBe(0)
  })

  it('paginates with a stable cursor and no duplicates', async () => {
    for (let i = 0; i < 7; i++) {
      await add(`m${i}`, {
        subject: `S${i}`,
        from: `s${i}@e.com`,
        createdAt: at(i),
      })
    }
    const seen: string[] = []
    let cursor = null
    for (let page = 0; page < 5; page++) {
      const res = await listThreads(db, { folder: 'inbox', limit: 3, cursor })
      seen.push(...res.threads.map((t) => t.subject))
      cursor = res.nextCursor
      if (!cursor) break
    }
    expect(seen).toEqual(['S6', 'S5', 'S4', 'S3', 'S2', 'S1', 'S0'])
  })

  it('flags attachments but ignores inline images', async () => {
    await add(
      'f1',
      { subject: 'With file', from: 'a@e.com', createdAt: at(1) },
      [attachment('a1')] as never,
    )
    await add(
      'f2',
      { subject: 'Inline only', from: 'b@e.com', createdAt: at(2) },
      [attachment('a2', { disposition: 'inline', contentId: 'c' })] as never,
    )
    const { threads } = await listThreads(db, { folder: 'inbox' })
    expect(
      Object.fromEntries(threads.map((t) => [t.subject, t.hasAttachments])),
    ).toEqual({
      'With file': true,
      'Inline only': false,
    })
  })

  it('searches subject, body and sender with prefix matching', async () => {
    await add('s1', {
      subject: 'Quarterly invoice',
      text: 'amount due',
      from: 'billing@acme.com',
      createdAt: at(1),
    })
    await add('s2', {
      subject: 'Lunch',
      text: 'tacos on friday',
      from: 'bob@other.com',
      createdAt: at(2),
    })
    const q = async (text: string) =>
      (await listThreads(db, { folder: 'all', q: text })).threads.map(
        (t) => t.subject,
      )
    expect(await q('invo')).toEqual(['Quarterly invoice'])
    expect(await q('tacos friday')).toEqual(['Lunch'])
    expect(await q('acme')).toEqual(['Quarterly invoice'])
    expect(await q('nomatch')).toEqual([])
    expect(await q("'; drop table messages; --")).toEqual([])
    expect(await db.select().from(messages)).toHaveLength(2)
  })

  it('keeps trash out of "all" and out of other folders', async () => {
    await add('t1', { subject: 'Trash me', createdAt: at(1) })
    await moveMessages(db, [await idOf('t1')], 'trash')
    expect((await listThreads(db, { folder: 'inbox' })).threads).toHaveLength(0)
    expect((await listThreads(db, { folder: 'all' })).threads).toHaveLength(0)
    expect((await listThreads(db, { folder: 'trash' })).threads).toHaveLength(1)
  })
})

describe('folder moves', () => {
  it('archive removes inbox mail from the inbox and restore brings it back', async () => {
    await add('m1', { createdAt: at(1) })
    const [t] = (await listThreads(db, { folder: 'inbox' })).threads
    await moveThread(db, t?.id ?? '', 'archive')
    expect((await listThreads(db, { folder: 'inbox' })).threads).toHaveLength(0)
    expect((await listThreads(db, { folder: 'archive' })).threads).toHaveLength(
      1,
    )
    await moveThread(db, t?.id ?? '', 'inbox')
    expect((await listThreads(db, { folder: 'inbox' })).threads).toHaveLength(1)
  })

  it('returns our own sent mail to Sent, not Inbox, when restored', async () => {
    await add('m1', { createdAt: at(1) })
    const threadId =
      (
        await getThread(
          db,
          (await listThreads(db, { folder: 'inbox' })).threads[0]?.id ?? '',
        )
      )?.thread.id ?? ''
    await db.insert(messages).values({
      threadId,
      direction: 'out',
      folder: 'sent',
      fromAddress: 'me@tanakadev.digital',
      sentOrReceivedAt: at(2),
      isRead: true,
    })
    await moveThread(db, threadId, 'trash')
    expect(
      (await db.select().from(messages)).every((m) => m.folder === 'trash'),
    ).toBe(true)
    await moveThread(db, threadId, 'inbox')
    const folders = (await db.select().from(messages))
      .map((m) => `${m.direction}:${m.folder}`)
      .sort()
    expect(folders).toEqual(['in:inbox', 'out:sent'])
  })

  it('archiving a thread leaves Sent messages in Sent', async () => {
    await add('m1', { createdAt: at(1) })
    const threadId = (await db.select().from(messages))[0]?.threadId ?? ''
    await db.insert(messages).values({
      threadId,
      direction: 'out',
      folder: 'sent',
      fromAddress: 'me@tanakadev.digital',
      sentOrReceivedAt: at(2),
    })
    await moveThread(db, threadId, 'archive')
    const folders = (await db.select().from(messages))
      .map((m) => m.folder)
      .sort()
    expect(folders).toEqual(['archive', 'sent'])
  })
})

describe('unreadCounts and getThread', () => {
  it('counts threads with unread mail per folder', async () => {
    await add('a', { subject: 'A', from: 'a@e.com', createdAt: at(1) })
    await add('b', { subject: 'B', from: 'b@e.com', createdAt: at(2) })
    expect(await unreadCounts(db)).toEqual({
      inbox: 2,
      archive: 0,
      trash: 0,
      sent: 0,
    })
    await setRead(db, [await idOf('a')], true)
    expect((await unreadCounts(db)).inbox).toBe(1)
  })

  it('returns messages in order with their attachments', async () => {
    await add('a1', { messageId: '<a1@x>', createdAt: at(1) }, [
      attachment('f1'),
    ] as never)
    await add('a2', { headers: { 'in-reply-to': '<a1@x>' }, createdAt: at(2) })
    const threadId = (await db.select().from(messages))[0]?.threadId ?? ''
    const t = await getThread(db, threadId)
    expect(t?.messages.map((m) => m.resendId)).toEqual(['a1', 'a2'])
    expect(t?.attachments).toHaveLength(1)
    expect(
      await getThread(db, '00000000-0000-0000-0000-000000000000'),
    ).toBeNull()
    expect((await db.select().from(attachments)).length).toBe(1)
  })
})
