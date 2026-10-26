import { describe, expect, it } from 'vitest'
import {
  bareAddresses,
  mailboxDomain,
  parseAddress,
} from '../src/server/mail/address'
import { isFailing, parseAuthResults } from '../src/server/mail/auth-results'
import { describeError } from '../src/server/log'

describe('parseAddress', () => {
  it('splits name and address and lowercases the address', () => {
    expect(parseAddress('Jane Doe <Jane@Example.COM>')).toEqual({
      address: 'jane@example.com',
      name: 'Jane Doe',
    })
    expect(parseAddress('"Doe, Jane" <j@x.io>')).toEqual({
      address: 'j@x.io',
      name: 'Doe, Jane',
    })
    expect(parseAddress('plain@x.io')).toEqual({
      address: 'plain@x.io',
      name: null,
    })
    expect(parseAddress('<only@x.io>')).toEqual({
      address: 'only@x.io',
      name: null,
    })
  })
  it('dedupes bare addresses', () => {
    expect(bareAddresses(['A <a@x.io>', 'a@x.io', 'b@x.io'])).toEqual([
      'a@x.io',
      'b@x.io',
    ])
    expect(bareAddresses(null)).toEqual([])
  })
  it('finds the domain of a mailbox string', () => {
    expect(mailboxDomain('Name <me@tanakadev.digital>')).toBe(
      'tanakadev.digital',
    )
  })
})

describe('parseAuthResults', () => {
  it('reads spf, dkim and dmarc from Authentication-Results', () => {
    const r = parseAuthResults({
      'Authentication-Results':
        'mx.google.com; dkim=pass header.i=@x.io; spf=softfail (domain) smtp.mailfrom=a@x.io; dmarc=fail (p=NONE) header.from=x.io',
    })
    expect(r).toEqual({ spf: 'softfail', dkim: 'pass', dmarc: 'fail' })
  })
  it('falls back to Received-SPF', () => {
    expect(
      parseAuthResults({ 'received-spf': 'Fail (sender not allowed)' }).spf,
    ).toBe('fail')
  })
  it('returns nulls when there is nothing to read', () => {
    expect(parseAuthResults(null)).toEqual({
      spf: null,
      dkim: null,
      dmarc: null,
    })
    expect(parseAuthResults({})).toEqual({ spf: null, dkim: null, dmarc: null })
  })
  it('flags only real failures', () => {
    expect(
      ['fail', 'softfail', 'permerror', 'temperror'].every(isFailing),
    ).toBe(true)
    expect(['pass', 'none', 'neutral', null].some(isFailing)).toBe(false)
  })
})

describe('describeError', () => {
  it('keeps names and codes and drops messages', () => {
    const e = Object.assign(new Error('INSERT ... params: secret body'), {
      code: '23505',
    })
    const out = describeError(e)
    expect(out).toContain('23505')
    expect(out).not.toContain('secret body')
    expect(
      describeError(new Error('x', { cause: { code: 'ECONNREFUSED' } })),
    ).toContain('ECONNREFUSED')
  })
})
