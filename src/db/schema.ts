import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// RLS is enabled on every table and no policies exist, so Supabase's
// anon/authenticated roles are denied. The app connects server-side only.

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const FOLDERS = ['inbox', 'archive', 'trash', 'sent'] as const
export type Folder = (typeof FOLDERS)[number]

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    normalizedSubject: text('normalized_subject').notNull(),
    lastMessageAt: timestamptz('last_message_at').notNull().defaultNow(),
    participants: text('participants')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    index('threads_last_message_at_idx').on(t.lastMessageAt.desc()),
    index('threads_subject_idx').on(t.normalizedSubject),
  ],
).enableRLS()

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    resendId: text('resend_id'),
    direction: text('direction').notNull(),
    messageIdHeader: text('message_id_header'),
    inReplyTo: text('in_reply_to'),
    referencesHeader: text('references_header'),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddresses: text('to_addresses')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    cc: text('cc')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    bcc: text('bcc')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    receivedFor: text('received_for')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    subject: text('subject').notNull().default(''),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    headers: jsonb('headers').$type<Record<string, string>>(),
    spf: text('spf'),
    dkim: text('dkim'),
    dmarc: text('dmarc'),
    isRead: boolean('is_read').notNull().default(false),
    folder: text('folder').notNull().default('inbox'),
    sentOrReceivedAt: timestamptz('sent_or_received_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    // 'simple' config: no language-specific stemming, so mixed-language mail works.
    // translate() splits addresses and URLs into parts (billing@acme.com -> billing acme com),
    // which the parser would otherwise keep as one token. It is immutable, as generated columns
    // require; array columns are not, so recipients are not part of the search document.
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('simple', translate(coalesce(subject, '') || ' ' || coalesce(text_body, '') || ' ' || coalesce(from_address, '') || ' ' || coalesce(from_name, ''), '@._-/', '     '))`,
    ),
  },
  (t) => [
    uniqueIndex('messages_resend_id_key').on(t.resendId),
    index('messages_thread_idx').on(t.threadId, t.sentOrReceivedAt),
    index('messages_folder_idx').on(t.folder, t.sentOrReceivedAt.desc()),
    index('messages_message_id_header_idx').on(t.messageIdHeader),
    index('messages_search_idx').using('gin', t.search),
    check('messages_direction_check', sql`${t.direction} in ('in', 'out')`),
    check(
      'messages_folder_check',
      sql`${t.folder} in ('inbox', 'archive', 'trash', 'sent')`,
    ),
  ],
).enableRLS()

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    resendAttachmentId: text('resend_attachment_id'),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull().default(0),
    contentId: text('content_id'),
    disposition: text('disposition'),
    storagePath: text('storage_path').notNull(),
  },
  (t) => [
    index('attachments_message_idx').on(t.messageId),
    // Lets a retried webhook re-insert attachments without duplicates.
    uniqueIndex('attachments_message_resend_key').on(
      t.messageId,
      t.resendAttachmentId,
    ),
  ],
).enableRLS()

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // SHA-256 of the random 256-bit cookie token; the token itself is never stored.
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastUsedAt: timestamptz('last_used_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (t) => [uniqueIndex('sessions_token_hash_key').on(t.tokenHash)],
).enableRLS()

export const otpCodes = pgTable('otp_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: text('code_hash').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: timestamptz('consumed_at'),
}).enableRLS()

export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamptz('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
).enableRLS()

// Browser push subscriptions (one row per installed browser). Endpoint is unique so
// re-subscribing is an upsert; rows are deleted when the push service reports them gone.
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
}).enableRLS()

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect

export type Thread = typeof threads.$inferSelect
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type Attachment = typeof attachments.$inferSelect
