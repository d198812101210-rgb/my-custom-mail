import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useRef, useState } from 'react'
import {
  LogoutIcon,
  MailIcon,
  PencilIcon,
  RefreshIcon,
} from '#/components/icons'
import { useHotkeys } from '#/lib/hotkeys'
import { useOnline } from '#/lib/online'
import { logout, logoutEverywhere } from '#/server/auth.fn'
import { syncMail } from '#/server/mail.fn'
import { unreadCountsFn } from '#/server/threads.fn'

export const Route = createFileRoute('/_app')({
  loader: () => unreadCountsFn(),
  component: AppLayout,
})

const FOLDERS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'archive', label: 'Archive' },
  { id: 'sent', label: 'Sent' },
  { id: 'trash', label: 'Trash' },
] as const

function FolderNav({ vertical }: { vertical?: boolean }) {
  const counts = Route.useLoaderData()
  return (
    <nav
      aria-label="Folders"
      className={
        vertical ? 'flex flex-col gap-1' : 'flex gap-1 overflow-x-auto'
      }
    >
      {FOLDERS.map((f) => (
        <Link
          key={f.id}
          to="/$folder"
          params={{ folder: f.id }}
          className="nav-link"
        >
          {f.label}
          {counts[f.id] > 0 && f.id !== 'trash' ? (
            <span className="badge">{counts[f.id]}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}

function AppLayout() {
  const router = useRouter()
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const online = useOnline()
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useHotkeys({
    '/': () => searchRef.current?.focus(),
    c: () => void navigate({ to: '/compose', search: { mode: 'new' } }),
    'g i': () => void navigate({ to: '/$folder', params: { folder: 'inbox' } }),
    'g a': () =>
      void navigate({ to: '/$folder', params: { folder: 'archive' } }),
    'g s': () => void navigate({ to: '/$folder', params: { folder: 'sent' } }),
    'g t': () => void navigate({ to: '/$folder', params: { folder: 'trash' } }),
  })

  async function sync(full: boolean) {
    setSyncing(true)
    setNote(null)
    try {
      const r = await syncMail({ data: { full } })
      setNote(
        r.failed > 0
          ? `Imported ${r.imported}, ${r.failed} failed`
          : r.imported > 0
            ? `Imported ${r.imported} new`
            : 'Up to date',
      )
      await router.invalidate()
    } catch {
      setNote('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function signOut(everywhere: boolean) {
    await (everywhere ? logoutEverywhere() : logout())
    window.location.assign('/login')
  }

  const btn = 'btn'

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14rem_1fr]">
      <aside className="hidden border-r border-line bg-panel/60 p-3 backdrop-blur md:flex md:flex-col md:gap-4">
        <h1 className="flex items-center gap-2.5 px-3 pt-1 text-lg font-semibold">
          <span className="bg-neon glow grid size-8 place-items-center rounded-lg text-white">
            <MailIcon width={18} height={18} />
          </span>
          <span className="text-neon">Mailbox</span>
        </h1>
        <Link
          to="/compose"
          search={{ mode: 'new' }}
          className="btn btn-primary py-2"
        >
          Compose
        </Link>
        <FolderNav vertical />
        <div className="mt-auto flex flex-col gap-2">
          <button
            className={btn}
            disabled={syncing}
            onClick={() => void sync(false)}
          >
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
          <button
            className={btn}
            disabled={syncing}
            onClick={() => void sync(true)}
          >
            Full sync
          </button>
          <button className={btn} onClick={() => void signOut(false)}>
            Log out
          </button>
          <button className={btn} onClick={() => void signOut(true)}>
            Log out everywhere
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="border-line bg-ink/80 sticky top-0 z-10 flex flex-col gap-2 border-b px-3 py-2 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <h1 className="text-neon text-lg font-semibold md:hidden">
              Mailbox
            </h1>
            <form
              className="min-w-0 flex-1"
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                const q = new FormData(e.currentTarget).get('q')
                if (typeof q === 'string' && q.trim()) {
                  void navigate({ to: '/search', search: { q: q.trim() } })
                }
              }}
            >
              <input
                ref={searchRef}
                name="q"
                type="search"
                placeholder="Search mail  ( / )"
                aria-label="Search mail"
                maxLength={200}
                className="field"
              />
            </form>
            <Link
              to="/compose"
              search={{ mode: 'new' }}
              className={`${btn} md:hidden`}
              aria-label="Compose"
            >
              <PencilIcon />
            </Link>
            <button
              className={`${btn} md:hidden`}
              disabled={syncing}
              onClick={() => void sync(false)}
              aria-label="Sync"
            >
              <RefreshIcon className={syncing ? 'animate-spin' : ''} />
            </button>
            <button
              className={`${btn} md:hidden`}
              onClick={() => void signOut(false)}
              aria-label="Log out"
            >
              <LogoutIcon />
            </button>
          </div>
          <div className="md:hidden">
            <FolderNav />
          </div>
          {!online ? (
            <p role="status" className="chip-warn px-2 py-1">
              You're offline. Mail will load again when the connection returns.
            </p>
          ) : null}
          {note ? (
            <p role="status" className="text-dim text-xs">
              {note}
            </p>
          ) : null}
        </header>
        <Outlet />
      </div>
    </div>
  )
}
