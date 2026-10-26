const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isMutating(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase())
}

/**
 * Mutating requests must carry an Origin header equal to the app's origin.
 * A missing header is rejected: browsers always send Origin on cross-origin
 * and same-origin POSTs, so its absence means a non-browser or stripped request.
 */
export function isAllowedOrigin(originHeader: string | null, appUrl: string): boolean {
  if (!originHeader) return false
  try {
    return new URL(originHeader).origin === new URL(appUrl).origin
  } catch {
    return false
  }
}
