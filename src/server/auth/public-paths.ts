/**
 * The only routes reachable without a session. Matching is on the exact pathname, so
 * anything else (including unknown paths) fails closed. Static files in public/ and the
 * built assets are served by the host before the app runs and never reach the gate.
 */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/login',
  '/api/auth/request',
  '/api/auth/verify',
  '/api/webhooks/resend',
])

/** Signed by Resend (Svix) instead of using cookies or an Origin header. */
export const ORIGIN_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/api/webhooks/resend',
])
