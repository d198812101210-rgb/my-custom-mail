import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PaperclipIcon } from '#/components/icons'
import { formatBytes } from '#/lib/format'
import { createUploadUrlFn, sendMailFn } from '#/server/compose.fn'
import type { prepareDraftFn } from '#/server/compose.fn'

export type Draft = Awaited<ReturnType<typeof prepareDraftFn>>

type Upload = {
  key: string
  name: string
  size: number
  type: string
  status: 'uploading' | 'done' | 'error'
  path?: string
}

/** Resend allows 40 MB per email after base64 encoding, i.e. about 30 MB of files. */
const MAX_TOTAL_BYTES = 30 * 1024 * 1024

/** Pulls addresses out of free text, with or without display names. */
export function parseRecipients(text: string): string[] {
  return [...new Set(text.match(/[^\s,;<>"']+@[^\s,;<>"']+/g) ?? [])]
}

const ERRORS: Record<string, string> = {
  no_recipients: 'Add at least one recipient.',
  too_many_recipients: 'Too many recipients (50 at most per field).',
  invalid_upload:
    'An attachment could not be read. Remove it and add it again.',
  source_not_found: 'The message you are answering no longer exists.',
  too_large: 'Attachments are too large (40 MB limit after encoding).',
  send_failed: 'The mail provider rejected the message. Nothing was sent.',
  sent_but_not_saved:
    'The message was sent, but saving it failed. Press Send again to finish; it will not be sent twice.',
}

const input = 'field'
const label = 'text-dim w-12 shrink-0 pt-2 text-sm'
const btn = 'btn'

export function Composer({ initial }: { initial: Draft }) {
  // Snapshot: the loader may re-run (e.g. after a sync) and must not reset the form.
  const [draft] = useState(initial)
  const navigate = useNavigate()
  const [to, setTo] = useState(draft.to.join(', '))
  const [cc, setCc] = useState(draft.cc.join(', '))
  const [bcc, setBcc] = useState('')
  const [showCc, setShowCc] = useState(draft.cc.length > 0)
  const [subject, setSubject] = useState(draft.subject)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Upload[]>([])
  const [keep, setKeep] = useState(
    () => new Set(draft.forwardable.map((f) => f.id)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const sent = useRef(false)

  const dirty = text.trim() !== '' || files.length > 0
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty && !sent.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const patch = (key: string, change: Partial<Upload>) =>
    setFiles((all) => all.map((f) => (f.key === key ? { ...f, ...change } : f)))

  async function addFiles(list: FileList | null) {
    if (!list) return
    for (const file of Array.from(list)) {
      const key = crypto.randomUUID()
      const used = files.reduce((n, f) => n + f.size, 0)
      const entry: Upload = {
        key,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        status: 'uploading',
      }
      setFiles((all) => [...all, entry])
      if (used + file.size > MAX_TOTAL_BYTES) {
        patch(key, { status: 'error' })
        setError(
          `Attachments are limited to ${formatBytes(MAX_TOTAL_BYTES)} in total.`,
        )
        continue
      }
      try {
        const { path, signedUrl } = await createUploadUrlFn({
          data: {
            draftId: draft.draftId,
            filename: file.name,
            size: file.size,
          },
        })
        // Straight to Storage: the app's own request size limit never applies.
        const res = await fetch(signedUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'content-type': entry.type,
            'cache-control': 'max-age=3600',
            'x-upsert': 'false',
          },
        })
        if (!res.ok) throw new Error('upload failed')
        patch(key, { status: 'done', path })
      } catch {
        patch(key, { status: 'error' })
        setError(`Could not upload ${file.name}.`)
      }
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const uploading = files.some((f) => f.status === 'uploading')
  const recipients = parseRecipients(to)

  async function send() {
    if (busy || uploading) return
    setBusy(true)
    setError(null)
    try {
      const done = files.filter((f) => f.status === 'done' && f.path)
      const res = await sendMailFn({
        data: {
          draftId: draft.draftId,
          mode: draft.mode,
          sourceMessageId: draft.sourceMessageId ?? undefined,
          to: recipients,
          cc: parseRecipients(cc),
          bcc: parseRecipients(bcc),
          subject,
          text,
          uploads: done.map((f) => ({
            path: f.path ?? '',
            filename: f.name,
            contentType: f.type,
          })),
          forwardAttachmentIds: [...keep],
        },
      })
      if (res.ok) {
        sent.current = true
        await navigate({ to: '/thread/$id', params: { id: res.threadId } })
      } else {
        setError(ERRORS[res.error] ?? 'Could not send.')
      }
    } catch {
      setError('Check the addresses and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="mx-auto w-full max-w-3xl space-y-3 px-3 py-4"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <h2 className="text-xl font-semibold">
        {draft.mode === 'forward'
          ? 'Forward'
          : draft.mode === 'new'
            ? 'New message'
            : 'Reply'}
      </h2>

      <div className="flex gap-2">
        <label htmlFor="to" className={label}>
          To
        </label>
        <input
          id="to"
          className={input}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          autoComplete="off"
          inputMode="email"
          autoFocus={draft.mode === 'new' || draft.mode === 'forward'}
        />
        {!showCc ? (
          <button type="button" className={btn} onClick={() => setShowCc(true)}>
            Cc/Bcc
          </button>
        ) : null}
      </div>
      {showCc ? (
        <>
          <div className="flex gap-2">
            <label htmlFor="cc" className={label}>
              Cc
            </label>
            <input
              id="cc"
              className={input}
              value={cc}
              onChange={(e) => setCc(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <label htmlFor="bcc" className={label}>
              Bcc
            </label>
            <input
              id="bcc"
              className={input}
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
            />
          </div>
        </>
      ) : null}
      <div className="flex gap-2">
        <label htmlFor="subject" className={label}>
          Subject
        </label>
        <input
          id="subject"
          className={input}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={998}
        />
      </div>

      <textarea
        aria-label="Message"
        className={`${input} min-h-56 font-sans`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void send()
          }
        }}
        autoFocus={draft.mode === 'reply' || draft.mode === 'replyAll'}
      />

      {draft.quote ? (
        <details className="text-dim text-sm">
          <summary className="cursor-pointer">
            {draft.mode === 'forward' ? 'Forwarded message' : 'Quoted message'}{' '}
            (added automatically)
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto border-line bg-panel/70 rounded-lg border p-2 text-xs whitespace-pre-wrap">
            {draft.quote}
          </pre>
        </details>
      ) : null}

      {draft.forwardable.length > 0 ? (
        <fieldset className="space-y-1 text-sm">
          <legend className="text-faint">Attachments of the original</legend>
          {draft.forwardable.map((f) => (
            <label key={f.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={keep.has(f.id)}
                onChange={(e) =>
                  setKeep((s) => {
                    const next = new Set(s)
                    if (e.target.checked) next.add(f.id)
                    else next.delete(f.id)
                    return next
                  })
                }
              />
              {f.filename}{' '}
              <span className="text-faint">{formatBytes(f.size)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Attachments">
          {files.map((f) => (
            <li key={f.key} className="btn px-2 py-1">
              <PaperclipIcon />
              <span className="max-w-48 truncate">{f.name}</span>
              <span className="text-xs text-faint">
                {f.status === 'uploading'
                  ? 'uploading…'
                  : f.status === 'error'
                    ? 'failed'
                    : formatBytes(f.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="text-faint hover:text-fg"
                onClick={() =>
                  setFiles((all) => all.filter((x) => x.key !== f.key))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-[#ff8da0]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary px-5 py-2"
          disabled={busy || uploading || recipients.length === 0}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => fileInput.current?.click()}
        >
          Attach files
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => void addFiles(e.target.files)}
        />
        <button
          type="button"
          className={btn}
          onClick={() => window.history.back()}
          disabled={busy}
        >
          Cancel
        </button>
        <span className="text-xs text-faint">Ctrl/⌘ + Enter to send</span>
      </div>
    </form>
  )
}
