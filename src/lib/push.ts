/** Browser-side Web Push helpers. */

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

/** VAPID public keys travel as URL-safe base64; `subscribe()` wants the raw bytes. */
export function keyToBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** True when the subscription was made for this VAPID key (a rotated key invalidates it). */
export function subscribedWith(sub: PushSubscription, key: string): boolean {
  const have = sub.options.applicationServerKey
  if (!have) return false
  const a = new Uint8Array(have)
  const b = keyToBytes(key)
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** `{ type: 'open', url: '/thread/<uuid>' }` posted by the service worker; returns the thread id. */
export function threadIdFromMessage(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const { type, url } = data as { type?: unknown; url?: unknown }
  if (type !== 'open' || typeof url !== 'string') return null
  return /^\/thread\/([0-9a-f-]{36})$/.exec(url)?.[1] ?? null
}
