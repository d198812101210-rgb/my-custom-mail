/**
 * Live experiment: does Resend honour custom In-Reply-To, References and Message-ID headers?
 *
 *   npm run test:headers
 *
 * Sends one test message from MAIL_FROM to a catch-all address on our own domain, waits for it
 * to arrive through Resend's receiving API, and compares the headers that came back with the
 * ones we asked for. Prints only header names, ids and true/false: never message bodies.
 * It sends exactly one email and needs RESEND_API_KEY and MAIL_FROM in .env.local.
 */
import { config } from 'dotenv'
import { Resend } from 'resend'

config({ path: '.env.local' })

const apiKey = process.env.RESEND_API_KEY
const from = process.env.MAIL_FROM
if (!apiKey || !from) {
  console.error('RESEND_API_KEY and MAIL_FROM must be set in .env.local.')
  process.exit(1)
}

const resend = new Resend(apiKey)
const domain = (/<([^<>]+)>/.exec(from)?.[1] ?? from).split('@').pop() ?? ''
const run = crypto.randomUUID().slice(0, 8)
const wanted = {
  'Message-ID': `<hdrtest-${run}@${domain}>`,
  'In-Reply-To': `<parent-${run}@${domain}>`,
  References: `<root-${run}@${domain}> <parent-${run}@${domain}>`,
}
const subject = `Header test ${run}`
const to = `headers-test@${domain}`

const { data: sent, error } = await resend.emails.send({
  from,
  to,
  subject,
  text: 'Automated header test. Safe to delete.',
  headers: wanted,
})
if (error) {
  console.error(`Send failed: ${error.name}`)
  process.exit(1)
}
console.log(`Sent ${sent.id} to ${to}; waiting for it to arrive via receiving…`)

const norm = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim()
const pick = (h: Record<string, string> | null, name: string) =>
  h
    ? h[
        Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ''
      ]
    : undefined

let received: { id: string; headers: Record<string, string> | null } | null =
  null
for (let attempt = 0; attempt < 30 && !received; attempt++) {
  await new Promise((r) => setTimeout(r, 4000))
  const { data: list } = await resend.emails.receiving.list({ limit: 20 })
  const hit = list?.data.find((e) => e.subject === subject)
  if (hit) {
    const { data: full } = await resend.emails.receiving.get(hit.id)
    if (full) received = { id: full.id, headers: full.headers }
  }
}
if (!received) {
  console.error(
    'The test message did not arrive within two minutes. Check that receiving is enabled.',
  )
  process.exit(2)
}

const { data: sentInfo } = await resend.emails.get(sent.id)

console.log('\nHeader                requested == received?')
for (const [name, value] of Object.entries(wanted)) {
  const got = pick(received.headers, name)
  console.log(
    `${name.padEnd(21)} ${norm(got) === norm(value) ? 'HONORED' : 'NOT honored'}${got ? '' : ' (absent)'}`,
  )
  if (got && norm(got) !== norm(value))
    console.log(`  received ${name}: ${got}`)
}
console.log(
  `\nemails.get(${sent.id}).message_id: ${sentInfo?.message_id ?? '(none)'}`,
)
console.log(
  `...equals received Message-ID header: ${norm(sentInfo?.message_id) === norm(pick(received.headers, 'message-id'))}`,
)
console.log(
  `...equals the Message-ID we requested: ${norm(sentInfo?.message_id) === norm(wanted['Message-ID'])}`,
)
console.log(
  '\nIf In-Reply-To / References / Message-ID are NOT honored, threading still works:',
)
console.log(
  'replies fall back to subject + shared participant within 30 days (see src/server/mail/threading.ts).',
)
