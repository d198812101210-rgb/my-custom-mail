import { bareAddresses, domainOf, parseAddress } from './address'
import { htmlToPlainText, quoteHtml, textToHtml } from './render'
import { normalizeMessageId, parseMessageIds } from './threading'

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward'

/** What composing needs to know about the message being answered or forwarded. */
export interface SourceMessage {
  id: string
  threadId: string
  direction: 'in' | 'out'
  fromAddress: string
  fromName: string | null
  to: string[]
  cc: string[]
  subject: string
  messageIdHeader: string | null
  referencesHeader: string | null
  /** Raw headers, used only to find Reply-To. */
  headers: Record<string, string> | null
  date: Date
  text: string | null
  html: string | null
}

export interface OwnIdentity {
  domain: string
  /** Bare address of MAIL_FROM. */
  address: string
}

const REPLY_RE = /^\s*(re|aw|sv|antw|res)(\[\d+\])?\s*:/i
const FORWARD_RE = /^\s*(fwd?|wg|tr|rv)(\[\d+\])?\s*:/i

export function prefixSubject(
  subject: string,
  kind: 'reply' | 'forward',
): string {
  const s = subject.trim()
  if (kind === 'reply') return REPLY_RE.test(s) ? s : `Re: ${s}`.trim()
  return FORWARD_RE.test(s) ? s : `Fwd: ${s}`.trim()
}

function isOwn(address: string, own: OwnIdentity): boolean {
  return (
    address === own.address || domainOf(address) === own.domain.toLowerCase()
  )
}

function headerValue(
  headers: Record<string, string> | null,
  name: string,
): string | null {
  if (!headers) return null
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
  return key === undefined ? null : (headers[key] ?? null)
}

/** Where a reply goes: Reply-To if the sender set one, else From. */
export function replyAddress(source: SourceMessage): string {
  const replyTo = headerValue(source.headers, 'reply-to')
  const parsed = replyTo ? bareAddresses([replyTo.split(',')[0] ?? '']) : []
  return parsed[0] ?? source.fromAddress
}

export function replyRecipients(
  source: SourceMessage,
  mode: 'reply' | 'replyAll',
  own: OwnIdentity,
): { to: string[]; cc: string[] } {
  // Answering our own message continues the conversation with its recipients.
  if (source.direction === 'out') {
    return mode === 'reply'
      ? { to: [...source.to], cc: [] }
      : { to: [...source.to], cc: [...source.cc] }
  }
  const primary = replyAddress(source)
  if (mode === 'reply') return { to: [primary], cc: [] }

  const seen = new Set<string>([primary])
  const others = (list: string[]) =>
    list.filter((a) => {
      if (isOwn(a, own) || seen.has(a)) return false
      seen.add(a)
      return true
    })
  return { to: [primary, ...others(source.to)], cc: others(source.cc) }
}

/** References header for a reply: the parent's chain plus the parent's own id. */
export function buildReferences(source: SourceMessage): string[] {
  const chain = parseMessageIds(source.referencesHeader)
  const own = source.messageIdHeader
    ? [normalizeMessageId(source.messageIdHeader)]
    : []
  return [...new Set([...chain, ...own])].slice(-20)
}

export function whoLine(
  m: Pick<SourceMessage, 'fromName' | 'fromAddress'>,
): string {
  return m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress
}

const dateLine = (d: Date) =>
  d.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC'

export function sourceText(source: SourceMessage): string {
  if (source.text?.trim()) return source.text
  return source.html ? htmlToPlainText(source.html) : ''
}

export function quoteText(source: SourceMessage): string {
  const quoted = sourceText(source)
    .split(/\r?\n/)
    .map((l) => (l.startsWith('>') ? `>${l}` : `> ${l}`).trimEnd())
    .join('\n')
  return `On ${dateLine(source.date)}, ${whoLine(source)} wrote:\n${quoted}`
}

export function forwardText(source: SourceMessage): string {
  return [
    '---------- Forwarded message ----------',
    `From: ${whoLine(source)}`,
    `Date: ${dateLine(source.date)}`,
    `Subject: ${source.subject}`,
    `To: ${source.to.join(', ')}`,
    '',
    sourceText(source),
  ].join('\n')
}

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 1em">${escape(p).replace(/\r?\n/g, '<br>')}</p>`,
    )
    .join('')
}

function sourceHtml(source: SourceMessage): string {
  return source.html?.trim()
    ? quoteHtml(source.html)
    : textToHtml(sourceText(source)).html
}

/** Text and HTML parts of an outgoing message, with the original quoted or forwarded. */
export function composeBodies(opts: {
  text: string
  mode: ComposeMode
  source: SourceMessage | null
}): { text: string; html: string } {
  const { mode, source } = opts
  const mine = opts.text.trim()
  const htmlMine = mine ? paragraphs(mine) : ''

  if (!source || mode === 'new')
    return { text: mine, html: `<div>${htmlMine}</div>` }

  if (mode === 'forward') {
    const header = `<div style="margin:1em 0 .5em">---------- Forwarded message ----------<br>From: ${escape(
      whoLine(source),
    )}<br>Date: ${escape(dateLine(source.date))}<br>Subject: ${escape(source.subject)}<br>To: ${escape(
      source.to.join(', '),
    )}</div>`
    return {
      text: [mine, forwardText(source)].filter(Boolean).join('\n\n'),
      html: `<div>${htmlMine}${header}<div>${sourceHtml(source)}</div></div>`,
    }
  }

  const attribution = `On ${escape(dateLine(source.date))}, ${escape(whoLine(source))} wrote:`
  return {
    text: [mine, quoteText(source)].filter(Boolean).join('\n\n'),
    html: `<div>${htmlMine}<div style="margin:1em 0 .5em">${attribution}</div><blockquote style="margin:0 0 0 .8ex;padding-left:1ex;border-left:1px solid #ccc">${sourceHtml(source)}</blockquote></div>`,
  }
}

/** Defaults the composer starts from. */
export function draftDefaults(
  source: SourceMessage | null,
  mode: ComposeMode,
  own: OwnIdentity,
): { to: string[]; cc: string[]; subject: string } {
  if (!source || mode === 'new') return { to: [], cc: [], subject: '' }
  if (mode === 'forward') {
    return { to: [], cc: [], subject: prefixSubject(source.subject, 'forward') }
  }
  return {
    ...replyRecipients(source, mode, own),
    subject: prefixSubject(source.subject, 'reply'),
  }
}

export function ownIdentity(mailFrom: string): OwnIdentity {
  const { address } = parseAddress(mailFrom)
  return { address, domain: domainOf(address) }
}
