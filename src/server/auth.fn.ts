import { createServerFn } from '@tanstack/react-start'
import { appendResponseHeader, getRequest } from '@tanstack/react-start/server'

// Server functions are only reachable with a valid session (enforced in src/start.ts).

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  const [{ db }, { deleteSession }, ctx, cookie] = await Promise.all([
    import('#/db/client'),
    import('#/server/auth/session'),
    import('#/server/auth/context.server'),
    import('#/server/auth/cookie'),
  ])
  const token = ctx.sessionTokenFrom(getRequest())
  if (token) await deleteSession(db, token)
  appendResponseHeader('Set-Cookie', cookie.serializeClearedCookie(ctx.cookieConfig))
  return { ok: true as const }
})

export const logoutEverywhere = createServerFn({ method: 'POST' }).handler(async () => {
  const [{ db }, { deleteAllSessions }, ctx, cookie] = await Promise.all([
    import('#/db/client'),
    import('#/server/auth/session'),
    import('#/server/auth/context.server'),
    import('#/server/auth/cookie'),
  ])
  await deleteAllSessions(db)
  appendResponseHeader('Set-Cookie', cookie.serializeClearedCookie(ctx.cookieConfig))
  return { ok: true as const }
})
