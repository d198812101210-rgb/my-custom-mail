/**
 * Local throwaway Postgres for trying the app without Supabase:
 *   npx tsx scripts/dev-db.ts [--seed]
 * Serves an in-memory PGlite over the Postgres wire protocol on 127.0.0.1:54329 with the real
 * migrations applied. Point DATABASE_URL at postgresql://postgres:postgres@127.0.0.1:54329/postgres and set
 * DATABASE_POOL_MAX=1 (PGlite shares one unnamed prepared statement across connections).
 * Resend and Storage are not emulated. With --seed it adds sample mail and prints a session cookie.
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { attachments, messages, sessions, threads } from '../src/db/schema'
import { hashToken } from '../src/server/auth/crypto'

const PORT = 54329
const SEED_TOKEN = 'dev-session-token-not-for-production'

const client = new PGlite()
const db = drizzle(client)
await migrate(db, { migrationsFolder: './drizzle' })

if (process.argv.includes('--seed')) {
  const now = Date.now()
  await db.insert(sessions).values({
    tokenHash: hashToken(SEED_TOKEN),
    expiresAt: new Date(now + 90 * 24 * 3600 * 1000),
  })

  const [news] = await db
    .insert(threads)
    .values({
      normalizedSubject: 'weekly digest',
      lastMessageAt: new Date(now - 3600_000),
      participants: ['news@sender.example'],
    })
    .returning()
  const [plain] = await db
    .insert(threads)
    .values({
      normalizedSubject: 'invoice 42',
      lastMessageAt: new Date(now - 7200_000),
      participants: ['billing@acme.example'],
    })
    .returning()
  if (!news || !plain) throw new Error('seed failed')

  const hostile = `<h1 style="color:#c00">Weekly digest</h1>
<p>Hello <a href="https://example.com/x">link</a> and <a href="javascript:alert('xss')">bad link</a></p>
<script>document.title='pwned'</script>
<img src="https://tracker.example/pixel.gif" width="1" height="1">
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" onerror="alert(1)" alt="inline">
<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name=x></form>`

  const [m1] = await db
    .insert(messages)
    .values({
      threadId: news.id,
      direction: 'in',
      resendId: 'seed_1',
      messageIdHeader: '<seed1@sender.example>',
      fromAddress: 'news@sender.example',
      fromName: 'The Newsletter',
      toAddresses: ['promo@tanakadev.digital'],
      receivedFor: ['promo@tanakadev.digital'],
      subject: 'Weekly digest',
      htmlBody: hostile,
      textBody: 'Weekly digest — plain version',
      spf: 'fail',
      dkim: 'pass',
      dmarc: 'fail',
      sentOrReceivedAt: new Date(now - 3600_000),
    })
    .returning()
  await db.insert(messages).values({
    threadId: plain.id,
    direction: 'in',
    resendId: 'seed_2',
    messageIdHeader: '<seed2@acme.example>',
    fromAddress: 'billing@acme.example',
    fromName: 'Acme Billing',
    toAddresses: ['test@tanakadev.digital'],
    receivedFor: ['test@tanakadev.digital'],
    subject: 'Invoice 42',
    textBody: 'Please find the invoice attached.\n<b>not bold</b>',
    spf: 'pass',
    dkim: 'pass',
    dmarc: 'pass',
    sentOrReceivedAt: new Date(now - 7200_000),
  })
  const [m3] = await db
    .select()
    .from(messages)
    .where((await import('drizzle-orm')).eq(messages.resendId, 'seed_2'))
  if (m1 && m3) {
    await db.insert(attachments).values({
      messageId: m3.id,
      resendAttachmentId: 'att_1',
      filename: 'invoice-42.pdf',
      contentType: 'application/pdf',
      size: 48213,
      disposition: 'attachment',
      storagePath: 'inbound/seed_2/att_1',
    })
  }
  console.log(`Seeded. Session cookie: session=${SEED_TOKEN}`)
}

const server = new PGLiteSocketServer({
  db: client,
  port: PORT,
  host: '127.0.0.1',
  maxConnections: 20,
})
await server.start()
console.log(`PGlite listening on 127.0.0.1:${PORT}`)
