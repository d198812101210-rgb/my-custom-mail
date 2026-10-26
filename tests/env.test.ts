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
