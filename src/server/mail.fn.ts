import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Server functions are only reachable with a valid session (enforced in src/start.ts).

export const syncMail = createServerFn({ method: 'POST' })
  .validator(z.object({ full: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const [
      { env },
      { db },
      sources,
      { syncReceivedEmails },
      { mailboxDomain },
    ] = await Promise.all([
      import('#/env.server'),
      import('#/db/client'),
      import('#/server/mail/sources.server'),
      import('#/server/mail/sync'),
      import('#/server/mail/address'),
    ])
    return syncReceivedEmails(
      {
        db,
        mail: sources.resendSource,
        store: sources.supabaseStore,
        ownDomain: mailboxDomain(env.MAIL_FROM),
      },
      { full: data.full, log: (line) => console.error(line) },
    )
  })
