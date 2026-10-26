import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { isAllowedEndpoint } from '#/server/mail/push'

// Server functions are only reachable with a valid session (enforced in src/start.ts).

const subscription = z.object({
  endpoint: z
    .string()
    .max(2048)
    .refine(isAllowedEndpoint, 'not a known browser push service'),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
})

export const pushConfigFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { env } = await import('#/env.server')
    return { publicKey: env.VAPID_PUBLIC_KEY ?? null }
  },
)

export const subscribePushFn = createServerFn({ method: 'POST' })
  .validator(subscription)
  .handler(async ({ data }) => {
    const [{ pushDeps }, { saveSubscription }] = await Promise.all([
      import('#/server/push.server'),
      import('#/server/mail/push'),
    ])
    const deps = pushDeps()
    if (!deps) return { ok: false as const, error: 'push_disabled' as const }
    await saveSubscription(deps.db, {
      endpoint: data.endpoint,
      p256dh: data.keys.p256dh,
      auth: data.keys.auth,
    })
    return { ok: true as const }
  })

export const unsubscribePushFn = createServerFn({ method: 'POST' })
  .validator(z.object({ endpoint: z.string().max(2048) }))
  .handler(async ({ data }) => {
    const [{ db }, { removeSubscription }] = await Promise.all([
      import('#/db/client'),
      import('#/server/mail/push'),
    ])
    await removeSubscription(db, data.endpoint)
    return { ok: true as const }
  })

export const testPushFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const [{ pushDeps }, { pushToAll, TEST_PAYLOAD }] = await Promise.all([
      import('#/server/push.server'),
      import('#/server/mail/push'),
    ])
    const deps = pushDeps()
    if (!deps) return { sent: 0 }
    const { sent } = await pushToAll(deps, TEST_PAYLOAD)
    return { sent }
  },
)
