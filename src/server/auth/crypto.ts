import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/**
 * The OTP row id acts as a per-code salt. A 6-digit code has little entropy, so
 * the real protection is the 10 minute expiry and the attempt limit, not the hash.
 */
export function hashOtp(otpId: string, code: string): string {
  return createHash('sha256').update(`${otpId}:${code}`).digest('hex')
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb)
}
