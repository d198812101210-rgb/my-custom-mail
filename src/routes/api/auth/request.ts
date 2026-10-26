import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/request')({
  server: {
    handlers: {
      POST: async () => {
        const [{ db }, { requestOtp }, { sendLoginCode }] = await Promise.all([
          import('#/db/client'),
          import('#/server/auth/otp'),
          import('#/server/mail/resend.server'),
        ])
        const result = await requestOtp({
          db,
          now: () => new Date(),
          sendCode: sendLoginCode,
        })
        if (result === 'sent') return Response.json({ ok: true })
        if (result === 'rate_limited') {
          return Response.json(
            { ok: false, error: 'rate_limited' },
            { status: 429 },
          )
        }
        return Response.json(
          { ok: false, error: 'send_failed' },
          { status: 502 },
        )
      },
    },
  },
})
