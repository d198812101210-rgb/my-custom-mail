export interface AuthResults {
  spf: string | null
  dkim: string | null
  dmarc: string | null
}

/** Results that should raise the warning badge. */
export const FAILING_RESULTS = new Set([
  'fail',
  'softfail',
  'permerror',
  'temperror',
])

export function isFailing(result: string | null | undefined): boolean {
  return result != null && FAILING_RESULTS.has(result.toLowerCase())
}

function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
  return key === undefined ? undefined : headers[key]
}

/**
 * The Resend SDK's received-email type has no `authentication` field, so the
 * SPF/DKIM/DMARC verdicts are read from the Authentication-Results header
 * (RFC 8601), falling back to Received-SPF for SPF.
 */
export function parseAuthResults(
  headers: Record<string, string> | null,
): AuthResults {
  const out: AuthResults = { spf: null, dkim: null, dmarc: null }
  if (!headers) return out
  const ar = header(headers, 'authentication-results')
  if (ar) {
    for (const method of ['spf', 'dkim', 'dmarc'] as const) {
      const m = new RegExp(`(?:^|[\\s;])${method}\\s*=\\s*([a-z]+)`, 'i').exec(
        ar,
      )
      if (m?.[1]) out[method] = m[1].toLowerCase()
    }
  }
  if (!out.spf) {
    const rs = header(headers, 'received-spf')
    const m = rs ? /^\s*([a-z]+)/i.exec(rs) : null
    if (m?.[1]) out.spf = m[1].toLowerCase()
  }
  return out
}
