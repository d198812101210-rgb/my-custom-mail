import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Server functions are only reachable with a valid session (enforced in src/start.ts).

const uuid = z.uuid()
const mode = z.enum(['new', 'reply', 'replyAll', 'forward'])
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024 // 40 MB after base64 encoding

export const prepareDraftFn = createServerFn({ method: 'GET' })
  .validator(z.object({ mode, sourceId: uuid.optional() }))
  .handler(async ({ data }) => {
    const [{ env }, { db }, { loadSource }, compose] = await Promise.all([
      import('#/env.server'),
      import('#/db/client'),
      import('#/server/mail/send'),
      import('#/server/mail/compose'),
    ])
    const own = compose.ownIdentity(env.MAIL_FROM)
    const loaded = data.sourceId ? await loadSource(db, data.sourceId) : null
    const source = loaded?.source ?? null
    const defaults = compose.draftDefaults(source, data.mode, own)
    return {
      draftId: crypto.randomUUID(),
      mode: source ? data.mode : ('new' as const),
      sourceMessageId: source?.id ?? null,
      ...defaults,
      // What will be appended below the user's text, shown read-only.
      quote: source
        ? data.mode === 'forward'
          ? compose.forwardText(source)
          : compose.quoteText(source)
        : '',
      forwardable:
        data.mode === 'forward' && loaded
          ? loaded.files
              .filter((f) => !f.storagePath.startsWith('outbound/tmp/'))
              .map((f) => ({ id: f.id, filename: f.filename, size: f.size }))
          : [],
    }
  })

export const createUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      draftId: uuid,
      filename: z.string().min(1).max(255),
      size: z.number().int().min(0).max(MAX_UPLOAD_BYTES),
    }),
  )
  .handler(async ({ data }) => {
    const [{ storage }, { uploadPrefix }] = await Promise.all([
      import('#/server/mail/sources.server'),
      import('#/server/mail/send'),
    ])
    // The object name is ours (random); the display filename travels separately.
    const path = `${uploadPrefix(data.draftId)}${crypto.randomUUID()}`
    const { data: signed, error } = await storage.createSignedUploadUrl(path)
    if (error) throw new Error('upload_url_failed')
    return { path, signedUrl: signed.signedUrl }
  })

const addresses = z.array(z.email().max(254)).max(50)

export const sendMailFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      draftId: uuid,
      mode,
      sourceMessageId: uuid.optional(),
      to: addresses,
      cc: addresses,
      bcc: addresses,
      subject: z.string().max(998),
      text: z.string().max(1_000_000),
      uploads: z
        .array(
          z.object({
            path: z.string().max(300),
            filename: z.string().min(1).max(255),
            contentType: z.string().max(200),
          }),
        )
        .max(25),
      forwardAttachmentIds: z.array(uuid).max(25),
    }),
  )
  .handler(async ({ data }) => {
    const [{ env }, { db }, sources, { sendMessage }, { ownIdentity }] =
      await Promise.all([
        import('#/env.server'),
        import('#/db/client'),
        import('#/server/mail/sources.server'),
        import('#/server/mail/send'),
        import('#/server/mail/compose'),
      ])
    return sendMessage(
      {
        db,
        mailer: sources.resendMailer,
        blobs: sources.supabaseBlobs,
        from: env.MAIL_FROM,
        own: ownIdentity(env.MAIL_FROM),
        now: () => new Date(),
        log: (line) => console.error(line),
      },
      data,
    )
  })
