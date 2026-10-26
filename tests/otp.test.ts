import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { otpCodes, rateLimits } from '../src/db/schema'
import type { Db } from '../src/db/types'
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  requestOtp,
  verifyOtp,
} from '../src/server/auth/otp'
import { createTestDb } from './db'

let db: Db
let clock: number
let sent: string[]
const now = () => new Date(clock)
const sendCode = (code: string) => {
  sent.push(code)
  return Promise.resolve()
}
const sentCode = (i: number) => sent[i] ?? ''
const wrongCode = (real: string) => (real === '000000' ? '111111' : '000000')

beforeEach(async () => {
  db = (await createTestDb()).db
  clock = Date.UTC(2026, 0, 1, 12, 0, 0)
  sent = []
})

const request = () => requestOtp({ db, now, sendCode })
const verify = (code: string) => verifyOtp({ db, now }, code)

describe('requestOtp', () => {
  it('sends a 6-digit code and stores only a hash', async () => {
    expect(await request()).toBe('sent')
    expect(sentCode(0)).toMatch(/^\d{6}$/)
    const rows = await db.select().from(otpCodes)
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0])).not.toContain(sentCode(0))
    expect(rows[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('allows one request per minute', async () => {
    expect(await request()).toBe('sent')
    expect(await request()).toBe('rate_limited')
    expect(sent).toHaveLength(1)
    clock += 61_000
    expect(await request()).toBe('sent')
  })

  it('allows five requests per hour', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await request()).toBe('sent')
      clock += 61_000
    }
    expect(await request()).toBe('rate_limited')
    clock += 3600_000
    expect(await request()).toBe('sent')
  })

  it('invalidates the previous code when a new one is issued', async () => {
    await request()
    const first = sentCode(0)
    clock += 61_000
    await request()
    expect(await verify(first)).toEqual({ ok: false, reason: 'invalid' })
    expect(await verify(sentCode(1))).toEqual({ ok: true })
  })

  it('removes the code and reports failure when delivery fails', async () => {
    const result = await requestOtp({
      db,
      now,
      sendCode: () => Promise.reject(new Error('boom')),
    })
    expect(result).toBe('send_failed')
    expect(await db.select().from(otpCodes)).toHaveLength(0)
  })
})

describe('verifyOtp', () => {
  it('accepts the right code', async () => {
    await request()
    expect(await verify(sentCode(0))).toEqual({ ok: true })
  })

  it('is single use', async () => {
    await request()
    expect(await verify(sentCode(0))).toEqual({ ok: true })
    expect(await verify(sentCode(0))).toEqual({ ok: false, reason: 'invalid' })
  })

  it('is single use under concurrent attempts', async () => {
    await request()
    const results = await Promise.all([
      verify(sentCode(0)),
      verify(sentCode(0)),
      verify(sentCode(0)),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('expires after 10 minutes', async () => {
    await request()
    clock += OTP_TTL_MS
    expect(await verify(sentCode(0))).toEqual({ ok: false, reason: 'invalid' })
  })

  it('still works just before expiry', async () => {
    await request()
    clock += OTP_TTL_MS - 1000
    expect(await verify(sentCode(0))).toEqual({ ok: true })
  })

  it('locks after 5 wrong attempts, even for the correct code', async () => {
    await request()
    const real = sentCode(0)
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      expect(await verify(wrongCode(real))).toEqual({
        ok: false,
        reason: 'invalid',
      })
      // Stay under the separate verify rate limit's window boundary.
    }
    expect(await verify(real)).toEqual({ ok: false, reason: 'invalid' })
    const [row] = await db.select().from(otpCodes)
    expect(row?.attempts).toBe(OTP_MAX_ATTEMPTS)
    expect(row?.consumedAt).toBeNull()
  })

  it('accepts the correct code on the 5th attempt', async () => {
    await request()
    const real = sentCode(0)
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) await verify(wrongCode(real))
    expect(await verify(real)).toEqual({ ok: true })
  })

  it('does not let parallel guesses exceed the attempt limit', async () => {
    await request()
    const real = sentCode(0)
    // 8 parallel wrong guesses plus the right one: at most 5 are counted.
    const guesses = Array.from({ length: 8 }, () => verify(wrongCode(real)))
    await Promise.all(guesses)
    const [row] = await db.select().from(otpCodes)
    expect(row?.attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS)
    expect(await verify(real)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rate-limits verification attempts overall', async () => {
    const results = []
    for (let i = 0; i < 12; i++) results.push(await verify('123456'))
    expect(
      results.slice(0, 10).every((r) => !r.ok && r.reason === 'invalid'),
    ).toBe(true)
    expect(results[10]).toEqual({ ok: false, reason: 'rate_limited' })
  })

  it('reports the same result for no code, wrong code and expired code', async () => {
    const none = await verify('123456')
    await request()
    const wrong = await verify(wrongCode(sentCode(0)))
    await db.update(otpCodes).set({ expiresAt: new Date(clock - 1) })
    const expired = await verify(sentCode(0))
    expect(none).toEqual(wrong)
    expect(wrong).toEqual(expired)
  })

  it('keeps counters in the database', async () => {
    await request()
    const rows = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.count, 1))
    expect(rows.length).toBeGreaterThan(0)
  })
})
