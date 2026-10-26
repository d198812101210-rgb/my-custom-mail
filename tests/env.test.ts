import { describe, expect, it } from 'vitest'
import { parseEnv } from '../src/env.server'

const valid = {
  RESEND_API_KEY: 're_x',
  DATABASE_URL: 'postgresql://u:p@host:6543/postgres',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
  OWNER_EMAIL: 'me@gmail.com',
  MAIL_FROM: 'Me <me@tanakadev.digital>',
  AUTH_FROM: 'Login <login@tanakadev.digital>',
  APP_URL: 'https://mail.tanakadev.digital',
}

describe('parseEnv', () => {
  it('accepts a valid env without the webhook secret', () => {
    expect(parseEnv(valid).RESEND_WEBHOOK_SECRET).toBeUndefined()
  })

  it('treats an empty webhook secret as unset', () => {
    expect(
      parseEnv({ ...valid, RESEND_WEBHOOK_SECRET: '' }).RESEND_WEBHOOK_SECRET,
    ).toBeUndefined()
  })

  it('treats the VAPID keys as optional but only valid together', () => {
    expect(parseEnv(valid).VAPID_PUBLIC_KEY).toBeUndefined()
    const both = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }
    expect(parseEnv({ ...valid, ...both }).VAPID_PRIVATE_KEY).toBe('priv')
    expect(() => parseEnv({ ...valid, VAPID_PUBLIC_KEY: 'pub' })).toThrow(
      /VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together/,
    )
    expect(() => parseEnv({ ...valid, VAPID_PRIVATE_KEY: 'priv' })).toThrow(
      /set together/,
    )
  })

  it('defaults the pool size and validates an override', () => {
    expect(parseEnv(valid).DATABASE_POOL_MAX).toBe(5)
    expect(
      parseEnv({ ...valid, DATABASE_POOL_MAX: '1' }).DATABASE_POOL_MAX,
    ).toBe(1)
    expect(() => parseEnv({ ...valid, DATABASE_POOL_MAX: '0' })).toThrow(
      /DATABASE_POOL_MAX/,
    )
  })

  it('rejects an owner address on the mail domain', () => {
    expect(() =>
      parseEnv({ ...valid, OWNER_EMAIL: 'me@tanakadev.digital' }),
    ).toThrow(/OWNER_EMAIL/)
  })

  it('does not leak values in the error message', () => {
    try {
      parseEnv({
        ...valid,
        DATABASE_URL: 'mysql://secret-user:secret-pass@h/db',
      })
      throw new Error('should have thrown')
    } catch (e) {
      expect(String(e)).toContain('DATABASE_URL')
      expect(String(e)).not.toContain('secret-pass')
    }
  })
})
