import { createMiddleware, createStart } from '@tanstack/react-start'

const gate = createMiddleware().server(
  async ({ request, pathname, handlerType, next }) => {
    const [{ env }, origin, ctx, sessions, { db }, cookie, paths, security] =
      await Promise.all([
        import('#/env.server'),
        import('#/server/auth/origin'),
        import('#/server/auth/context.server'),
        import('#/server/auth/session'),
        import('#/db/client'),
        import('#/server/auth/cookie'),
        import('#/server/auth/public-paths'),
        import('#/server/security.server'),
      ])

    const nonce = security.newNonce()
    const hardenOpts = {
      nonce,
      supabaseOrigin: new URL(env.SUPABASE_URL).origin,
      production: process.env.NODE_ENV === 'production',
    }

    async function handle(): Promise<
      Response | Awaited<ReturnType<typeof next>>
    > {
      if (
        origin.isMutating(request.method) &&
        !paths.ORIGIN_EXEMPT_PATHS.has(pathname) &&
        !origin.isAllowedOrigin(request.headers.get('origin'), env.APP_URL)
      ) {
        return new Response('Forbidden', { status: 403 })
      }

      if (paths.PUBLIC_PATHS.has(pathname)) return next()

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
    }

    // Everything downstream (including SSR) runs with this request's nonce available.
    const result = await security.runWithNonce(nonce, handle)
    if (result instanceof Response) return security.harden(result, hardenOpts)
    return { ...result, response: security.harden(result.response, hardenOpts) }
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [gate],
}))
