import { createIsomorphicFn } from '@tanstack/react-start'
import {
  Link,
  createRouter as createTanStackRouter,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-neon text-xl font-semibold">Not found</h1>
      <Link to="/" className="btn btn-primary mt-4">
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
      <h1 className="text-neon text-xl font-semibold">
        {expired ? 'Your session has expired' : 'Something went wrong'}
      </h1>
      <div className="mt-4 flex gap-3">
        {expired ? (
          <a href="/login" className="btn btn-primary">
            Sign in again
          </a>
        ) : (
          <button className="btn btn-primary" onClick={reset}>
            Try again
          </button>
        )}
      </div>
    </main>
  )
}

/** The request's CSP nonce on the server (set by the middleware in src/start.ts); none in the browser. */
const getNonce = createIsomorphicFn()
  .server(async () => (await import('#/server/security.server')).currentNonce())
  .client(() => undefined)

export function createAppRouter(nonce?: string) {
  const router = createTanStackRouter({
    routeTree,
    ssr: { nonce },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorView,
  })

  return router
}

/** Entry point used by TanStack Start for every request (and once in the browser). */
export async function getRouter() {
  return createAppRouter(await getNonce())
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
