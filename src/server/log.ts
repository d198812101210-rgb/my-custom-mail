/**
 * Safe one-line description of an error for logs. Database and HTTP client errors
 * can embed query parameters or response bodies (i.e. mail content), so only the
 * error type and machine-readable codes are ever logged, never the message.
 */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return 'non-error thrown'
  const parts = [e.name]
  const pick = (o: unknown) => {
    if (typeof o !== 'object' || o === null) return
    const rec = o as Record<string, unknown>
    for (const k of ['code', 'status', 'statusCode']) {
      const v = rec[k]
      if (typeof v === 'string' || typeof v === 'number')
        parts.push(`${k}=${v}`)
    }
  }
  pick(e)
  pick(e.cause)
  return parts.join(' ')
}
