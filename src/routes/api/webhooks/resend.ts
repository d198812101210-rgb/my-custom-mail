import { createFileRoute } from '@tanstack/react-router'

// Public route: authenticated by the Svix signature, not by a session.
export const Route = createFileRoute('/api/webhooks/resend')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { env },
          { db },
          { resend },
          sources,
          { handleResendWebhook },
          address,
          push,
          pushServer,
        ] = await Promise.all([
          import('#/env.server'),
          import('#/db/client'),
          import('#/server/mail/resend.server'),
          import('#/server/mail/sources.server'),
          import('#/server/mail/webhook'),
          import('#/server/mail/address'),
          import('#/server/mail/push'),
          import('#/server/push.server'),
        ])
        const pushTarget = pushServer.pushDeps()
        return handleResendWebhook(request, {
          secret: env.RESEND_WEBHOOK_SECRET,
          verify: (opts) => resend.webhooks.verify(opts),
          ingest: {
            db,
            mail: sources.resendSource,
            store: sources.supabaseStore,
            ownDomain: address.mailboxDomain(env.MAIL_FROM),
          },
          notify: pushTarget
            ? (emailId) => push.notifyNewMail(pushTarget, emailId)
            : undefined,
          log: (line) => console.error(line),
        })
      },
    },
  },
})
