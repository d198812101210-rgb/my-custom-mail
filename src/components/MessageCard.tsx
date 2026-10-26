import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { PaperclipIcon } from '#/components/icons'
import { MailFrame } from '#/components/MailFrame'
import { formatBytes, fullDate } from '#/lib/format'
import type { getThreadFn } from '#/server/threads.fn'

export type ThreadMessage = NonNullable<
  Awaited<ReturnType<typeof getThreadFn>>
>['messages'][number]

const small = 'btn px-2 py-1 text-xs'

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
      className="border-line bg-panel/80 rounded-xl border shadow-[0_8px_40px_-20px_rgb(176_75_255/0.5)]"
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
            <span className="block text-xs break-words text-faint">
              {sender}
              <br />
              To: {m.to.join(', ') || '—'}
              {m.cc.length > 0 ? <> · Cc: {m.cc.join(', ')}</> : null}
            </span>
          ) : null}
        </span>
        <time
          className="shrink-0 text-xs text-faint"
          dateTime={new Date(m.date).toISOString()}
        >
          {fullDate(m.date)}
        </time>
      </button>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        {m.direction === 'in' && m.receivedFor.length > 0 ? (
          <span className="chip">Sent to {m.receivedFor.join(', ')}</span>
        ) : null}
        {m.authFailures.length > 0 ? (
          <span
            role="alert"
            className="chip-warn"
            title="The sender could not be verified. Be careful with links and attachments."
          >
            ⚠ Failed sender checks: {m.authFailures.join(', ')}
          </span>
        ) : null}
        {m.folder === 'trash' ? <span className="chip">In trash</span> : null}
      </div>

      {open ? (
        <div className="space-y-3 px-3 pb-3">
          {m.body.hasRemoteContent && !loadImages ? (
            <div className="flex items-center gap-2 text-dim text-xs">
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
                    className="btn px-2 py-1"
                  >
                    <PaperclipIcon />{' '}
                    <span className="max-w-48 truncate">{a.filename}</span>
                    <span className="text-xs text-faint">
                      {formatBytes(a.size)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Link
              to="/compose"
              search={{ mode: 'reply', src: m.id }}
              className={small}
            >
              Reply
            </Link>
            <Link
              to="/compose"
              search={{ mode: 'replyAll', src: m.id }}
              className={small}
            >
              Reply all
            </Link>
            <Link
              to="/compose"
              search={{ mode: 'forward', src: m.id }}
              className={small}
            >
              Forward
            </Link>
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
