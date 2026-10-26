import { beforeEach, describe, expect, it } from 'vitest'
import { messages, threads } from '../src/db/schema'
import type { Db } from '../src/db/types'
import { ingestReceivedEmail } from '../src/server/mail/ingest'
import {
  externalParticipants,
  normalizeMessageId,
  normalizeSubject,
  parseMessageIds,
} from '../src/server/mail/threading'
import { createTestDb } from './db'
import { FakeMail, FakeStore, OWN_DOMAIN, makeEmail } from './fakes'

describe('normalizeSubject', () => {
  it.each([
    ['Re: Hello', 'hello'],
    ['RE: Re: FWD: Hello  World', 'hello world'],
    ['Fwd: Fw: Hello', 'hello'],
    ['AW: Hallo', 'hallo'],
    ['Re[2]: Plan', 'plan'],
    ['Ответ: Привет', 'привет'],
    ['Reply to everything', 'reply to everything'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected)
  })
})

describe('message ids', () => {
  it('normalizes brackets and whitespace', () => {
    expect(normalizeMessageId(' abc@x ')).toBe('<abc@x>')
    expect(normalizeMessageId('<abc@x>')).toBe('<abc@x>')
  })
  it('extracts ids from a References header', () => {
    expect(parseMessageIds('<a@x>\r\n <b@x> <a@x>')).toEqual(['<a@x>', '<b@x>'])
    expect(parseMessageIds(null)).toEqual([])
  })
  it('drops our own domain from participants', () => {
    expect(
      externalParticipants(
        ['Me@tanakadev.digital', 'a@b.com', 'A@B.com'],
        OWN_DOMAIN,
      ),
    ).toEqual(['a@b.com'])
  })
})

let db: Db
let mail: FakeMail
let store: FakeStore
const ingest = (id: string) =>
  ingestReceivedEmail({ db, mail, store, ownDomain: OWN_DOMAIN }, id)
const threadOf = async (resendId: string) =>
  (await db.select().from(messages)).find((m) => m.resendId === resendId)
    ?.threadId

beforeEach(async () => {
  db = (await createTestDb()).db
  mail = new FakeMail()
  store = new FakeStore()
})

describe('thread assignment', () => {
  it('puts a reply in the thread of the message it answers (In-Reply-To)', async () => {
    mail.add(makeEmail({ id: 'e1', messageId: '<m1@x>', subject: 'Plan' }))
    mail.add(
      makeEmail({
        id: 'e2',
        messageId: '<m2@x>',
        subject: 'Totally different subject',
        from: 'bob@other.com',
        headers: { 'In-Reply-To': '<m1@x>' },
        createdAt: new Date('2026-01-01T11:00:00Z'),
      }),
    )
    await ingest('e1')
    await ingest('e2')
    expect(await threadOf('e2')).toBe(await threadOf('e1'))
    expect(await db.select().from(threads)).toHaveLength(1)
  })

  it('uses the References header when In-Reply-To is absent', async () => {
    mail.add(makeEmail({ id: 'e1', messageId: '<m1@x>' }))
    mail.add(
      makeEmail({
        id: 'e2',
        messageId: '<m3@x>',
        subject: 'Other',
        from: 'carol@other.com',
        headers: { references: '<m1@x> <m2@x>' },
        createdAt: new Date('2026-01-01T12:00:00Z'),
      }),
    )
    await ingest('e1')
    await ingest('e2')
    expect(await threadOf('e2')).toBe(await threadOf('e1'))
  })

  it('threads a reply that arrives before the original', async () => {
    mail.add(
      makeEmail({
        id: 'reply',
        messageId: '<r@x>',
        subject: 'Re: Hi',
        headers: { 'in-reply-to': '<orig@x>' },
        createdAt: new Date('2026-01-01T12:00:00Z'),
      }),
    )
    mail.add(
      makeEmail({
        id: 'orig',
        messageId: '<orig@x>',
        subject: 'Unrelated wording',
        from: 'zed@other.com',
        createdAt: new Date('2026-01-01T09:00:00Z'),
      }),
    )
    await ingest('reply')
    await ingest('orig')
    expect(await threadOf('orig')).toBe(await threadOf('reply'))
  })

  it('falls back to subject + shared participant within 30 days', async () => {
    mail.add(makeEmail({ id: 'e1', subject: 'Invoice 42' }))
    mail.add(
      makeEmail({
        id: 'e2',
        subject: 'Re: Invoice 42',
        createdAt: new Date('2026-01-20T10:00:00Z'),
      }),
    )
    await ingest('e1')
    await ingest('e2')
    expect(await threadOf('e2')).toBe(await threadOf('e1'))
  })

  it('does not fall back after more than 30 days', async () => {
    mail.add(makeEmail({ id: 'e1', subject: 'Invoice 42' }))
    mail.add(
      makeEmail({
        id: 'e2',
        subject: 'Re: Invoice 42',
        createdAt: new Date('2026-03-01T10:00:00Z'),
      }),
    )
    await ingest('e1')
    await ingest('e2')
    expect(await threadOf('e2')).not.toBe(await threadOf('e1'))
  })

  it('does not merge same-subject mail from unrelated senders', async () => {
    mail.add(
      makeEmail({ id: 'e1', subject: 'Hello', from: 'alice@example.com' }),
    )
    mail.add(
      makeEmail({ id: 'e2', subject: 'Hello', from: 'mallory@elsewhere.org' }),
    )
    await ingest('e1')
    await ingest('e2')
    expect(await threadOf('e2')).not.toBe(await threadOf('e1'))
  })

  it('never merges empty subjects', async () => {
    mail.add(makeEmail({ id: 'e1', subject: '' }))
    mail.add(makeEmail({ id: 'e2', subject: '' }))
    await ingest('e1')
    await ingest('e2')
    expect(await threadOf('e2')).not.toBe(await threadOf('e1'))
  })

  it('keeps last_message_at at the newest message and merges participants', async () => {
    mail.add(makeEmail({ id: 'e1', subject: 'Plan', messageId: '<m1@x>' }))
    mail.add(
      makeEmail({
        id: 'e2',
        subject: 'Re: Plan',
        from: 'bob@other.com',
        headers: { 'in-reply-to': '<m1@x>' },
        createdAt: new Date('2026-01-02T10:00:00Z'),
      }),
    )
    await ingest('e2') // older-than-reply order is irrelevant; newest date must win
    await ingest('e1')
    const [t] = await db.select().from(threads)
    expect(t?.lastMessageAt.toISOString()).toBe('2026-01-02T10:00:00.000Z')
    expect(t?.participants.sort()).toEqual([
      'alice@example.com',
      'bob@other.com',
    ])
  })
})
