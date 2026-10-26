/**
 * Applied to every response: dynamic ones by src/start.ts, static files by Nitro routeRules
 * (vite.config.ts). Kept free of Node imports so the Vite config can read it.
 */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
}
