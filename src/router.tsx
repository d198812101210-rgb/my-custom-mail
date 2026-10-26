import {
  Link,
  createRouter as createTanStackRouter,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-xl font-semibold">Not found</h1>
      <Link to="/" className="mt-4 inline-block underline">
        Back to inbox
      </Link>
    </main>
  )
}

function ErrorView({ error, reset }: ErrorComponentProps) {
  // The message is only inspected, never rendered: it can carry server details.
  const expired =
    error instanceof Error && /401|unauthorized/i.test(error.message)
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-xl font-semibold">
        {expired ? 'Your session has expired' : 'Something went wrong'}
      </h1>
      <div className="mt-4 flex gap-3">
        {expired ? (
          <a href="/login" className="underline">
            Sign in again
          </a>
        ) : (
          <button className="underline" onClick={reset}>
            Try again
          </button>
        )}
      </div>
    </main>
  )
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorView,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
