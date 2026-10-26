import { useState } from 'react'
import { PaperclipIcon } from '#/components/icons'
import { MailFrame } from '#/components/MailFrame'
import { formatBytes, fullDate } from '#/lib/format'
import type { getThreadFn } from '#/server/threads.fn'

export type ThreadMessage = NonNullable<
  Awaited<ReturnType<typeof getThreadFn>>
>['messages'][number]

const small =
  'rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'

export function MessageCard({
  m,
  defaultOpen,
  onUnread,
  onMove,
}: {
  m: ThreadMessage
  defaultOpen: boolean
  onUnread: () => void
  onMove: (to: 'archive' | 'trash' | 'inbox') => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [loadImages, setLoadImages] = useState(false)
  const sender = m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress

  return (
    <article
      className="rounded-lg border border-neutral-200 dark:border-neutral-800"
      aria-label={`Message from ${m.fromName ?? m.fromAddress}`}
    >
      <button
        className="flex w-full items-start gap-3 px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm ${m.isRead ? '' : 'font-semibold'}`}
          >
            {m.direction === 'out' ? 'Me' : (m.fromName ?? m.fromAddress)}
          </span>
          {open ? (
            <span className="block text-xs break-words text-neutral-500">
              {sender}
              <br />
              To: {m.to.join(', ') || '—'}
              {m.cc.length > 0 ? <> · Cc: {m.cc.join(', ')}</> : null}
            </span>
          ) : null}
        </span>
        <time
          className="shrink-0 text-xs text-neutral-500"
          dateTime={new Date(m.date).toISOString()}
        >
          {fullDate(m.date)}
        </time>
      </button>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        {m.direction === 'in' && m.receivedFor.length > 0 ? (
          <span className="rounded bg-neutral-100 px-1.5 text-xs leading-5 dark:bg-neutral-800">
            Sent to {m.receivedFor.join(', ')}
          </span>
        ) : null}
        {m.authFailures.length > 0 ? (
          <span
            role="alert"
            className="rounded bg-amber-100 px-1.5 text-xs leading-5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
            title="The sender could not be verified. Be careful with links and attachments."
          >
            ⚠ Failed sender checks: {m.authFailures.join(', ')}
          </span>
        ) : null}
        {m.folder === 'trash' ? (
          <span className="rounded bg-neutral-200 px-1.5 text-xs leading-5 dark:bg-neutral-700">
            In trash
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-3 px-3 pb-3">
          {m.body.hasRemoteContent && !loadImages ? (
            <div className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
              Remote images are blocked.
              <button className={small} onClick={() => setLoadImages(true)}>
                Load images
              </button>
            </div>
          ) : null}

          <MailFrame html={m.body.html} loadImages={loadImages} />

          {m.attachments.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Attachments">
              {m.attachments.map((a) => (
                <li key={a.id}>
                  <a
                    href={`/api/attachments/${a.id}`}
                    className="flex items-center gap-2 rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    <PaperclipIcon />{' '}
                    <span className="max-w-48 truncate">{a.filename}</span>
                    <span className="text-xs text-neutral-500">
                      {formatBytes(a.size)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button className={small} onClick={onUnread}>
              Mark unread
            </button>
            {m.folder === 'inbox' ? (
              <button className={small} onClick={() => onMove('archive')}>
                Archive
              </button>
            ) : null}
            {m.folder === 'archive' || m.folder === 'trash' ? (
              <button className={small} onClick={() => onMove('inbox')}>
                Restore
              </button>
            ) : null}
            {m.folder !== 'trash' ? (
              <button className={small} onClick={() => onMove('trash')}>
                Trash
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}
