import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const SIGNED_URL_TTL_SECONDS = 60

// Session-protected by the global gate. The bucket is private; the browser is
// redirected to a signed URL that expires after a minute.
export const Route = createFileRoute('/api/attachments/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = z.uuid().safeParse(params.id)
        if (!id.success) return new Response('Not found', { status: 404 })

        const [{ db }, { getAttachment }, { storage }] = await Promise.all([
          import('#/db/client'),
          import('#/server/mail/queries'),
          import('#/server/mail/sources.server'),
        ])
        const attachment = await getAttachment(db, id.data)
        if (!attachment) return new Response('Not found', { status: 404 })

        const { data, error } = await storage.createSignedUrl(
          attachment.storagePath,
          SIGNED_URL_TTL_SECONDS,
          { download: attachment.filename },
        )
        if (error) return new Response('Storage error', { status: 502 })
        return new Response(null, {
          status: 302,
          headers: { Location: data.signedUrl, 'Cache-Control': 'no-store' },
        })
      },
    },
  },
})
