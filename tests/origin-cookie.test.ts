import { describe, expect, it } from 'vitest'
import {
  readCookie,
  serializeClearedCookie,
  serializeSessionCookie,
} from '../src/server/auth/cookie'
import { isAllowedOrigin, isMutating } from '../src/server/auth/origin'

const app = 'https://mail.tanakadev.digital'

describe('origin check', () => {
  it('accepts the app origin only', () => {
    expect(isAllowedOrigin('https://mail.tanakadev.digital', app)).toBe(true)
    expect(isAllowedOrigin('https://evil.example', app)).toBe(false)
    expect(
      isAllowedOrigin('https://mail.tanakadev.digital.evil.example', app),
    ).toBe(false)
    expect(isAllowedOrigin('http://mail.tanakadev.digital', app)).toBe(false)
  })

  it('rejects missing, null and malformed origins', () => {
    expect(isAllowedOrigin(null, app)).toBe(false)
    expect(isAllowedOrigin('null', app)).toBe(false)
    expect(isAllowedOrigin('not a url', app)).toBe(false)
  })

  it('treats only GET/HEAD/OPTIONS as safe', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get'])
      expect(isMutating(m)).toBe(false)
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(isMutating(m)).toBe(true)
  })
})

describe('session cookie', () => {
  it('is httpOnly, Secure, SameSite=Lax and host-pinned on https', () => {
    const c = serializeSessionCookie('tok', { secure: true })
    expect(c).toMatch(/^__Host-session=tok;/)
    for (const a of [
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Path=/',
      'Max-Age=7776000',
    ]) {
      expect(c).toContain(a)
    }
    expect(c).not.toContain('Domain')
  })

  it('drops Secure and the prefix only for plain-http development', () => {
    const c = serializeSessionCookie('tok', { secure: false })
    expect(c).toMatch(/^session=tok;/)
    expect(c).not.toContain('Secure')
    expect(c).toContain('HttpOnly')
  })

  it('clears with Max-Age=0', () => {
    expect(serializeClearedCookie({ secure: true })).toContain('Max-Age=0')
  })

  it('reads the right cookie from a header', () => {
    expect(readCookie('a=1; __Host-session=abc; b=2', '__Host-session')).toBe(
      'abc',
    )
    expect(readCookie('a=1', '__Host-session')).toBeUndefined()
    expect(readCookie(null, 'x')).toBeUndefined()
    expect(readCookie('session=', 'session')).toBeUndefined()
  })
})
