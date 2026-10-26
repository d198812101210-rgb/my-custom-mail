import { eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { Webhook } from 'svix'
import { beforeEach, describe, expect, it } from 'vitest'
import { attachments, messages, threads } from '../src/db/schema'
import type { Db } from '../src/db/types'
import { handleResendWebhook } from '../src/server/mail/webhook'
import type { WebhookDeps } from '../src/server/mail/webhook'
import { createTestDb } from './db'
import { FakeMail, FakeStore, OWN_DOMAIN, attachment, makeEmail } from './fakes'

const SECRET = `whsec_${Buffer.from('test-secret-test-secret-123456').toString('base64')}`
const resend = new Resend('re_test')

let db: Db
let mail: FakeMail
let store: FakeStore
let logs: string[]

beforeEach(async () => {
  db = (await createTestDb()).db
  mail = new FakeMail()
  store = new FakeStore()
  logs = []
})

const deps = (over: Partial<WebhookDeps> = {}): WebhookDeps => ({
  secret: SECRET,
  verify: (opts) => resend.webhooks.verify(opts),
  ingest: { db, mail, store, ownDomain: OWN_DOMAIN },
  log: (l) => logs.push(l),
  ...over,
})

function signed(
  body: object | string,
  { secret = SECRET, id = 'msg_1' } = {},
): Request {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const ts = new Date()
  const signature = new Webhook(secret).sign(id, ts, payload)
  return new Request('https://mail.tanakadev.digital/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(ts.getTime() / 1000)),
      'svix-signature': signature,
      'content-type': 'application/json',
    },
    body: payload,
  })
}

const event = (emailId: string) => ({
  type: 'email.received',
  created_at: '2026-01-01T10:00:00Z',
  data: { email_id: emailId },
})

const count = async () => (await db.select().from(messages)).length

describe('signature verification', () => {
  it('rejects a missing secret with 503 so Resend retries later', async () => {
    const res = await handleResendWebhook(
      signed(event('e1')),
      deps({ secret: undefined }),
    )
    expect(res.status).toBe(503)
  })

  it('rejects missing signature headers', async () => {
    const req = new Request('https://x/api/webhooks/resend', {
      method: 'POST',
      body: JSON.stringify(event('e1')),
    })
    expect((await handleResendWebhook(req, deps())).status).toBe(400)
  })

  it('rejects a signature made with another secret', async () => {
    const other = `whsec_${Buffer.from('another-secret-another-secret-12').toString('base64')}`
    mail.add(makeEmail({ id: 'e1' }))
    const res = await handleResendWebhook(
      signed(event('e1'), { secret: other }),
      deps(),
    )
    expect(res.status).toBe(400)
    expect(await count()).toBe(0)
  })

  it('rejects a body altered after signing (e.g. re-serialized)', async () => {
    mail.add(makeEmail({ id: 'e1' }))
    const payload = JSON.stringify(event('e1'))
    const req = signed(payload)
    const tampered = new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(JSON.parse(payload), null, 2),
    })
    expect((await handleResendWebhook(tampered, deps())).status).toBe(400)
    expect(await count()).toBe(0)
  })
})

describe('event handling', () => {
  it('acknowledges and ignores other event types', async () => {
    const res = await handleResendWebhook(
      signed({
        type: 'email.delivered',
        created_at: 'x',
        data: { email_id: 'e1' },
      }),
      deps(),
    )
    expect(res.status).toBe(200)
    expect(await count()).toBe(0)
    expect(mail.getCalls).toBe(0)
  })

  it('rejects an email.received payload without an email id', async () => {
    const res = await handleResendWebhook(
      signed({ type: 'email.received', created_at: 'x', data: {} }),
      deps(),
    )
    expect(res.status).toBe(400)
  })

  it('stores the message, its fields and its attachments', async () => {
    mail.add(
      makeEmail({
        id: 'e1',
        from: 'Alice Smith <Alice@Example.com>',
        to: ['Test <test@tanakadev.digital>', 'other@tanakadev.digital'],
        receivedFor: ['test@tanakadev.digital'],
        headers: {
          'Authentication-Results':
            'amazonses.com; spf=pass; dkim=fail; dmarc=pass',
          'In-Reply-To': '<prev@x>',
          References: '<a@x> <prev@x>',
        },
      }),
      [
        attachment('a1'),
        attachment('a2', { contentId: 'cid1', disposition: 'inline' }),
      ],
    )
    const res = await handleResendWebhook(signed(event('e1')), deps())
    expect(res.status).toBe(200)

    const [m] = await db.select().from(messages)
    expect(m).toMatchObject({
      resendId: 'e1',
      direction: 'in',
      folder: 'inbox',
      isRead: false,
      fromAddress: 'alice@example.com',
      fromName: 'Alice Smith',
      toAddresses: ['test@tanakadev.digital', 'other@tanakadev.digital'],
      receivedFor: ['test@tanakadev.digital'],
      messageIdHeader: '<e1@example.com>',
      inReplyTo: '<prev@x>',
      referencesHeader: '<a@x> <prev@x>',
      spf: 'pass',
      dkim: 'fail',
      dmarc: 'pass',
    })
    const atts = await db
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, m?.id ?? ''))
    expect(atts.map((a) => a.storagePath).sort()).toEqual([
      'inbound/e1/a1',
      'inbound/e1/a2',
    ])
    expect(store.objects.get('inbound/e1/a1')?.contentType).toBe(
      'application/pdf',
    )
  })
})

describe('idempotency', () => {
  it('replaying the same webhook twice creates exactly one message', async () => {
    mail.add(makeEmail({ id: 'e1' }), [attachment('a1')])
    const first = await handleResendWebhook(
      signed(event('e1'), { id: 'msg_1' }),
      deps(),
    )
    const second = await handleResendWebhook(
      signed(event('e1'), { id: 'msg_1' }),
      deps(),
    )
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toMatchObject({ result: 'imported' })
    expect(await second.json()).toMatchObject({ result: 'duplicate' })
    expect(await count()).toBe(1)
    expect(await db.select().from(attachments)).toHaveLength(1)
    expect(await db.select().from(threads)).toHaveLength(1)
    expect(mail.getCalls).toBe(1)
    expect(store.puts).toBe(1)
  })

  it('concurrent deliveries of the same email create exactly one message', async () => {
    mail.add(makeEmail({ id: 'e1' }), [attachment('a1')])
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        handleResendWebhook(signed(event('e1'), { id: `msg_${i}` }), deps()),
      ),
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(await count()).toBe(1)
    expect(await db.select().from(attachments)).toHaveLength(1)
    expect(await db.select().from(threads)).toHaveLength(1)
  })

  it('concurrent replies do not split a conversation into two threads', async () => {
    mail.add(makeEmail({ id: 'e1', messageId: '<m1@x>', subject: 'Plan' }))
    mail.add(
      makeEmail({
        id: 'e2',
        messageId: '<m2@x>',
        subject: 'Re: Plan',
        headers: { 'in-reply-to': '<m1@x>' },
        createdAt: new Date('2026-01-01T11:00:00Z'),
      }),
    )
    mail.add(
      makeEmail({
        id: 'e3',
        messageId: '<m3@x>',
        subject: 'Re: Plan',
        headers: { 'in-reply-to': '<m1@x>' },
        createdAt: new Date('2026-01-01T12:00:00Z'),
      }),
    )
    await Promise.all(
      ['e1', 'e2', 'e3'].map((id) =>
        handleResendWebhook(signed(event(id)), deps()),
      ),
    )
    expect(await count()).toBe(3)
    expect(await db.select().from(threads)).toHaveLength(1)
  })
})

describe('failures are retryable', () => {
  it('returns 500 and stores nothing when Resend is unavailable, then succeeds on retry', async () => {
    mail.add(makeEmail({ id: 'e1' }))
    mail.failNextGet = true
    const failed = await handleResendWebhook(signed(event('e1')), deps())
    expect(failed.status).toBe(500)
    expect(await count()).toBe(0)

    const retried = await handleResendWebhook(signed(event('e1')), deps())
    expect(retried.status).toBe(200)
    expect(await count()).toBe(1)
  })

  it('returns 500 and saves no message when an attachment cannot be fetched', async () => {
    mail.add(makeEmail({ id: 'e1' }), [attachment('a1')])
    mail.failDownloads = true
    const failed = await handleResendWebhook(signed(event('e1')), deps())
    expect(failed.status).toBe(500)
    expect(await count()).toBe(0)

    mail.failDownloads = false
    const retried = await handleResendWebhook(signed(event('e1')), deps())
    expect(retried.status).toBe(200)
    expect(await count()).toBe(1)
    expect(await db.select().from(attachments)).toHaveLength(1)
  })

  it('does not log mail content or error messages', async () => {
    mail.add(
      makeEmail({
        id: 'e1',
        subject: 'TOP-SECRET-SUBJECT',
        text: 'TOP-SECRET-BODY',
      }),
    )
    mail.failNextGet = true
    await handleResendWebhook(signed(event('e1')), deps())
    expect(logs.length).toBeGreaterThan(0)
    const all = logs.join('\n')
    expect(all).not.toContain('TOP-SECRET')
    expect(all).not.toContain('resend is down') // error message text is never logged
    expect(all).not.toContain(SECRET)
  })
})
