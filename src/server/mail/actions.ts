import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { messages } from '#/db/schema'
import type { Db } from '#/db/types'

export type MoveTarget = 'inbox' | 'archive' | 'trash'

export async function setRead(
  db: Db,
  messageIds: string[],
  read: boolean,
): Promise<void> {
  if (messageIds.length === 0) return
  await db
    .update(messages)
    .set({ isRead: read })
    .where(inArray(messages.id, messageIds))
}

export async function markThreadRead(db: Db, threadId: string): Promise<void> {
  await db
    .update(messages)
    .set({ isRead: true })
    .where(and(eq(messages.threadId, threadId), eq(messages.isRead, false)))
}

/**
 * Folder rules, shared by per-message and per-thread moves:
 *  - archive: inbox mail leaves the inbox (sent mail stays in Sent)
 *  - trash:   everything not already trashed
 *  - inbox:   archived/trashed mail comes back; our own mail returns to Sent
 */
function moveChange(target: MoveTarget): {
  set: { folder: SQL | string }
  applies: SQL
} {
  switch (target) {
    case 'archive':
      return {
        set: { folder: 'archive' },
        applies: sql`${messages.folder} = 'inbox'`,
      }
    case 'trash':
      return {
        set: { folder: 'trash' },
        applies: sql`${messages.folder} <> 'trash'`,
      }
    case 'inbox':
      return {
        set: {
          folder: sql`case when ${messages.direction} = 'out' then 'sent' else 'inbox' end`,
        },
        applies: sql`${messages.folder} in ('archive', 'trash')`,
      }
  }
}

export async function moveMessages(
  db: Db,
  messageIds: string[],
  target: MoveTarget,
): Promise<void> {
  if (messageIds.length === 0) return
  const { set, applies } = moveChange(target)
  await db
    .update(messages)
    .set(set)
    .where(and(inArray(messages.id, messageIds), applies))
}

export async function moveThread(
  db: Db,
  threadId: string,
  target: MoveTarget,
): Promise<void> {
  const { set, applies } = moveChange(target)
  await db
    .update(messages)
    .set(set)
    .where(and(eq(messages.threadId, threadId), applies))
}
