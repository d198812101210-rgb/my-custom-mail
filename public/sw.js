/*
 * Minimal service worker. Its only jobs are to make the app installable and to show an
 * offline page when a page load fails.
 *
 * It deliberately caches NOTHING else. Mail pages, server-function calls, API responses and
 * attachments are authenticated and private, so every request except a failed navigation goes
 * straight to the network and is never stored. The only cached item is the public, static
 * /offline.html.
 *
 * It also shows Web Push notifications for new mail. The payload only carries sender, subject
 * and a same-origin link; nothing is fetched or stored when one arrives.
 *
 * Lives in public/ (not under /_build/) so its scope is the whole origin.
 */
const CACHE = 'mailbox-offline-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // Not a page load: do not intercept, so nothing is cached and the browser behaves normally.
  if (request.mode !== 'navigate') return

  event.respondWith(
    fetch(request).catch(
      async () => (await caches.match(OFFLINE_URL)) ?? Response.error(),
    ),
  )
})

const THREAD_URL = /^\/thread\/[0-9a-f-]{36}$/

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
  const url =
    typeof data.url === 'string' &&
    (THREAD_URL.test(data.url) || data.url === '/inbox')
      ? data.url
      : '/inbox'
  const tag = text(data.tag, 64)

  event.waitUntil(
    self.registration.showNotification(text(data.title, 100) || 'New mail', {
      body: text(data.body, 200),
      icon: '/icons/icon-192.png',
      data: { url },
      ...(tag ? { tag, renotify: true } : {}),
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url
  const path =
    typeof url === 'string' && (THREAD_URL.test(url) || url === '/inbox')
      ? url
      : '/inbox'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((w) => 'focus' in w)
        if (!open) return self.clients.openWindow(path)
        // Let the page route client-side: a full navigation would throw away an unsent draft.
        open.postMessage({ type: 'open', url: path })
        return open.focus()
      }),
  )
})
