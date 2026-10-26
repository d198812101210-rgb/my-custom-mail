import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { attachments, messages, threads } from '#/db/schema'
import type { Folder } from '#/db/schema'
import type { Db } from '#/db/types'

export type FolderFilter = Folder | 'all'

export interface ThreadSummary {
  id: string
  subject: string
  snippet: string
  fromName: string | null
  fromAddress: string
  lastAt: Date
  direction: 'in' | 'out'
  to: string[]
  receivedFor: string[]
  /** Unread messages in the listed scope. */
  unread: number
  /** Messages in the listed scope. */
  count: number
  hasAttachments: boolean
}

export interface ThreadCursor {
  at: string
  id: string
}

/**
 * Turns user input into a prefix-matching tsquery. Only letters and digits
 * survive, so tsquery operators in the input cannot change the query's shape;
 * the result is passed as a bound parameter.
 */
export function toTsQuery(input: string): string | null {
  const tokens = input.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? []
  return tokens.length > 0 ? tokens.map((t) => `${t}:*`).join(' & ') : null
}

function scope(folder: FolderFilter, q: string | undefined): SQL {
  const conds: SQL[] = [
    folder === 'all'
      ? ne(messages.folder, 'trash')
      : eq(messages.folder, folder),
  ]
  const tsq = q ? toTsQuery(q) : null
  if (tsq) conds.push(sql`${messages.search} @@ to_tsquery('simple', ${tsq})`)
  return and(...conds) as SQL
}

const SNIPPET_LENGTH = 160

function snippetOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH)
}

export async function listThreads(
  db: Db,
  opts: {
    folder: FolderFilter
    q?: string
    limit?: number
    cursor?: ThreadCursor | null
  },
): Promise<{ threads: ThreadSummary[]; nextCursor: ThreadCursor | null }> {
  const limit = opts.limit ?? 30
  const where = scope(opts.folder, opts.q)

  const latest = db
    .selectDistinctOn([messages.threadId], {
      threadId: messages.threadId,
      subject: messages.subject,
      fromName: messages.fromName,
      fromAddress: messages.fromAddress,
      direction: messages.direction,
      toAddresses: messages.toAddresses,
      receivedFor: messages.receivedFor,
      lastAt: messages.sentOrReceivedAt,
      // Cheap preview: first part of the text body, else tag-stripped start of the HTML.
      preview:
        sql<string>`left(coalesce(nullif(${messages.textBody}, ''), regexp_replace(left(coalesce(${messages.htmlBody}, ''), 5000), '<[^>]*>', ' ', 'g')), 600)`.as(
          'preview',
        ),
    })
    .from(messages)
    .where(where)
    .orderBy(messages.threadId, desc(messages.sentOrReceivedAt))
    .as('latest')

  const cursor = opts.cursor
  const cursorAt = cursor ? new Date(cursor.at) : null
  const rows = await db
    .select()
    .from(latest)
    .where(
      cursor && cursorAt
        ? or(
            lt(latest.lastAt, cursorAt),
            and(eq(latest.lastAt, cursorAt), lt(latest.threadId, cursor.id)),
          )
        : undefined,
    )
    .orderBy(desc(latest.lastAt), desc(latest.threadId))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const ids = page.map((r) => r.threadId)
  if (ids.length === 0) return { threads: [], nextCursor: null }

  const counts = await db
    .select({
      threadId: messages.threadId,
      total: count(),
      unread:
        sql<number>`count(*) filter (where not ${messages.isRead})`.mapWith(
          Number,
        ),
    })
    .from(messages)
    .where(and(where, inArray(messages.threadId, ids)))
    .groupBy(messages.threadId)

  const withFiles = await db
    .selectDistinct({ threadId: messages.threadId })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(
      and(
        inArray(messages.threadId, ids),
        sql`${attachments.disposition} is distinct from 'inline'`,
      ),
    )

  const countsById = new Map(counts.map((c) => [c.threadId, c]))
  const fileIds = new Set(withFiles.map((f) => f.threadId))
  const summaries = page.map((r): ThreadSummary => {
    const c = countsById.get(r.threadId)
    return {
      id: r.threadId,
      subject: r.subject,
      snippet: snippetOf(r.preview),
      fromName: r.fromName,
      fromAddress: r.fromAddress,
      lastAt: r.lastAt,
      direction: r.direction === 'out' ? 'out' : 'in',
      to: r.toAddresses,
      receivedFor: r.receivedFor,
      unread: c?.unread ?? 0,
      count: c?.total ?? 0,
      hasAttachments: fileIds.has(r.threadId),
    }
  })

  const last = page.at(-1)
  const nextCursor =
    rows.length > limit && last
      ? { at: last.lastAt.toISOString(), id: last.threadId }
      : null
  return { threads: summaries, nextCursor }
}

/** Threads with at least one unread message, per folder. */
export async function unreadCounts(db: Db): Promise<Record<Folder, number>> {
  const rows = await db
    .select({ folder: messages.folder, n: countDistinct(messages.threadId) })
    .from(messages)
    .where(eq(messages.isRead, false))
    .groupBy(messages.folder)
  const out: Record<Folder, number> = {
    inbox: 0,
    archive: 0,
    trash: 0,
    sent: 0,
  }
  for (const r of rows) {
    if (
      r.folder === 'inbox' ||
      r.folder === 'archive' ||
      r.folder === 'trash' ||
      r.folder === 'sent'
    ) {
      out[r.folder] = r.n
    }
  }
  return out
}

export async function getThread(db: Db, threadId: string) {
  const [thread] = await db
    .select()
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1)
  if (!thread) return null
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.sentOrReceivedAt), asc(messages.createdAt))
  const files = await db
    .select()
    .from(attachments)
    .where(
      inArray(
        attachments.messageId,
        msgs.map((m) => m.id),
      ),
    )
  return { thread, messages: msgs, attachments: files }
}

export async function getAttachment(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1)
  return row ?? null
}
