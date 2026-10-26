import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const body = z.object({ code: z.string().regex(/^\d{6}$/) })

export const Route = createFileRoute('/api/auth/verify')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
          return Response.json({ ok: false, error: 'invalid' }, { status: 400 })
        }
        const [{ db }, { verifyOtp }, { createSession }, ctx, cookie] = await Promise.all([
          import('#/db/client'),
          import('#/server/auth/otp'),
          import('#/server/auth/session'),
          import('#/server/auth/context.server'),
          import('#/server/auth/cookie'),
        ])
        const now = () => new Date()
        const result = await verifyOtp({ db, now }, parsed.data.code)
        if (!result.ok) {
          return Response.json(
            { ok: false, error: result.reason },
            { status: result.reason === 'rate_limited' ? 429 : 401 },
          )
        }
        const { token } = await createSession(db, now())
        return Response.json(
          { ok: true },
          {
            headers: {
              'Set-Cookie': cookie.serializeSessionCookie(token, ctx.cookieConfig),
            },
          },
        )
      },
    },
  },
})
