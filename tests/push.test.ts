import { eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { Webhook } from 'svix'
import { beforeEach, describe, expect, it } from 'vitest'
import { pushSubscriptions } from '../src/db/schema'
import type { Db } from '../src/db/types'
import {
  buildPayload,
  isAllowedEndpoint,
  notifyNewMail,
  pushToAll,
  removeSubscription,
  saveSubscription,
} from '../src/server/mail/push'
import type { PushSender, PushTarget } from '../src/server/mail/push'
import { handleResendWebhook } from '../src/server/mail/webhook'
import { threadIdFromMessage } from '../src/lib/push'
import { createTestDb } from './db'
import { FakeMail, FakeStore, OWN_DOMAIN, makeEmail } from './fakes'

const EP = 'https://fcm.googleapis.com/fcm/send/abc'
const target = (endpoint = EP): PushTarget => ({
  endpoint,
  p256dh: 'p256',
  auth: 'auth',
})

class FakeSender implements PushSender {
  sent: { target: PushTarget; payload: string }[] = []
  failWith = new Map<string, unknown>()
  send(t: PushTarget, payload: string) {
    const err = this.failWith.get(t.endpoint)
    if (err) return Promise.reject(err)
    this.sent.push({ target: t, payload })
    return Promise.resolve()
  }
}

let db: Db
let sender: FakeSender
let logs: string[]

beforeEach(async () => {
  db = (await createTestDb()).db
  sender = new FakeSender()
  logs = []
})

const deps = () => ({ db, sender, log: (l: string) => logs.push(l) })

describe('push endpoint allow-list', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/x',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
    'https://web.push.apple.com/x',
  ])('accepts %s', (u) => expect(isAllowedEndpoint(u)).toBe(true))

  it.each([
    'http://fcm.googleapis.com/x',
    'https://evil.example/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilnotify.windows.com.example/x',
    'https://notify.windows.com.evil.example/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://169.254.169.254/latest/meta-data',
    'not a url',
    '',
  ])('rejects %s', (u) => expect(isAllowedEndpoint(u)).toBe(false))
})

describe('subscriptions', () => {
  it('upserts by endpoint', async () => {
    await saveSubscription(db, target())
    await saveSubscription(db, { ...target(), p256dh: 'new', auth: 'new2' })
    const rows = await db.select().from(pushSubscriptions)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ p256dh: 'new', auth: 'new2' })
  })

  it('removes by endpoint', async () => {
    await saveSubscription(db, target())
    await removeSubscription(db, EP)
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0)
  })
})

describe('payload', () => {
  it('shows sender name, subject and a thread link', () => {
    expect(
      buildPayload({
        threadId: 'tid',
        fromName: 'Ada',
        fromAddress: 'ada@x.example',
        subject: 'Hello',
      }),
    ).toEqual({
      title: 'Ada',
      body: 'Hello',
      url: '/thread/tid',
      tag: 'tid',
    })
  })

  it('falls back to the address and a placeholder subject', () => {
    const p = buildPayload({
      threadId: 't',
      fromName: null,
      fromAddress: 'ada@x.example',
      subject: '',
    })
    expect(p.title).toBe('ada@x.example')
    expect(p.body).toBe('(no subject)')
  })

  it('strips control characters and truncates long text', () => {
    const p = buildPayload({
      threadId: 't',
      fromName: 'A\u0000\nB',
      fromAddress: 'a@x.example',
      subject: 's'.repeat(1000),
    })
    expect(p.title).toBe('A B')
    expect(p.body).toHaveLength(140)
  })
})

describe('pushToAll', () => {
  const payload = { title: 't', body: 'b', url: '/inbox', tag: 'x' }

  it('sends the payload to every subscription', async () => {
    await saveSubscription(db, target())
    await saveSubscription(
      db,
      target('https://fcm.googleapis.com/fcm/send/two'),
    )
    const r = await pushToAll(deps(), payload)
    expect(r).toEqual({ sent: 2, removed: 0, failed: 0 })
    expect(JSON.parse(sender.sent[0]?.payload ?? '')).toEqual(payload)
  })

  it('does nothing without subscriptions', async () => {
    expect(await pushToAll(deps(), payload)).toEqual({
      sent: 0,
      removed: 0,
      failed: 0,
    })
  })

  it.each([404, 410])(
    'deletes a subscription the service answers %i for',
    async (statusCode) => {
      await saveSubscription(db, target())
      sender.failWith.set(EP, { statusCode })
      const r = await pushToAll(deps(), payload)
      expect(r).toEqual({ sent: 0, removed: 1, failed: 0 })
      expect(await db.select().from(pushSubscriptions)).toHaveLength(0)
    },
  )

  it('keeps a subscription after a transient failure and logs only a safe summary', async () => {
    await saveSubscription(db, target())
    const err = Object.assign(new Error('secret endpoint token'), {
      statusCode: 503,
    })
    sender.failWith.set(EP, err)
    const r = await pushToAll(deps(), payload)
    expect(r).toEqual({ sent: 0, removed: 0, failed: 1 })
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1)
    expect(logs.join()).not.toContain('secret')
    expect(logs.join()).toContain('statusCode=503')
  })

  it('one dead subscription does not stop the others', async () => {
    const other = 'https://fcm.googleapis.com/fcm/send/two'
    await saveSubscription(db, target())
    await saveSubscription(db, target(other))
    sender.failWith.set(EP, { statusCode: 410 })
    const r = await pushToAll(deps(), payload)
    expect(r).toEqual({ sent: 1, removed: 1, failed: 0 })
    const left = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, other))
    expect(left).toHaveLength(1)
  })
})

describe('new mail webhook', () => {
  const SECRET = `whsec_${Buffer.from('test-secret-test-secret-123456').toString('base64')}`
  const resend = new Resend('re_test')

  function signed(emailId: string, id = 'msg_1'): Request {
    const payload = JSON.stringify({
      type: 'email.received',
      data: { email_id: emailId },
    })
    const ts = new Date()
    return new Request('https://mail.tanakadev.digital/api/webhooks/resend', {
      method: 'POST',
      headers: {
        'svix-id': id,
        'svix-timestamp': String(Math.floor(ts.getTime() / 1000)),
        'svix-signature': new Webhook(SECRET).sign(id, ts, payload),
      },
      body: payload,
    })
  }

  function setup(notify: (id: string) => Promise<unknown>) {
    const mail = new FakeMail()
    mail.add(
      makeEmail({
        id: 'e1',
        from: 'Ada <ada@x.example>',
        subject: 'Lunch?',
      }),
    )
    return {
      secret: SECRET,
      verify: (o: Parameters<typeof resend.webhooks.verify>[0]) =>
        resend.webhooks.verify(o),
      ingest: { db, mail, store: new FakeStore(), ownDomain: OWN_DOMAIN },
      notify,
      log: (l: string) => logs.push(l),
    }
  }

  it('notifies once for a new email and not for a replay', async () => {
    await saveSubscription(db, target())
    const d = setup((id) => notifyNewMail(deps(), id))
    expect((await handleResendWebhook(signed('e1'), d)).status).toBe(200)
    expect(sender.sent).toHaveLength(1)
    const body = JSON.parse(sender.sent[0]?.payload ?? '') as {
      title: string
      body: string
      url: string
    }
    expect(body).toMatchObject({ title: 'Ada', body: 'Lunch?' })
    expect(body.url).toMatch(/^\/thread\/[0-9a-f-]{36}$/)

    await handleResendWebhook(signed('e1', 'msg_2'), d)
    expect(sender.sent).toHaveLength(1)
  })

  it('still answers 200 when sending the notification throws', async () => {
    const d = setup(() => Promise.reject(new Error('push down')))
    const res = await handleResendWebhook(signed('e1'), d)
    expect(res.status).toBe(200)
    expect(logs.join()).toContain('notify failed')
  })

  it('works without a notifier', async () => {
    const d = { ...setup(() => Promise.resolve()), notify: undefined }
    expect((await handleResendWebhook(signed('e1'), d)).status).toBe(200)
  })
})

describe('notification click message', () => {
  it('extracts the thread id and ignores anything else', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    expect(threadIdFromMessage({ type: 'open', url: `/thread/${id}` })).toBe(id)
    expect(threadIdFromMessage({ type: 'open', url: '/inbox' })).toBeNull()
    expect(
      threadIdFromMessage({
        type: 'open',
        url: 'https://evil.example/thread/x',
      }),
    ).toBeNull()
    expect(
      threadIdFromMessage({ type: 'other', url: `/thread/${id}` }),
    ).toBeNull()
    expect(threadIdFromMessage(null)).toBeNull()
    expect(threadIdFromMessage('x')).toBeNull()
  })
})
