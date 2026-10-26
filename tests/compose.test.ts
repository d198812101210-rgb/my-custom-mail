import { describe, expect, it } from 'vitest'
import {
  buildReferences,
  composeBodies,
  draftDefaults,
  ownIdentity,
  prefixSubject,
  quoteText,
  replyAddress,
  replyRecipients,
} from '../src/server/mail/compose'
import type { SourceMessage } from '../src/server/mail/compose'
import { htmlToPlainText, quoteHtml } from '../src/server/mail/render'

const own = ownIdentity('Me <me@tanakadev.digital>')

const source = (over: Partial<SourceMessage> = {}): SourceMessage => ({
  id: 'm1',
  threadId: 't1',
  direction: 'in',
  fromAddress: 'alice@example.com',
  fromName: 'Alice',
  to: ['test@tanakadev.digital', 'bob@example.com'],
  cc: [
    'carol@example.com',
    'ALICE@example.com'.toLowerCase(),
    'other@tanakadev.digital',
  ],
  subject: 'Plan',
  messageIdHeader: '<m1@example.com>',
  referencesHeader: null,
  headers: null,
  date: new Date('2026-01-01T10:00:00Z'),
  text: 'line one\nline two',
  html: null,
  ...over,
})

describe('prefixSubject', () => {
  it.each([
    ['Plan', 'reply', 'Re: Plan'],
    ['Re: Plan', 'reply', 'Re: Plan'],
    ['RE: Plan', 'reply', 'RE: Plan'],
    ['AW: Plan', 'reply', 'AW: Plan'],
    ['Plan', 'forward', 'Fwd: Plan'],
    ['Fwd: Plan', 'forward', 'Fwd: Plan'],
    ['Fw: Plan', 'forward', 'Fw: Plan'],
    ['', 'reply', 'Re:'],
  ] as const)('%j (%s) -> %j', (subject, kind, expected) => {
    expect(prefixSubject(subject, kind)).toBe(expected)
  })
})

describe('recipients', () => {
  it('replies to the sender', () => {
    expect(replyRecipients(source(), 'reply', own)).toEqual({
      to: ['alice@example.com'],
      cc: [],
    })
  })

  it('prefers Reply-To', () => {
    const s = source({
      headers: { 'Reply-To': 'Support <help@example.com>, other@x.io' },
    })
    expect(replyAddress(s)).toBe('help@example.com')
    expect(replyRecipients(s, 'reply', own).to).toEqual(['help@example.com'])
  })

  it('reply-all keeps everyone else but never our own addresses or duplicates', () => {
    expect(replyRecipients(source(), 'replyAll', own)).toEqual({
      to: ['alice@example.com', 'bob@example.com'],
      cc: ['carol@example.com'],
    })
  })

  it('answering our own message goes to its recipients, not to us', () => {
    const mine = source({
      direction: 'out',
      fromAddress: 'me@tanakadev.digital',
      to: ['bob@example.com'],
      cc: ['carol@example.com'],
    })
    expect(replyRecipients(mine, 'reply', own)).toEqual({
      to: ['bob@example.com'],
      cc: [],
    })
    expect(replyRecipients(mine, 'replyAll', own)).toEqual({
      to: ['bob@example.com'],
      cc: ['carol@example.com'],
    })
  })

  it('has sensible composer defaults per mode', () => {
    expect(draftDefaults(null, 'new', own)).toEqual({
      to: [],
      cc: [],
      subject: '',
    })
    expect(draftDefaults(source(), 'forward', own)).toEqual({
      to: [],
      cc: [],
      subject: 'Fwd: Plan',
    })
    expect(draftDefaults(source(), 'reply', own).subject).toBe('Re: Plan')
  })
})

describe('buildReferences', () => {
  it('appends the parent id to its chain without duplicates', () => {
    const s = source({
      referencesHeader: '<a@x> <b@x>',
      messageIdHeader: '<c@x>',
    })
    expect(buildReferences(s)).toEqual(['<a@x>', '<b@x>', '<c@x>'])
    expect(
      buildReferences(source({ referencesHeader: '<m1@example.com>' })),
    ).toEqual(['<m1@example.com>'])
  })

  it('keeps only the most recent 20', () => {
    const chain = Array.from({ length: 30 }, (_, i) => `<r${i}@x>`).join(' ')
    const refs = buildReferences(source({ referencesHeader: chain }))
    expect(refs).toHaveLength(20)
    expect(refs.at(-1)).toBe('<m1@example.com>')
  })
})

describe('bodies', () => {
  it('quotes the original line by line', () => {
    const q = quoteText(source({ text: 'hello\n> older' }))
    expect(q).toContain('Alice <alice@example.com> wrote:')
    expect(q).toContain('> hello')
    expect(q).toContain('>> older')
  })

  it('builds text and html for a reply', () => {
    const b = composeBodies({
      text: 'Thanks!',
      mode: 'reply',
      source: source(),
    })
    expect(b.text.startsWith('Thanks!\n\nOn ')).toBe(true)
    expect(b.html).toContain('<blockquote')
    expect(b.html).toContain('Thanks!')
  })

  it('escapes what the user typed', () => {
    const b = composeBodies({
      text: '<script>alert(1)</script> & co',
      mode: 'new',
      source: null,
    })
    expect(b.html).not.toContain('<script>')
    expect(b.html).toContain('&lt;script&gt;')
    expect(b.text).toBe('<script>alert(1)</script> & co')
  })

  it('forward carries the original with a header block', () => {
    const b = composeBodies({ text: 'FYI', mode: 'forward', source: source() })
    expect(b.text).toContain('---------- Forwarded message ----------')
    expect(b.text).toContain('Subject: Plan')
    expect(b.text).toContain('line two')
    expect(b.html).toContain('Forwarded message')
  })

  it('never re-sends the original HTML images, styles or scripts', () => {
    const html =
      '<style>p{color:red}</style><p onclick="x()">hi</p><img src="https://t.example/pixel.gif"><script>1</script><a href="javascript:alert(1)">x</a>'
    const q = quoteHtml(html)
    expect(q).toContain('<p>hi</p>')
    for (const bad of [
      '<img',
      'pixel',
      '<style',
      '<script',
      'onclick',
      'javascript:',
      'color:red',
    ]) {
      expect(q).not.toContain(bad)
    }
    const b = composeBodies({
      text: 'ok',
      mode: 'reply',
      source: source({ html }),
    })
    expect(b.html).not.toContain('pixel.gif')
  })

  it('derives text from HTML-only mail', () => {
    expect(htmlToPlainText('<p>Fish &amp; chips</p><style>x{}</style>')).toBe(
      'Fish & chips',
    )
    const b = composeBodies({
      text: 'hi',
      mode: 'reply',
      source: source({ text: null, html: '<p>only html</p>' }),
    })
    expect(b.text).toContain('> only html')
  })
})
