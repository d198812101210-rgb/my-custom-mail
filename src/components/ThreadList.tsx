import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { ThreadSummary } from '#/server/mail/queries'
import { PaperclipIcon } from '#/components/icons'
import { relativeTime, senderLabel } from '#/lib/format'
import { useHotkeys } from '#/lib/hotkeys'
import { listThreadsFn, moveThreadFn } from '#/server/threads.fn'

type Page = Awaited<ReturnType<typeof listThreadsFn>>
type Scope = {
  folder: 'inbox' | 'archive' | 'sent' | 'trash' | 'all'
  q?: string
}

export function ThreadList({
  initial,
  scope,
  empty,
}: {
  initial: Page
  scope: Scope
  empty: string
}) {
  const router = useRouter()
  const navigate = useNavigate()
  const [extra, setExtra] = useState<ThreadSummary[]>([])
  const [cursor, setCursor] = useState(initial.nextCursor)
  const [loading, setLoading] = useState(false)
  // -1 until the keyboard is used, so nothing looks selected on touch devices.
  const [selected, setSelected] = useState(-1)

  // A fresh first page (after an action or a sync) replaces anything paged in.
  useEffect(() => {
    setExtra([])
    setCursor(initial.nextCursor)
  }, [initial])

  const threads = [...initial.threads, ...extra]

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const next = await listThreadsFn({ data: { ...scope, cursor } })
      setExtra((e) => [...e, ...next.threads])
      setCursor(next.nextCursor)
    } finally {
      setLoading(false)
    }
  }

  async function move(id: string, to: 'archive' | 'trash' | 'inbox') {
    await moveThreadFn({ data: { id, to } })
    await router.invalidate()
  }

  const current = threads[selected]
  useHotkeys({
    j: () => setSelected((i) => Math.min(i + 1, threads.length - 1)),
    k: () => setSelected((i) => Math.max(i - 1, 0)),
    Enter: () =>
      current &&
      void navigate({ to: '/thread/$id', params: { id: current.id } }),
    e: () =>
      current && scope.folder !== 'archive' && void move(current.id, 'archive'),
    '#': () =>
      current && scope.folder !== 'trash' && void move(current.id, 'trash'),
  })

  if (threads.length === 0) {
    return <p className="px-4 py-16 text-dim text-center">{empty}</p>
  }

  return (
    <div>
      <ul>
        {threads.map((t, i) => (
          <ThreadRow
            key={t.id}
            t={t}
            active={i === selected}
            folder={scope.folder}
            onMove={(to) => void move(t.id, to)}
          />
        ))}
      </ul>
      {cursor ? (
        <div className="p-4 text-center">
          <button
            className="btn px-4 py-2"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ThreadRow({
  t,
  active,
  folder,
  onMove,
}: {
  t: ThreadSummary
  active: boolean
  folder: Scope['folder']
  onMove: (to: 'archive' | 'trash' | 'inbox') => void
}) {
  const unread = t.unread > 0
  const who =
    t.direction === 'out' ? `To: ${t.to.join(', ') || '—'}` : senderLabel(t)
  return (
    <li className={`group row ${active ? 'row-active' : ''}`}>
      <Link
        to="/thread/$id"
        params={{ id: t.id }}
        className="block px-4 py-3 pr-3 md:pr-24"
      >
        <div className="flex items-baseline gap-2">
          <span
            aria-label={unread ? 'Unread' : undefined}
            className={`size-2 shrink-0 self-center rounded-full ${unread ? 'unread-dot' : ''}`}
          />
          <span
            className={`min-w-0 flex-1 truncate ${unread ? 'font-semibold' : ''}`}
          >
            {who}
          </span>
          {t.count > 1 ? (
            <span className="text-faint text-xs">{t.count}</span>
          ) : null}
          {t.hasAttachments ? (
            <PaperclipIcon
              aria-label="Has attachments"
              aria-hidden={false}
              role="img"
              className="text-faint shrink-0"
            />
          ) : null}
          <time
            className="shrink-0 text-faint text-xs"
            dateTime={new Date(t.lastAt).toISOString()}
            suppressHydrationWarning
          >
            {relativeTime(t.lastAt)}
          </time>
        </div>
        <div className={`truncate pl-4 text-sm ${unread ? 'font-medium' : ''}`}>
          {t.subject || '(no subject)'}
        </div>
        <div className="flex gap-2 text-dim pl-4 text-sm">
          <span className="min-w-0 flex-1 truncate">{t.snippet}</span>
          {t.direction === 'in' && t.receivedFor[0] ? (
            <span className="chip hidden shrink-0 sm:inline">
              → {t.receivedFor[0]}
            </span>
          ) : null}
        </div>
      </Link>
      <div className="absolute top-2 right-3 hidden gap-1 group-hover:flex md:group-focus-within:flex">
        {folder !== 'archive' && folder !== 'sent' ? (
          <button
            className="btn bg-panel px-2 py-1 text-xs"
            onClick={() => onMove('archive')}
          >
            Archive
          </button>
        ) : null}
        {folder === 'archive' || folder === 'trash' ? (
          <button
            className="btn bg-panel px-2 py-1 text-xs"
            onClick={() => onMove('inbox')}
          >
            Restore
          </button>
        ) : null}
        {folder !== 'trash' ? (
          <button
            className="btn bg-panel px-2 py-1 text-xs"
            onClick={() => onMove('trash')}
          >
            Trash
          </button>
        ) : null}
      </div>
    </li>
  )
}
