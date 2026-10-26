import { and, eq, sql } from 'drizzle-orm'
import { attachments as attachmentsTable, messages } from '#/db/schema'
import type { Db } from '#/db/types'
import { describeError } from '../log'
import { bareAddresses, parseAddress } from './address'
import { buildReferences, composeBodies } from './compose'
import type { ComposeMode, OwnIdentity, SourceMessage } from './compose'
import { INGEST_LOCK_KEY } from './ingest'
import { assignThread, externalParticipants, touchThread } from './threading'

/** Resend: 40 MB per email, measured after base64 encoding. */
export const MAX_EMAIL_BYTES = 40 * 1024 * 1024
export const MAX_RECIPIENTS = 50

export interface OutgoingAttachment {
  filename: string
  contentType: string
  content: Uint8Array
}

export interface OutgoingPayload {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html: string
  headers: Record<string, string>
  attachments: OutgoingAttachment[]
}

export interface Mailer {
  /** The same idempotencyKey must return the same id without sending twice. */
  send: (
    payload: OutgoingPayload,
    opts: { idempotencyKey: string },
  ) => Promise<{ id: string }>
}

export interface BlobIO {
  download: (path: string) => Promise<Uint8Array>
  put: (path: string, bytes: Uint8Array, contentType: string) => Promise<void>
  remove: (paths: string[]) => Promise<void>
}

export interface SendDeps {
  db: Db
  mailer: Mailer
  blobs: BlobIO
  /** MAIL_FROM, e.g. "Name <me@tanakadev.digital>". */
  from: string
  own: OwnIdentity
  now: () => Date
  log?: (line: string) => void
}

export interface SendInput {
  /** Client-generated per composer session; makes retries and double-clicks safe. */
  draftId: string
  mode: ComposeMode
  sourceMessageId?: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  /** Files the browser put in Storage under uploadPrefix(draftId). */
  uploads: { path: string; filename: string; contentType: string }[]
  /** Attachments of the source message to carry along (forward). */
  forwardAttachmentIds: string[]
}

export type SendResult =
  | { ok: true; threadId: string; messageId: string; duplicate: boolean }
  | { ok: false; error: SendError }

export type SendError =
  | 'no_recipients'
  | 'too_many_recipients'
  | 'invalid_upload'
  | 'source_not_found'
  | 'too_large'
  | 'send_failed'
  | 'sent_but_not_saved'

export const uploadPrefix = (draftId: string) => `outbound/tmp/${draftId}/`
const finalPath = (draftId: string, n: number) =>
  `outbound/sent/${draftId}/${n}`
/** Deterministic, so a retry can tell the draft was already sent. */
export const messageIdFor = (draftId: string, domain: string) =>
  `<${draftId}@${domain}>`

export interface SourceFile {
  id: string
  filename: string
  contentType: string
  size: number
  storagePath: string
}

export async function loadSource(
  db: Db,
  messageId: string,
): Promise<{ source: SourceMessage; files: SourceFile[] } | null> {
  const [m] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1)
  if (!m) return null
  const files = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.messageId, m.id))
  return {
    source: {
      id: m.id,
      threadId: m.threadId,
      direction: m.direction === 'out' ? 'out' : 'in',
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      to: m.toAddresses,
      cc: m.cc,
      subject: m.subject,
      messageIdHeader: m.messageIdHeader,
      referencesHeader: m.referencesHeader,
      headers: m.headers,
      date: m.sentOrReceivedAt,
      text: m.textBody,
      html: m.htmlBody,
    },
    files: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      contentType: f.contentType,
      size: f.size,
      storagePath: f.storagePath,
    })),
  }
}

const base64Size = (bytes: number) => Math.ceil(bytes / 3) * 4

export async function sendMessage(
  deps: SendDeps,
  input: SendInput,
): Promise<SendResult> {
  const { db, own } = deps
  const log = deps.log ?? (() => undefined)
  const fail = (error: SendError): SendResult => ({ ok: false, error })

  const to = bareAddresses(input.to)
  const cc = bareAddresses(input.cc)
  const bcc = bareAddresses(input.bcc)
  if (to.length === 0) return fail('no_recipients')
  if (
    to.length > MAX_RECIPIENTS ||
    cc.length > MAX_RECIPIENTS ||
    bcc.length > MAX_RECIPIENTS
  ) {
    return fail('too_many_recipients')
  }

  const messageId = messageIdFor(input.draftId, own.domain)

  // Already sent (double click, retry after a partial failure): return what we stored.
  const [prior] = await db
    .select({ id: messages.id, threadId: messages.threadId })
    .from(messages)
    .where(
      and(
        eq(messages.messageIdHeader, messageId),
        eq(messages.direction, 'out'),
      ),
    )
    .limit(1)
  if (prior)
    return {
      ok: true,
      threadId: prior.threadId,
      messageId: prior.id,
      duplicate: true,
    }

  // Uploads must be this draft's own files: never let the client name arbitrary storage paths.
  const prefix = uploadPrefix(input.draftId)
  for (const u of input.uploads) {
    if (
      !u.path.startsWith(prefix) ||
      u.path.includes('..') ||
      u.path.length > 300
    ) {
      return fail('invalid_upload')
    }
  }

  let source: SourceMessage | null = null
  let sourceFiles: SourceFile[] = []
  if (input.mode !== 'new') {
    if (!input.sourceMessageId) return fail('source_not_found')
    const loaded = await loadSource(db, input.sourceMessageId)
    if (!loaded) return fail('source_not_found')
    source = loaded.source
    sourceFiles = loaded.files
  }

  const forwardFiles = sourceFiles.filter((f) =>
    input.forwardAttachmentIds.includes(f.id),
  )
  if (forwardFiles.length !== new Set(input.forwardAttachmentIds).size) {
    return fail('invalid_upload')
  }

  const bodies = composeBodies({ text: input.text, mode: input.mode, source })

  const outgoing: OutgoingAttachment[] = []
  try {
    for (const u of input.uploads) {
      outgoing.push({
        filename: u.filename,
        contentType: u.contentType,
        content: await deps.blobs.download(u.path),
      })
    }
    for (const f of forwardFiles) {
      outgoing.push({
        filename: f.filename,
        contentType: f.contentType,
        content: await deps.blobs.download(f.storagePath),
      })
    }
  } catch (e) {
    log(`send: attachment fetch failed: ${describeError(e)}`)
    return fail('invalid_upload')
  }

  const encoded = outgoing.reduce(
    (n, a) => n + base64Size(a.content.byteLength),
    0,
  )
  if (encoded + bodies.text.length + bodies.html.length > MAX_EMAIL_BYTES)
    return fail('too_large')

  const headers: Record<string, string> = { 'Message-ID': messageId }
  const replySource: SourceMessage | null =
    input.mode === 'reply' || input.mode === 'replyAll' ? source : null
  const references = replySource ? buildReferences(replySource) : []
  if (replySource?.messageIdHeader) {
    headers['In-Reply-To'] = replySource.messageIdHeader
    headers.References = references.join(' ')
  }

  let sentId: string
  try {
    const sent = await deps.mailer.send(
      {
        from: deps.from,
        to,
        cc,
        bcc,
        subject: input.subject,
        text: bodies.text,
        html: bodies.html,
        headers,
        attachments: outgoing,
      },
      { idempotencyKey: input.draftId },
    )
    sentId = sent.id
  } catch (e) {
    log(`send: provider rejected the message: ${describeError(e)}`)
    return fail('send_failed')
  }

  // The mail is out. Everything below must be retryable: the draft's temp files stay
  // until the row is saved, and the idempotency key returns the same sentId.
  try {
    const now = deps.now()
    const stored: {
      path: string
      filename: string
      contentType: string
      size: number
    }[] = []
    for (const [i, a] of outgoing.entries()) {
      const path = finalPath(input.draftId, i)
      await deps.blobs.put(path, a.content, a.contentType)
      stored.push({
        path,
        filename: a.filename,
        contentType: a.contentType,
        size: a.content.byteLength,
      })
    }

    const from = parseAddress(deps.from)
    const saved = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${INGEST_LOCK_KEY})`)
      const addresses = [...to, ...cc]
      const threadId = replySource
        ? replySource.threadId
        : await assignThread(tx, {
            messageId,
            inReplyTo: null,
            references: [],
            subject: input.subject,
            addresses,
            date: now,
            ownDomain: own.domain,
          })
      if (replySource) {
        await touchThread(
          tx,
          threadId,
          now,
          externalParticipants(addresses, own.domain),
        )
      }

      const [row] = await tx
        .insert(messages)
        .values({
          threadId,
          resendId: sentId,
          direction: 'out',
          messageIdHeader: messageId,
          inReplyTo: replySource?.messageIdHeader ?? null,
          referencesHeader: references.length > 0 ? references.join(' ') : null,
          fromAddress: from.address,
          fromName: from.name,
          toAddresses: to,
          cc,
          bcc,
          subject: input.subject,
          textBody: bodies.text,
          htmlBody: bodies.html,
          headers,
          isRead: true,
          folder: 'sent',
          sentOrReceivedAt: now,
        })
        .onConflictDoNothing({ target: messages.resendId })
        .returning({ id: messages.id })
      if (!row) return null
      if (stored.length > 0) {
        await tx.insert(attachmentsTable).values(
          stored.map((s, i) => ({
            messageId: row.id,
            resendAttachmentId: `out-${i}`,
            filename: s.filename,
            contentType: s.contentType,
            size: s.size,
            storagePath: s.path,
          })),
        )
      }
      return { id: row.id, threadId }
    })

    if (!saved) {
      const [again] = await db
        .select({ id: messages.id, threadId: messages.threadId })
        .from(messages)
        .where(eq(messages.resendId, sentId))
        .limit(1)
      if (!again) return fail('sent_but_not_saved')
      return {
        ok: true,
        threadId: again.threadId,
        messageId: again.id,
        duplicate: true,
      }
    }

    await deps.blobs
      .remove(input.uploads.map((u) => u.path))
      .catch(() => undefined)
    return {
      ok: true,
      threadId: saved.threadId,
      messageId: saved.id,
      duplicate: false,
    }
  } catch (e) {
    log(`send: saving the sent message failed: ${describeError(e)}`)
    return fail('sent_but_not_saved')
  }
}
