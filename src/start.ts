import { createMiddleware, createStart } from '@tanstack/react-start'

/**
 * The only routes reachable without a session. Matching is on the exact
 * pathname, so anything else (including unknown paths) fails closed.
 * Static files in public/ and built assets are served by the host before the
 * app runs and never reach this middleware.
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/request',
  '/api/auth/verify',
  '/api/webhooks/resend',
])
// Signed by Resend (Svix) instead of using cookies or an Origin header.
const ORIGIN_EXEMPT = new Set(['/api/webhooks/resend'])

const gate = createMiddleware().server(
  async ({ request, pathname, handlerType, next }) => {
    const [{ env }, origin, ctx, sessions, { db }, cookie] = await Promise.all([
      import('#/env.server'),
      import('#/server/auth/origin'),
      import('#/server/auth/context.server'),
      import('#/server/auth/session'),
      import('#/db/client'),
      import('#/server/auth/cookie'),
    ])

    if (
      origin.isMutating(request.method) &&
      !ORIGIN_EXEMPT.has(pathname) &&
      !origin.isAllowedOrigin(request.headers.get('origin'), env.APP_URL)
    ) {
      return new Response('Forbidden', { status: 403 })
    }

    if (PUBLIC_PATHS.has(pathname)) return next()

    const token = ctx.sessionTokenFrom(request)
    const session = token
      ? await sessions.validateSession(db, token, new Date())
      : null
    if (!token || !session) {
      const wantsPage =
        handlerType === 'router' &&
        request.method === 'GET' &&
        (request.headers.get('accept') ?? '').includes('text/html')
      return wantsPage
        ? new Response(null, { status: 302, headers: { Location: '/login' } })
        : Response.json({ error: 'unauthorized' }, { status: 401 })
    }

    const result = await next()
    if (session.refreshed) {
      // Re-issue the cookie so its lifetime slides together with the DB row.
      const response = new Response(result.response.body, result.response)
      response.headers.append(
        'Set-Cookie',
        cookie.serializeSessionCookie(token, ctx.cookieConfig),
      )
      return { ...result, response }
    }
    return result
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [gate],
}))
