import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Mailbox</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Scaffold is running.
      </p>
    </main>
  )
}
