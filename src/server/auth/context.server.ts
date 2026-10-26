import { env } from '#/env.server'
import { readCookie, sessionCookieName } from './cookie'
import type { CookieConfig } from './cookie'

export const cookieConfig: CookieConfig = {
  secure: new URL(env.APP_URL).protocol === 'https:',
}

export function sessionTokenFrom(request: Request): string | undefined {
  return readCookie(request.headers.get('cookie'), sessionCookieName(cookieConfig))
}
