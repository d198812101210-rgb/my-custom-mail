import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { attachments, messages, threads } from '../src/db/schema'
import type { Db } from '../src/db/types'
import { ingestReceivedEmail } from '../src/server/mail/ingest'
import {
  MAX_EMAIL_BYTES,
  messageIdFor,
  sendMessage,
  uploadPrefix,
} from '../src/server/mail/send'
import type { SendDeps, SendInput } from '../src/server/mail/send'
import { ownIdentity } from '../src/server/mail/compose'
import { createTestDb } from './db'
import {
  FakeBlobs,
  FakeMail,
  FakeMailer,
  FakeStore,
  OWN_DOMAIN,
  attachment,
  makeEmail,
} from './fakes'

let db: Db
let mailer: FakeMailer
let blobs: FakeBlobs
let logs: string[]
let clock: number
const FROM = 'Me <me@tanakadev.digital>'
const DRAFT = '11111111-1111-4111-8111-111111111111'

const deps = (): SendDeps => ({
  db,
  mailer,
  blobs,
  from: FROM,
  own: ownIdentity(FROM),
  now: () => new Date(clock),
  log: (l) => logs.push(l),
})

const input = (over: Partial<SendInput> = {}): SendInput => ({
  draftId: DRAFT,
  mode: 'new',
  to: ['bob@example.com'],
  cc: [],
  bcc: [],
  subject: 'Hello',
  text: 'Body text',
  uploads: [],
  forwardAttachmentIds: [],
  ...over,
})

beforeEach(async () => {
  db = (await createTestDb()).db
  mailer = new FakeMailer()
  blobs = new FakeBlobs()
  logs = []
  clock = Date.UTC(2026, 0, 5, 12, 0, 0)
})

/** Receives an inbound email so there is something to reply to. */
async function receive(
  id: string,
  over: Parameters<typeof makeEmail>[0] extends infer T
    ? Partial<T>
    : never = {},
  atts = [],
) {
  const mail = new FakeMail()
  mail.add(makeEmail({ id, ...over }), atts)
  await ingestReceivedEmail(
    { db, mail, store: new FakeStore(), ownDomain: OWN_DOMAIN },
    id,
  )
  return (await db.select().from(messages).where(eq(messages.resendId, id)))[0]!
}

describe('sending a new message', () => {
  it('sends text and html, stores it in Sent as read, and creates a thread', async () => {
    const res = await sendMessage(
      deps(),
      input({ to: ['Bob <BOB@example.com>', 'bob@example.com'] }),
    )
    expect(res).toMatchObject({ ok: true, duplicate: false })

    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]).toMatchObject({
      from: FROM,
      to: ['bob@example.com'],
      subject: 'Hello',
      text: 'Body text',
    })
    expect(mailer.sent[0]?.html).toContain('Body text')
    expect(mailer.sent[0]?.headers['Message-ID']).toBe(
      messageIdFor(DRAFT, 'tanakadev.digital'),
    )

    const [m] = await db.select().from(messages)
    expect(m).toMatchObject({
      direction: 'out',
      folder: 'sent',
      isRead: true,
      fromAddress: 'me@tanakadev.digital',
      toAddresses: ['bob@example.com'],
      resendId: 'sent_1',
      messageIdHeader: `<${DRAFT}@tanakadev.digital>`,
    })
    expect(await db.select().from(threads)).toHaveLength(1)
  })

  it('requires a recipient and caps their number', async () => {
    expect(await sendMessage(deps(), input({ to: [] }))).toEqual({
      ok: false,
      error: 'no_recipients',
    })
    const many = Array.from({ length: 51 }, (_, i) => `u${i}@example.com`)
    expect(await sendMessage(deps(), input({ to: many }))).toEqual({
      ok: false,
      error: 'too_many_recipients',
    })
    expect(mailer.sent).toHaveLength(0)
  })

  it('keeps bcc out of the stored To/Cc but records it', async () => {
    await sendMessage(deps(), input({ bcc: ['secret@example.com'] }))
    const [m] = await db.select().from(messages)
    expect(m?.toAddresses).toEqual(['bob@example.com'])
    expect(m?.bcc).toEqual(['secret@example.com'])
  })
})

describe('replying', () => {
  it('sets In-Reply-To and References and files the reply in the original thread', async () => {
    const orig = await receive('r1', {
      messageId: '<orig@example.com>',
      headers: { References: '<root@example.com>' },
      subject: 'Plan',
    })
    const res = await sendMessage(
      deps(),
      input({
        mode: 'reply',
        sourceMessageId: orig.id,
        to: ['alice@example.com'],
        subject: 'Re: Plan',
      }),
    )
    expect(res).toMatchObject({ ok: true, threadId: orig.threadId })
    expect(mailer.sent[0]?.headers).toMatchObject({
      'In-Reply-To': '<orig@example.com>',
      References: '<root@example.com> <orig@example.com>',
    })
    expect(mailer.sent[0]?.html).toContain('<blockquote')
    expect(mailer.sent[0]?.text).toContain('> Hi')

    const rows = await db.select().from(messages)
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.threadId)).size).toBe(1)
    expect(await db.select().from(threads)).toHaveLength(1)
    const out = rows.find((r) => r.direction === 'out')
    expect(out).toMatchObject({
      inReplyTo: '<orig@example.com>',
      referencesHeader: '<root@example.com> <orig@example.com>',
    })
  })

  it('does not add reply headers to a forward', async () => {
    const orig = await receive('r1', { messageId: '<orig@example.com>' })
    await sendMessage(
      deps(),
      input({
        mode: 'forward',
        sourceMessageId: orig.id,
        subject: 'Fwd: Hello',
      }),
    )
    expect(mailer.sent[0]?.headers['In-Reply-To']).toBeUndefined()
    expect(mailer.sent[0]?.text).toContain('Forwarded message')
  })

  it('fails cleanly when the source message does not exist', async () => {
    const res = await sendMessage(
      deps(),
      input({
        mode: 'reply',
        sourceMessageId: '22222222-2222-4222-8222-222222222222',
      }),
    )
    expect(res).toEqual({ ok: false, error: 'source_not_found' })
    expect(mailer.sent).toHaveLength(0)
  })
})

describe('threading of conversations we take part in', () => {
  it('threads a later inbound reply to our sent message by Message-ID', async () => {
    await sendMessage(
      deps(),
      input({ subject: 'Question', to: ['bob@example.com'] }),
    )
    const mail = new FakeMail()
    mail.add(
      makeEmail({
        id: 'in1',
        from: 'bob@example.com',
        subject: 'Totally reworded',
        headers: { 'In-Reply-To': messageIdFor(DRAFT, 'tanakadev.digital') },
        createdAt: new Date(clock + 3600_000),
      }),
    )
    await ingestReceivedEmail(
      { db, mail, store: new FakeStore(), ownDomain: OWN_DOMAIN },
      'in1',
    )
    expect(await db.select().from(threads)).toHaveLength(1)
  })

  it('still threads by subject and participant when the provider rewrites the Message-ID', async () => {
    await sendMessage(
      deps(),
      input({ subject: 'Question', to: ['bob@example.com'] }),
    )
    const mail = new FakeMail()
    mail.add(
      makeEmail({
        id: 'in1',
        from: 'bob@example.com',
        subject: 'Re: Question',
        headers: { 'In-Reply-To': '<0100018abc@email.amazonses.com>' },
        createdAt: new Date(clock + 3600_000),
      }),
    )
    await ingestReceivedEmail(
      { db, mail, store: new FakeStore(), ownDomain: OWN_DOMAIN },
      'in1',
    )
    expect(await db.select().from(threads)).toHaveLength(1)
  })
})

describe('idempotency and failure handling', () => {
  it('sending the same draft twice delivers and stores it once', async () => {
    const first = await sendMessage(deps(), input())
    const second = await sendMessage(deps(), input())
    expect(first).toMatchObject({ ok: true, duplicate: false })
    expect(second).toMatchObject({ ok: true, duplicate: true })
    expect(mailer.sent).toHaveLength(1)
    expect(await db.select().from(messages)).toHaveLength(1)
  })

  it('concurrent double submit sends once', async () => {
    const results = await Promise.all([
      sendMessage(deps(), input()),
      sendMessage(deps(), input()),
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(mailer.sent).toHaveLength(1)
    expect(await db.select().from(messages)).toHaveLength(1)
  })

  it('stores nothing and can retry when the provider rejects the message', async () => {
    mailer.fail = true
    expect(await sendMessage(deps(), input())).toEqual({
      ok: false,
      error: 'send_failed',
    })
    expect(await db.select().from(messages)).toHaveLength(0)
    mailer.fail = false
    expect(await sendMessage(deps(), input())).toMatchObject({
      ok: true,
      duplicate: false,
    })
    expect(mailer.sent).toHaveLength(1)
  })

  it('reports sent-but-not-saved and recovers on retry without sending twice', async () => {
    blobs.seed(`${uploadPrefix(DRAFT)}a`, 'file-bytes', 'text/plain')
    const withFile = input({
      uploads: [
        {
          path: `${uploadPrefix(DRAFT)}a`,
          filename: 'a.txt',
          contentType: 'text/plain',
        },
      ],
    })
    blobs.failNextPut = true
    expect(await sendMessage(deps(), withFile)).toEqual({
      ok: false,
      error: 'sent_but_not_saved',
    })
    expect(mailer.sent).toHaveLength(1)
    expect(await db.select().from(messages)).toHaveLength(0)
    expect(blobs.objects.has(`${uploadPrefix(DRAFT)}a`)).toBe(true) // temp file kept for the retry

    expect(await sendMessage(deps(), withFile)).toMatchObject({ ok: true })
    expect(mailer.sent).toHaveLength(1)
    expect(await db.select().from(messages)).toHaveLength(1)
  })

  it('does not log message content', async () => {
    mailer.fail = true
    await sendMessage(
      deps(),
      input({ subject: 'TOP-SECRET-SUBJECT', text: 'TOP-SECRET-BODY' }),
    )
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.join('\n')).not.toMatch(/TOP-SECRET|provider down/)
  })
})

describe('attachments', () => {
  const path = (n: string) => `${uploadPrefix(DRAFT)}${n}`

  it('sends uploaded files, keeps a permanent copy and clears the temp upload', async () => {
    blobs.seed(path('a'), 'hello file', 'text/plain')
    const res = await sendMessage(
      deps(),
      input({
        uploads: [
          { path: path('a'), filename: 'note.txt', contentType: 'text/plain' },
        ],
      }),
    )
    expect(res.ok).toBe(true)
    const sent = mailer.sent[0]?.attachments[0]
    expect(sent).toMatchObject({
      filename: 'note.txt',
      contentType: 'text/plain',
    })
    expect(new TextDecoder().decode(sent?.content)).toBe('hello file')

    const [row] = await db.select().from(attachments)
    expect(row).toMatchObject({
      filename: 'note.txt',
      size: 10,
      storagePath: `outbound/sent/${DRAFT}/0`,
    })
    expect(blobs.objects.has(`outbound/sent/${DRAFT}/0`)).toBe(true)
    expect(blobs.objects.has(path('a'))).toBe(false)
  })

  it('refuses paths outside the draft prefix, including traversal', async () => {
    blobs.seed('inbound/secret/file', 'secret')
    for (const bad of [
      'inbound/secret/file',
      `outbound/tmp/22222222-2222-4222-8222-222222222222/a`,
      `${uploadPrefix(DRAFT)}../../inbound/secret/file`,
    ]) {
      const res = await sendMessage(
        deps(),
        input({
          uploads: [{ path: bad, filename: 'x', contentType: 'text/plain' }],
        }),
      )
      expect(res).toEqual({ ok: false, error: 'invalid_upload' })
    }
    expect(mailer.sent).toHaveLength(0)
  })

  it('rejects a message that would exceed Resend’s 40 MB limit', async () => {
    const big = new Uint8Array(Math.ceil((MAX_EMAIL_BYTES * 3) / 4) + 10)
    blobs.objects.set(path('big'), {
      bytes: big,
      contentType: 'application/octet-stream',
    })
    const res = await sendMessage(
      deps(),
      input({
        uploads: [
          {
            path: path('big'),
            filename: 'big.bin',
            contentType: 'application/octet-stream',
          },
        ],
      }),
    )
    expect(res).toEqual({ ok: false, error: 'too_large' })
    expect(mailer.sent).toHaveLength(0)
  })

  it('forwards the original attachments, but only those of the source message', async () => {
    const orig = await receive('r1', { messageId: '<o@x>' }, [
      attachment('f1'),
    ] as never)
    const other = await receive('r2', { messageId: '<p@x>', from: 'z@z.com' }, [
      attachment('f2'),
    ] as never)
    const [own] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, orig.id))
    const [foreign] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, other.id))
    blobs.seed(own?.storagePath ?? '', 'orig-bytes', 'application/pdf')
    blobs.seed(foreign?.storagePath ?? '', 'foreign-bytes', 'application/pdf')

    const ok = await sendMessage(
      deps(),
      input({
        mode: 'forward',
        sourceMessageId: orig.id,
        forwardAttachmentIds: [own?.id ?? ''],
      }),
    )
    expect(ok.ok).toBe(true)
    expect(mailer.sent[0]?.attachments).toHaveLength(1)

    const stolen = await sendMessage(
      deps(),
      input({
        draftId: '33333333-3333-4333-8333-333333333333',
        mode: 'forward',
        sourceMessageId: orig.id,
        forwardAttachmentIds: [foreign?.id ?? ''],
      }),
    )
    expect(stolen).toEqual({ ok: false, error: 'invalid_upload' })
    expect(mailer.sent).toHaveLength(1)
  })
})
