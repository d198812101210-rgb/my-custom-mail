import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Composer } from '#/components/Composer'
import { prepareDraftFn } from '#/server/compose.fn'

export const Route = createFileRoute('/_app/compose')({
  validateSearch: z.object({
    mode: z.enum(['new', 'reply', 'replyAll', 'forward']).catch('new'),
    src: z.uuid().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ mode: search.mode, src: search.src }),
  loader: ({ deps }) =>
    prepareDraftFn({ data: { mode: deps.mode, sourceId: deps.src } }),
  head: () => ({ meta: [{ title: 'Compose · Mailbox' }] }),
  component: ComposePage,
})

function ComposePage() {
  const draft = Route.useLoaderData()
  // Keyed by draft id so opening another reply starts a fresh form.
  return <Composer key={draft.draftId} initial={draft} />
}
