import webpush from 'web-push'
import { env } from '#/env.server'
import { db } from '#/db/client'
import type { PushDeps, PushSender } from './mail/push'

export const pushEnabled = Boolean(
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY,
)

const sender: PushSender = {
  async send(target, payload) {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      payload,
      {
        vapidDetails: {
          // The push service sees this: the app's own address, never the owner's mailbox.
          // VAPID wants https or mailto, so local http gets a placeholder that is never contacted.
          subject: env.APP_URL.startsWith('https:')
            ? env.APP_URL
            : 'mailto:noreply@localhost.invalid',
          publicKey: env.VAPID_PUBLIC_KEY ?? '',
          privateKey: env.VAPID_PRIVATE_KEY ?? '',
        },
        TTL: 24 * 3600,
        urgency: 'normal',
        timeout: 5000,
      },
    )
  },
}

/** Null when VAPID keys are not configured, so callers skip notifications entirely. */
export function pushDeps(): PushDeps | null {
  if (!pushEnabled) return null
  return { db, sender, log: (line) => console.error(line) }
}
