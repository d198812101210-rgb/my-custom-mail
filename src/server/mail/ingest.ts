import { eq, inArray, sql } from 'drizzle-orm'
import { attachments, messages } from '#/db/schema'
import type { Db } from '#/db/types'
import { bareAddresses, domainOf, parseAddress } from './address'
import { parseAuthResults } from './auth-results'
import { assignThread, normalizeMessageId, parseMessageIds } from './threading'
import type {
  AttachmentMeta,
  BlobStore,
  MailSource,
  ReceivedEmail,
} from './types'

export interface IngestDeps {
  db: Db
  mail: MailSource
  store: BlobStore
  /** Domain this mailbox owns, e.g. tanakadev.digital. */
  ownDomain: string
}

export type IngestResult = 'imported' | 'duplicate'

// One writer at a time: keeps thread assignment race-free (two replies arriving
// together cannot create two threads) and makes retries of the same email serial.
// Single-user app, so the lost parallelism is irrelevant.
export const INGEST_LOCK_KEY = 7001

function header(
  headers: Record<string, string> | null,
  name: string,
): string | null {
  if (!headers) return null
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
  return key === undefined ? null : (headers[key] ?? null)
}

export const storagePathFor = (emailId: string, attachmentId: string) =>
  `inbound/${emailId}/${attachmentId}`

/**
 * Imports one received email. Idempotent: calling it again for the same Resend
 * id (webhook retry, replay, sync) is a no-op once it has succeeded, and a call
 * that failed part-way leaves nothing behind except already-uploaded files,
 * which the retry overwrites at the same path.
 *
 * Throws on any failure so the caller can return a non-2xx and let Resend retry.
 */
export async function ingestReceivedEmail(
  deps: IngestDeps,
  emailId: string,
): Promise<IngestResult> {
  const { db, mail, store, ownDomain } = deps

  if (await exists(db, emailId)) return 'duplicate'

  const email = await mail.getReceived(emailId)
  const metas = await mail.listAttachments(emailId)

  // Files first: Resend's download URLs expire after about an hour. The DB write
  // below is a single transaction, so the message and its attachment rows appear
  // together or not at all.
  for (const meta of metas) {
    const bytes = await mail.download(meta.downloadUrl)
    await store.put(storagePathFor(emailId, meta.id), bytes, meta.contentType)
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${INGEST_LOCK_KEY})`)
    if (await exists(tx, emailId)) return 'duplicate'

    const row = buildMessageRow(email, ownDomain)
    const threadId = await assignThread(tx, {
      messageId: row.messageIdHeader,
      inReplyTo: row.inReplyTo,
      references: parseMessageIds(row.referencesHeader),
      subject: row.subject,
      addresses: [row.fromAddress, ...row.toAddresses, ...row.cc],
      date: row.sentOrReceivedAt,
      ownDomain,
    })

    const [inserted] = await tx
      .insert(messages)
      .values({ ...row, threadId })
      .onConflictDoNothing({ target: messages.resendId })
      .returning({ id: messages.id })
    if (!inserted) return 'duplicate'

    if (metas.length > 0) {
      await tx
        .insert(attachments)
        .values(metas.map((m) => attachmentRow(inserted.id, emailId, m)))
        .onConflictDoNothing()
    }
    return 'imported'
  })
}

async function exists(db: Db, emailId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.resendId, emailId))
    .limit(1)
  return row !== undefined
}

/** Which of these Resend ids are already stored. */
export async function existingResendIds(
  db: Db,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await db
    .select({ resendId: messages.resendId })
    .from(messages)
    .where(inArray(messages.resendId, ids))
  return new Set(rows.flatMap((r) => (r.resendId ? [r.resendId] : [])))
}

function buildMessageRow(email: ReceivedEmail, ownDomain: string) {
  const from = parseAddress(email.from)
  const rawMessageId = email.messageId ?? header(email.headers, 'message-id')
  const inReplyToRaw =
    parseMessageIds(header(email.headers, 'in-reply-to'))[0] ?? null
  const references = parseMessageIds(header(email.headers, 'references'))
  const auth = parseAuthResults(email.headers)
  const toAddresses = bareAddresses(email.to)
  // Catch-all: received_for says which address on our domain this was sent to.
  const receivedFor = bareAddresses(email.receivedFor)
  const fallbackFor = toAddresses.filter(
    (a) => domainOf(a) === ownDomain.toLowerCase(),
  )

  return {
    resendId: email.id,
    direction: 'in' as const,
    messageIdHeader: rawMessageId ? normalizeMessageId(rawMessageId) : null,
    inReplyTo: inReplyToRaw,
    referencesHeader: references.length > 0 ? references.join(' ') : null,
    fromAddress: from.address,
    fromName: from.name,
    toAddresses,
    cc: bareAddresses(email.cc),
    bcc: bareAddresses(email.bcc),
    receivedFor: receivedFor.length > 0 ? receivedFor : fallbackFor,
    subject: email.subject,
    textBody: email.text,
    htmlBody: email.html,
    headers: email.headers,
    spf: auth.spf,
    dkim: auth.dkim,
    dmarc: auth.dmarc,
    isRead: false,
    folder: 'inbox' as const,
    sentOrReceivedAt: email.createdAt,
  }
}

function attachmentRow(messageId: string, emailId: string, m: AttachmentMeta) {
  return {
    messageId,
    resendAttachmentId: m.id,
    filename: m.filename ?? 'attachment',
    contentType: m.contentType,
    size: m.size,
    contentId: m.contentId,
    disposition: m.disposition,
    storagePath: storagePathFor(emailId, m.id),
  }
}
