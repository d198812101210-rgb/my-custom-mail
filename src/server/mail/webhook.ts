import { z } from 'zod'
import { describeError } from '../log'
import { ingestReceivedEmail } from './ingest'
import type { IngestDeps } from './ingest'

export interface WebhookDeps {
  /** undefined until the signing secret has been configured. */
  secret: string | undefined
  /** Throws when the signature is invalid. Returns the parsed event. */
  verify: (opts: {
    payload: string
    headers: { id: string; timestamp: string; signature: string }
    webhookSecret: string
  }) => unknown
  ingest: IngestDeps
  log?: (line: string) => void
}

const event = z.object({
  type: z.string(),
  data: z.unknown(),
})
const receivedData = z.object({ email_id: z.string().min(1) })

const json = (body: unknown, status: number) => Response.json(body, { status })

/**
 * POST /api/webhooks/resend
 *
 * 2xx only after the email is saved (or was already saved); any transient
 * failure is a 5xx so Resend retries. Signature failures and malformed
 * payloads are 4xx because retrying cannot fix them.
 */
export async function handleResendWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<Response> {
  const log = deps.log ?? (() => undefined)
  if (!deps.secret) return json({ error: 'webhook_not_configured' }, 503)

  // Raw body, untouched: the signature covers the exact bytes.
  const payload = await request.text()
  const id = request.headers.get('svix-id')
  const timestamp = request.headers.get('svix-timestamp')
  const signature = request.headers.get('svix-signature')
  if (!id || !timestamp || !signature)
    return json({ error: 'missing_signature' }, 400)

  let verified: unknown
  try {
    verified = deps.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret: deps.secret,
    })
  } catch {
    return json({ error: 'invalid_signature' }, 400)
  }

  const parsed = event.safeParse(verified)
  if (!parsed.success) return json({ error: 'invalid_payload' }, 400)
  if (parsed.data.type !== 'email.received')
    return json({ ok: true, ignored: true }, 200)

  const data = receivedData.safeParse(parsed.data.data)
  if (!data.success) return json({ error: 'invalid_payload' }, 400)

  try {
    const result = await ingestReceivedEmail(deps.ingest, data.data.email_id)
    return json({ ok: true, result }, 200)
  } catch (e) {
    log(`webhook: ingest failed: ${describeError(e)}`)
    return json({ error: 'ingest_failed' }, 500)
  }
}
