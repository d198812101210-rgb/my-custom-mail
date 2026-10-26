import { desc, eq, inArray } from 'drizzle-orm'
import { messages, pushSubscriptions } from '#/db/schema'
import type { PushSubscriptionRow } from '#/db/schema'
import type { Db } from '#/db/types'
import { describeError } from '../log'

/** What the browser hands over after `pushManager.subscribe()`. */
export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

/** Delivers one encrypted payload. Rejects with an object carrying `statusCode` when the push service refuses. */
export interface PushSender {
  send: (target: PushTarget, payload: string) => Promise<void>
}

export interface PushDeps {
  db: Db
  sender: PushSender
  log?: (line: string) => void
}

export interface NotificationPayload {
  title: string
  body: string
  /** Same-origin path the notification opens. */
  url: string
  /** Notifications with the same tag replace each other (one per thread). */
  tag: string
}

// Only the push services of mainstream browsers. The endpoint is a URL the server will POST to,
// so anything else would turn the subscribe call into a way to make this server request arbitrary hosts.
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Brave, Opera
  '.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // Windows Notification Service
  '.push.apple.com', // Safari
]

export function isAllowedEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username) return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOST_SUFFIXES.some((s) =>
    s.startsWith('.') ? host.endsWith(s) : host === s,
  )
}

export async function saveSubscription(
  db: Db,
  target: PushTarget,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values(target)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: target.p256dh, auth: target.auth },
    })
}

export async function removeSubscription(
  db: Db,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
}

// Control characters would only make a notification look broken; lengths keep the payload far
// below the ~4 KB a push message may carry.
const clean = (text: string, max: number) =>
  Array.from(text, (ch) => (ch < ' ' || ch === '\u007f' ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

export function buildPayload(m: {
  threadId: string
  fromName: string | null
  fromAddress: string
  subject: string | null
}): NotificationPayload {
  return {
    title: clean(m.fromName || m.fromAddress, 80) || 'New mail',
    body: clean(m.subject ?? '', 140) || '(no subject)',
    url: `/thread/${m.threadId}`,
    tag: m.threadId,
  }
}

export interface PushResult {
  sent: number
  removed: number
  failed: number
}

/** Sends to every subscription. A 404/410 means the browser unsubscribed, so that row is deleted. */
export async function pushToAll(
  deps: PushDeps,
  payload: NotificationPayload,
): Promise<PushResult> {
  const subs: PushSubscriptionRow[] = await deps.db
    .select()
    .from(pushSubscriptions)
    .orderBy(desc(pushSubscriptions.createdAt))
  const body = JSON.stringify(payload)
  const gone: string[] = []
  let sent = 0
  let failed = 0

  await Promise.all(
    subs.map(async (s) => {
      try {
        await deps.sender.send(s, body)
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number } | null)?.statusCode
        if (status === 404 || status === 410) {
          gone.push(s.id)
        } else {
          failed++
          deps.log?.(`push: send failed: ${describeError(e)}`)
        }
      }
    }),
  )

  if (gone.length > 0) {
    await deps.db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, gone))
  }
  return { sent, removed: gone.length, failed }
}

/** Notifies about a message that was just imported (looked up by its Resend id). */
export async function notifyNewMail(
  deps: PushDeps,
  resendId: string,
): Promise<PushResult | null> {
  const [m] = await deps.db
    .select({
      threadId: messages.threadId,
      fromName: messages.fromName,
      fromAddress: messages.fromAddress,
      subject: messages.subject,
    })
    .from(messages)
    .where(eq(messages.resendId, resendId))
    .limit(1)
  if (!m) return null
  return pushToAll(deps, buildPayload(m))
}

export const TEST_PAYLOAD: NotificationPayload = {
  title: 'Mailbox',
  body: 'Notifications are working.',
  url: '/inbox',
  tag: 'test',
}
