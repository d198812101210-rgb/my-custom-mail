import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ThreadList } from '#/components/ThreadList'
import { listThreadsFn } from '#/server/threads.fn'

export const Route = createFileRoute('/_app/search')({
  validateSearch: z.object({ q: z.string().max(200).catch('') }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  head: () => ({ meta: [{ title: 'Search · Mailbox' }] }),
  loader: ({ deps }) =>
    deps.q
      ? listThreadsFn({ data: { folder: 'all', q: deps.q } })
      : { threads: [], nextCursor: null },
  component: SearchPage,
})

function SearchPage() {
  const { q } = Route.useSearch()
  const initial = Route.useLoaderData()
  return (
    <main>
      <h2 className="px-4 pt-3 text-sm font-medium text-neutral-500">
        Results for “{q}”
      </h2>
      <ThreadList
        key={q}
        initial={initial}
        scope={{ folder: 'all', q }}
        empty="No messages match."
      />
    </main>
  )
}
