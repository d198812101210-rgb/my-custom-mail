import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

type Listener = (event: Record<string, unknown>) => void

/** Just enough of Request for the worker: Node's own requires absolute URLs and has a read-only mode. */
class StubRequest {
  url: string
  mode: string
  constructor(url: string, init: { mode?: string } = {}) {
    this.url = new URL(url, 'https://x.test').href
    this.mode = init.mode ?? 'cors'
  }
}

/** Runs public/sw.js against a stubbed worker scope and records everything it does. */
function loadWorker(opts: { online: boolean }) {
  const listeners = new Map<string, Listener>()
  const stored = new Map<string, Response>()
  const cacheWrites: string[] = []
  const networkRequests: string[] = []
  let deletedCaches: string[] = []
  let claimed = false
  let skipped = false

  const cache = {
    add: (req: Request) => {
      cacheWrites.push(req.url)
      stored.set(req.url, new Response('<h1>offline page</h1>'))
      return Promise.resolve()
    },
    put: (req: Request) => {
      cacheWrites.push(`PUT ${req.url}`)
      return Promise.resolve()
    },
  }
  const shown: { title: string; options: Record<string, unknown> }[] = []
  const opened: string[] = []
  const posted: unknown[] = []
  let focused = 0
  let openWindows: {
    postMessage: (m: unknown) => void
    focus: () => unknown
  }[] = []
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options })
        return Promise.resolve()
      },
    },
    skipWaiting: () => {
      skipped = true
      return Promise.resolve()
    },
    clients: {
      claim: () => {
        claimed = true
        return Promise.resolve()
      },
      matchAll: () => Promise.resolve(openWindows),
      openWindow: (url: string) => {
        opened.push(url)
        return Promise.resolve()
      },
    },
  }
  const context = vm.createContext({
    self,
    Request: StubRequest,
    Response,
    caches: {
      open: () => Promise.resolve(cache),
      keys: () => Promise.resolve(['mailbox-offline-v1', 'old-cache']),
      delete: (k: string) => {
        deletedCaches.push(k)
        return Promise.resolve(true)
      },
      match: (url: string) =>
        Promise.resolve(stored.get(new URL(url, 'https://x.test').href)),
    },
    fetch: (req: Request) => {
      networkRequests.push(req.url)
      return opts.online
        ? Promise.resolve(new Response('live page'))
        : Promise.reject(new Error('offline'))
    },
  })
  vm.runInContext(readFileSync('public/sw.js', 'utf8'), context)

  const lifecycle = async (type: string) => {
    let work: Promise<unknown> = Promise.resolve()
    listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => (work = p) })
    await work
  }

  const fetchEvent = (url: string, mode: string) => {
    let responded: Promise<Response> | undefined
    listeners.get('fetch')?.({
      request: new StubRequest(url, { mode }),
      respondWith: (p: Promise<Response>) => (responded = p),
    })
    return responded
  }

  const pushEvent = async (data: unknown, raw?: string) => {
    let work: Promise<unknown> = Promise.resolve()
    listeners.get('push')?.({
      data: {
        json: () => {
          if (raw !== undefined) return JSON.parse(raw) as unknown
          return data
        },
      },
      waitUntil: (p: Promise<unknown>) => (work = p),
    })
    await work
  }

  const clickEvent = async (url: unknown, windows: 'none' | 'one') => {
    openWindows =
      windows === 'one'
        ? [
            {
              postMessage: (m) => posted.push(m),
              focus: () => focused++,
            },
          ]
        : []
    let work: Promise<unknown> = Promise.resolve()
    let closed = false
    listeners.get('notificationclick')?.({
      notification: { data: { url }, close: () => (closed = true) },
      waitUntil: (p: Promise<unknown>) => (work = p),
    })
    await work
    return closed
  }

  return {
    lifecycle,
    fetchEvent,
    pushEvent,
    clickEvent,
    shown,
    opened,
    posted,
    focusCount: () => focused,
    cacheWrites,
    networkRequests,
    state: () => ({ claimed, skipped, deletedCaches }),
    reset: () => {
      deletedCaches = []
    },
  }
}

describe('service worker', () => {
  it('on install caches only the offline page and activates immediately', async () => {
    const sw = loadWorker({ online: true })
    await sw.lifecycle('install')
    expect(sw.cacheWrites).toEqual(['https://x.test/offline.html'])
    expect(sw.state().skipped).toBe(true)
  })

  it('on activate claims clients and deletes stale caches', async () => {
    const sw = loadWorker({ online: true })
    await sw.lifecycle('activate')
    expect(sw.state().claimed).toBe(true)
    expect(sw.state().deletedCaches).toEqual(['old-cache'])
  })

  it.each([
    ['/_serverFn/abc', 'cors'],
    ['/api/attachments/123', 'no-cors'],
    ['/api/auth/verify', 'same-origin'],
    ['/assets/app.js', 'no-cors'],
    ['/inbox', 'cors'],
  ])('does not intercept non-navigation request %s', async (url, mode) => {
    const sw = loadWorker({ online: true })
    expect(sw.fetchEvent(url, mode)).toBeUndefined()
    expect(sw.networkRequests).toHaveLength(0) // the browser handles it; the worker never touches it
    expect(sw.cacheWrites).toHaveLength(0)
  })

  it('passes page loads through to the network and never stores them', async () => {
    const sw = loadWorker({ online: true })
    for (const url of ['/inbox', '/thread/abc', '/compose?mode=new']) {
      const res = await sw.fetchEvent(url, 'navigate')
      expect(await res?.text()).toBe('live page')
    }
    expect(sw.cacheWrites).toHaveLength(0)
  })

  it('shows the offline page, and only that, when a page load fails', async () => {
    const sw = loadWorker({ online: false })
    await sw.lifecycle('install')
    const res = await sw.fetchEvent('/thread/secret-thread', 'navigate')
    expect(await res?.text()).toContain('offline page')
    expect(sw.cacheWrites.every((w) => w.endsWith('/offline.html'))).toBe(true)
  })

  it('has no way to cache anything else', () => {
    const source = readFileSync('public/sw.js', 'utf8')
    expect(source).not.toMatch(/\.put\(|\.addAll\(/)
    expect((source.match(/\.add\(/g) ?? []).length).toBe(1)
  })
})

describe('web push', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000'

  it('shows a notification from the payload and caches nothing', async () => {
    const sw = loadWorker({ online: true })
    await sw.pushEvent({
      title: 'Ada',
      body: 'Lunch?',
      url: `/thread/${id}`,
      tag: id,
    })
    expect(sw.shown).toHaveLength(1)
    expect(sw.shown[0]?.title).toBe('Ada')
    expect(sw.shown[0]?.options).toMatchObject({
      body: 'Lunch?',
      tag: id,
      renotify: true,
      data: { url: `/thread/${id}` },
    })
    expect(sw.cacheWrites).toHaveLength(0)
    expect(sw.networkRequests).toHaveLength(0)
  })

  it('falls back to a generic notification for unreadable payloads', async () => {
    const sw = loadWorker({ online: true })
    await sw.pushEvent(undefined, 'not json')
    expect(sw.shown[0]?.title).toBe('New mail')
    expect(sw.shown[0]?.options).toMatchObject({ data: { url: '/inbox' } })
  })

  it.each([
    'https://evil.example/thread/x',
    '//evil.example',
    'javascript:alert(1)',
    '/api/attachments/1',
    '/thread/../x',
  ])('never links a notification to %s', async (url) => {
    const sw = loadWorker({ online: true })
    await sw.pushEvent({ title: 'x', body: 'y', url })
    expect(sw.shown[0]?.options).toMatchObject({ data: { url: '/inbox' } })
  })

  it('limits text length', async () => {
    const sw = loadWorker({ online: true })
    await sw.pushEvent({ title: 't'.repeat(500), body: 'b'.repeat(500) })
    expect(sw.shown[0]?.title).toHaveLength(100)
    expect((sw.shown[0]?.options.body as string).length).toBe(200)
  })

  it('on click, closes the notification and asks an open window to route to the thread', async () => {
    const sw = loadWorker({ online: true })
    const closed = await sw.clickEvent(`/thread/${id}`, 'one')
    expect(closed).toBe(true)
    expect(sw.posted).toEqual([{ type: 'open', url: `/thread/${id}` }])
    expect(sw.focusCount()).toBe(1)
    expect(sw.opened).toHaveLength(0)
  })

  it('on click without an open window, opens one at the thread', async () => {
    const sw = loadWorker({ online: true })
    await sw.clickEvent(`/thread/${id}`, 'none')
    expect(sw.opened).toEqual([`/thread/${id}`])
  })

  it('on click ignores a tampered link', async () => {
    const sw = loadWorker({ online: true })
    await sw.clickEvent('https://evil.example', 'none')
    expect(sw.opened).toEqual(['/inbox'])
  })
})

describe('web app manifest', () => {
  const manifest = JSON.parse(
    readFileSync('public/manifest.webmanifest', 'utf8'),
  ) as {
    scope: string
    start_url: string
    display: string
    icons: { src: string; sizes: string; purpose: string }[]
  }

  it('is scoped to the whole origin and standalone', () => {
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
  })

  it('has 192 and 512 icons plus a maskable one, all present on disk', () => {
    const sizes = manifest.icons.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
    for (const icon of manifest.icons) {
      expect(() => readFileSync(`public${icon.src}`)).not.toThrow()
    }
  })
})
