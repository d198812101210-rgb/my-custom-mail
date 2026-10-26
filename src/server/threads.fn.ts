import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { FOLDERS } from '#/db/schema'

// Server functions are only reachable with a valid session (enforced in src/start.ts).

const uuid = z.uuid()
const folderFilter = z.enum([...FOLDERS, 'all'])
const moveTarget = z.enum(['inbox', 'archive', 'trash'])

export const listThreadsFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      folder: folderFilter,
      q: z.string().max(200).optional(),
      cursor: z
        .object({ at: z.iso.datetime(), id: uuid })
        .nullable()
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const [{ db }, { listThreads }] = await Promise.all([
      import('#/db/client'),
      import('#/server/mail/queries'),
    ])
    return listThreads(db, data)
  })

export const unreadCountsFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [{ db }, { unreadCounts }] = await Promise.all([
      import('#/db/client'),
      import('#/server/mail/queries'),
    ])
    return unreadCounts(db)
  },
)

export const getThreadFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const [{ db }, { getThread }, { renderMessageBody }, { isFailing }] =
      await Promise.all([
        import('#/db/client'),
        import('#/server/mail/queries'),
        import('#/server/mail/render'),
        import('#/server/mail/auth-results'),
      ])
    const found = await getThread(db, data.id)
    if (!found) return null

    // Raw HTML and full headers stay on the server; the client only gets
    // sanitized markup plus the few header-derived fields it displays.
    return {
      id: found.thread.id,
      subject: found.messages.at(-1)?.subject ?? '',
      messages: found.messages.map((m) => {
        const auth = { spf: m.spf, dkim: m.dkim, dmarc: m.dmarc }
        return {
          id: m.id,
          direction: m.direction === 'out' ? ('out' as const) : ('in' as const),
          folder: m.folder,
          isRead: m.isRead,
          fromAddress: m.fromAddress,
          fromName: m.fromName,
          to: m.toAddresses,
          cc: m.cc,
          receivedFor: m.receivedFor,
          subject: m.subject,
          date: m.sentOrReceivedAt,
          body: renderMessageBody(m),
          authFailures: (['spf', 'dkim', 'dmarc'] as const)
            .filter((k) => isFailing(auth[k]))
            .map((k) => `${k.toUpperCase()} ${auth[k]}`),
          attachments: found.attachments
            .filter(
              (a) =>
                a.messageId === m.id &&
                !(a.disposition === 'inline' && a.contentId),
            )
            .map((a) => ({
              id: a.id,
              filename: a.filename,
              size: a.size,
              contentType: a.contentType,
            })),
        }
      }),
    }
  })

export const markThreadReadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid }))
  .handler(async ({ data }) => {
    const [{ db }, { markThreadRead }] = await Promise.all([
      import('#/db/client'),
      import('#/server/mail/actions'),
    ])
    await markThreadRead(db, data.id)
    return { ok: true as const }
  })

export const setReadFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({ ids: z.array(uuid).min(1).max(200), read: z.boolean() }),
  )
  .handler(async ({ data }) => {
    const [{ db }, { setRead }] = await Promise.all([
      import('#/db/client'),
      import('#/server/mail/actions'),
    ])
    await setRead(db, data.ids, data.read)
    return { ok: true as const }
  })

export const moveThreadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuid, to: moveTarget }))
  .handler(async ({ data }) => {
    const [{ db }, { moveThread }] = await Promise.all([
      import('#/db/client'),
      import('#/server/mail/actions'),
    ])
    await moveThread(db, data.id, data.to)
    return { ok: true as const }
  })

export const moveMessagesFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: z.array(uuid).min(1).max(200), to: moveTarget }))
  .handler(async ({ data }) => {
    const [{ db }, { moveMessages }] = await Promise.all([
      import('#/db/client'),
      import('#/server/mail/actions'),
    ])
    await moveMessages(db, data.ids, data.to)
    return { ok: true as const }
  })
