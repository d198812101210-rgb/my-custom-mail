import { desc, eq, inArray, or, sql } from 'drizzle-orm'
import { messages, threads } from '#/db/schema'
import type { Db } from '#/db/types'
import { domainOf } from './address'

const REPLY_PREFIX =
  /^\s*(?:(?:re|fwd?|aw|wg|sv|vs|antw|res|rv|odp|tr|ref|отв|ответ|пересл)(?:\[\d+\])?\s*:\s*)+/i

/** Subject without Re:/Fwd:-style prefixes, lowercased, whitespace collapsed. */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? '')
    .replace(REPLY_PREFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** "<abc@x>" in any spacing/case of brackets -> "<abc@x>" */
export function normalizeMessageId(id: string): string {
  return `<${id.trim().replace(/^<|>$/g, '').trim()}>`
}

export function parseMessageIds(header: string | null | undefined): string[] {
  if (!header) return []
  const ids = header.match(/<[^<>\s]+>/g) ?? []
  return [...new Set(ids.map(normalizeMessageId))]
}

/**
 * Participants used for subject-based matching: external addresses only.
 * Our own address is on every message, so including it would make any two
 * mails with the same subject look related.
 */
export function externalParticipants(
  addresses: readonly string[],
  ownDomain: string,
): string[] {
  const own = ownDomain.toLowerCase()
  return [
    ...new Set(
      addresses
        .map((a) => a.toLowerCase())
        .filter((a) => a && domainOf(a) !== own),
    ),
  ]
}

const FALLBACK_WINDOW_MS = 30 * 24 * 3600 * 1000

export interface ThreadInput {
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  subject: string
  /** All from/to/cc addresses; own-domain ones are filtered out here. */
  addresses: string[]
  date: Date
  ownDomain: string
}

const textArray = (values: readonly string[]) =>
  sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`

/**
 * Finds the thread a message belongs to, or creates one, and records the message
 * in the thread's metadata. Must run inside the ingestion transaction.
 *
 * Order: (1) this message replies to a stored one, (2) a stored message replies
 * to this one (reply arrived first), (3) same normalized subject with a shared
 * external participant within 30 days.
 */
export async function assignThread(
  db: Db,
  input: ThreadInput,
): Promise<string> {
  const refIds = [
    ...new Set([
      ...(input.inReplyTo ? [input.inReplyTo] : []),
      ...input.references,
    ]),
  ]
  const participants = externalParticipants(input.addresses, input.ownDomain)

  let threadId: string | undefined

  if (refIds.length > 0) {
    const [hit] = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(inArray(messages.messageIdHeader, refIds))
      .orderBy(desc(messages.sentOrReceivedAt))
      .limit(1)
    threadId = hit?.threadId
  }

  if (!threadId && input.messageId) {
    const [hit] = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(
        or(
          eq(messages.inReplyTo, input.messageId),
          sql`position(${input.messageId} in coalesce(${messages.referencesHeader}, '')) > 0`,
        ),
      )
      .orderBy(desc(messages.sentOrReceivedAt))
      .limit(1)
    threadId = hit?.threadId
  }

  const normalized = normalizeSubject(input.subject)
  if (!threadId && normalized && participants.length > 0) {
    const since = new Date(input.date.getTime() - FALLBACK_WINDOW_MS)
    const [hit] = await db
      .select({ id: threads.id })
      .from(threads)
      .where(
        sql`${threads.normalizedSubject} = ${normalized}
          and ${threads.lastMessageAt} >= ${since}
          and ${threads.participants} && ${textArray(participants)}`,
      )
      .orderBy(desc(threads.lastMessageAt))
      .limit(1)
    threadId = hit?.id
  }

  if (!threadId) {
    const [created] = await db
      .insert(threads)
      .values({
        normalizedSubject: normalized,
        lastMessageAt: input.date,
        participants,
      })
      .returning({ id: threads.id })
    if (!created) throw new Error('thread insert returned no row')
    return created.id
  }

  await touchThread(db, threadId, input.date, participants)
  return threadId
}

/** Advance last_message_at (never backwards) and merge participants. */
export async function touchThread(
  db: Db,
  threadId: string,
  date: Date,
  participants: readonly string[],
): Promise<void> {
  await db
    .update(threads)
    .set({
      lastMessageAt: sql`greatest(${threads.lastMessageAt}, ${date})`,
      participants:
        participants.length > 0
          ? sql`(select coalesce(array_agg(distinct p), '{}') from unnest(${threads.participants} || ${textArray(participants)}) as p)`
          : threads.participants,
    })
    .where(eq(threads.id, threadId))
}
