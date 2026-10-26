import { SESSION_TTL_MS } from './session'

/**
 * Cookie handling is done with plain headers (no framework helpers) so it behaves
 * identically in middleware, server routes and server functions, and is testable.
 */
export interface CookieConfig {
  /** True when APP_URL is https. */
  secure: boolean
}

// The __Host- prefix pins the cookie to this exact host; it requires Secure.
export function sessionCookieName({ secure }: CookieConfig): string {
  return secure ? '__Host-session' : 'session'
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || undefined
  }
  return undefined
}

export function serializeSessionCookie(token: string, cfg: CookieConfig): string {
  return [
    `${sessionCookieName(cfg)}=${token}`,
    `Max-Age=${SESSION_TTL_MS / 1000}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(cfg.secure ? ['Secure'] : []),
  ].join('; ')
}

export function serializeClearedCookie(cfg: CookieConfig): string {
  return [
    `${sessionCookieName(cfg)}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(cfg.secure ? ['Secure'] : []),
  ].join('; ')
}
