import { createFileRoute } from '@tanstack/react-router'
import { logout, logoutEverywhere } from '#/server/auth.fn'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  async function signOut(everywhere: boolean) {
    await (everywhere ? logoutEverywhere() : logout())
    window.location.assign('/login')
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Mailbox</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">Signed in.</p>
      <div className="mt-6 flex gap-3">
        <button className="rounded-lg border px-3 py-2" onClick={() => signOut(false)}>
          Log out
        </button>
        <button className="rounded-lg border px-3 py-2" onClick={() => signOut(true)}>
          Log out everywhere
        </button>
      </div>
    </main>
  )
}
