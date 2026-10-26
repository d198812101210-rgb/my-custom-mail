import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { otpCodes } from '#/db/schema'
import type { Db } from '#/db/types'
import { generateOtp, hashOtp, safeEqualHex } from './crypto'
import { hit, pruneRateLimits } from './rate-limit'

export const OTP_TTL_MS = 10 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5

const REQUEST_LIMITS = [
  { windowSeconds: 60, max: 1 },
  { windowSeconds: 3600, max: 5 },
]
const VERIFY_LIMIT = { windowSeconds: 600, max: 10 }

export interface OtpDeps {
  db: Db
  now: () => Date
  /** Delivers the plaintext code to the owner. Must never log it. */
  sendCode: (code: string) => Promise<void>
}

export type RequestResult = 'sent' | 'rate_limited' | 'send_failed'

export async function requestOtp({
  db,
  now,
  sendCode,
}: OtpDeps): Promise<RequestResult> {
  const t = now()
  // Evaluate every window so each counter advances even if an earlier one rejects.
  const allowed = await Promise.all(
    REQUEST_LIMITS.map((l, i) => hit(db, `otp:request:${i}`, l, t)),
  )
  if (!allowed.every(Boolean)) return 'rate_limited'

  await pruneRateLimits(db, t)
  // Only one code is live at a time.
  await db
    .update(otpCodes)
    .set({ consumedAt: t })
    .where(and(isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, t)))
  await db
    .delete(otpCodes)
    .where(lt(otpCodes.expiresAt, new Date(t.getTime() - 24 * 3600 * 1000)))

  const id = crypto.randomUUID()
  const code = generateOtp()
  await db.insert(otpCodes).values({
    id,
    codeHash: hashOtp(id, code),
    createdAt: t,
    expiresAt: new Date(t.getTime() + OTP_TTL_MS),
  })

  try {
    await sendCode(code)
  } catch {
    await db.delete(otpCodes).where(eq(otpCodes.id, id))
    return 'send_failed'
  }
  return 'sent'
}

export type VerifyResult =
  { ok: true } | { ok: false; reason: 'invalid' | 'rate_limited' }

/**
 * Wrong, expired, locked, reused and nonexistent codes are all reported as
 * 'invalid' so the response reveals nothing about which one it was.
 */
export async function verifyOtp(
  { db, now }: Pick<OtpDeps, 'db' | 'now'>,
  code: string,
): Promise<VerifyResult> {
  const t = now()
  if (!(await hit(db, 'otp:verify', VERIFY_LIMIT, t))) {
    return { ok: false, reason: 'rate_limited' }
  }

  const [live] = await db
    .select({ id: otpCodes.id, codeHash: otpCodes.codeHash })
    .from(otpCodes)
    .where(and(isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, t)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1)
  if (!live) return { ok: false, reason: 'invalid' }

  // Count the attempt before comparing, atomically, so parallel guesses
  // cannot exceed the limit.
  const counted = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(
      and(
        eq(otpCodes.id, live.id),
        isNull(otpCodes.consumedAt),
        gt(otpCodes.expiresAt, t),
        lt(otpCodes.attempts, OTP_MAX_ATTEMPTS),
      ),
    )
    .returning({ id: otpCodes.id })
  if (counted.length === 0) return { ok: false, reason: 'invalid' }

  if (!safeEqualHex(live.codeHash, hashOtp(live.id, code))) {
    return { ok: false, reason: 'invalid' }
  }

  // Single use: only one concurrent request can flip consumed_at.
  const consumed = await db
    .update(otpCodes)
    .set({ consumedAt: t })
    .where(and(eq(otpCodes.id, live.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id })
  return consumed.length === 1 ? { ok: true } : { ok: false, reason: 'invalid' }
}
