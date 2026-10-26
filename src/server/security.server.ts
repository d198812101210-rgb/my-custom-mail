import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { STATIC_SECURITY_HEADERS } from './security-headers'

/**
 * Per-request CSP nonce. The request middleware generates one and runs the rest of the
 * request inside this store, so the router (created later, per request) can stamp the
 * same nonce on the inline scripts TanStack Start emits for hydration.
 */
const store = new AsyncLocalStorage<{ nonce: string }>()

export const newNonce = () => randomBytes(16).toString('base64')
export const runWithNonce = <T>(nonce: string, fn: () => T): T =>
  store.run({ nonce }, fn)
export const currentNonce = () => store.getStore()?.nonce

export interface CspOptions {
  nonce: string
  /** Origin of the Supabase project: the browser PUTs attachment uploads there. */
  supabaseOrigin: string
}

/**
 * Content-Security-Policy for the app's own pages.
 *
 * - script-src: self + nonce, so only our bundles and Start's nonced inline scripts run.
 * - img-src allows https: because message iframes inherit this policy; they add their own
 *   stricter policy (data: only) and the sandbox, and only open it after "Load images".
 * - style-src allows inline styles (React style attributes, SSR styles); styles cannot run code.
 */
export function buildCsp({ nonce, supabaseOrigin }: CspOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigin}`,
    "frame-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

export interface HardenOptions extends CspOptions {
  /** CSP breaks Vite's dev server (HMR, inline preamble), so it is production-only. */
  production: boolean
}

/** Adds the CSP and no-store caching to a response, without touching the body stream. */
export function harden(response: Response, opts: HardenOptions): Response {
  const out = new Response(response.body, response)
  out.headers.set('cache-control', 'private, no-store')
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS))
    out.headers.set(k, v)
  if (
    opts.production &&
    (out.headers.get('content-type') ?? '').includes('text/html')
  ) {
    out.headers.set('content-security-policy', buildCsp(opts))
  }
  return out
}
