import {
  createFileRoute,
  notFound,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useEffect } from 'react'
import { MessageCard } from '#/components/MessageCard'
import { useHotkeys } from '#/lib/hotkeys'
import {
  getThreadFn,
  markThreadReadFn,
  moveMessagesFn,
  moveThreadFn,
  setReadFn,
} from '#/server/threads.fn'

export const Route = createFileRoute('/_app/thread/$id')({
  loader: async ({ params }) => {
    const thread = await getThreadFn({ data: { id: params.id } })
    if (!thread) throw notFound()
    return thread
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.subject || '(no subject)'} · Mailbox` }],
  }),
  component: ThreadPage,
})

function ThreadPage() {
  const thread = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()

  const hasUnread = thread.messages.some((m) => !m.isRead)
  useEffect(() => {
    if (!hasUnread) return
    void markThreadReadFn({ data: { id: thread.id } }).then(() =>
      router.invalidate(),
    )
    // Only when the thread (or its unread state) changes.
  }, [thread.id, hasUnread, router])

  const canArchive = thread.messages.some((m) => m.folder === 'inbox')
  const canRestore = thread.messages.some(
    (m) => m.folder === 'archive' || m.folder === 'trash',
  )
  const allTrashed = thread.messages.every((m) => m.folder === 'trash')

  function back() {
    if (window.history.length > 1) router.history.back()
    else void navigate({ to: '/$folder', params: { folder: 'inbox' } })
  }

  async function moveThread(to: 'archive' | 'trash' | 'inbox', leave: boolean) {
    await moveThreadFn({ data: { id: thread.id, to } })
    await router.invalidate()
    if (leave) back()
  }

  async function markUnread() {
    const last = thread.messages.at(-1)
    if (!last) return
    await setReadFn({ data: { ids: [last.id], read: false } })
    await router.invalidate()
    back()
  }

  useHotkeys({
    Escape: back,
    q: back,
    e: () => canArchive && void moveThread('archive', true),
    '#': () => !allTrashed && void moveThread('trash', true),
    u: () => void markUnread(),
  })

  const btn =
    'rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
  const lastIndex = thread.messages.length - 1

  return (
    <main className="mx-auto w-full max-w-3xl px-3 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className={btn} onClick={back} aria-label="Back">
          ←
        </button>
        {canArchive ? (
          <button
            className={btn}
            onClick={() => void moveThread('archive', true)}
          >
            Archive
          </button>
        ) : null}
        {canRestore ? (
          <button
            className={btn}
            onClick={() => void moveThread('inbox', false)}
          >
            Move to inbox
          </button>
        ) : null}
        {!allTrashed ? (
          <button
            className={btn}
            onClick={() => void moveThread('trash', true)}
          >
            Trash
          </button>
        ) : null}
        <button className={btn} onClick={() => void markUnread()}>
          Mark unread
        </button>
      </div>

      <h2 className="mb-4 text-xl font-semibold break-words">
        {thread.subject || '(no subject)'}
      </h2>

      <div className="space-y-3">
        {thread.messages.map((m, i) => (
          <MessageCard
            key={m.id}
            m={m}
            defaultOpen={i === lastIndex || !m.isRead}
            onUnread={() => {
              void setReadFn({ data: { ids: [m.id], read: false } }).then(() =>
                router.invalidate(),
              )
            }}
            onMove={(to) => {
              void moveMessagesFn({ data: { ids: [m.id], to } }).then(() =>
                router.invalidate(),
              )
            }}
          />
        ))}
      </div>
    </main>
  )
}
