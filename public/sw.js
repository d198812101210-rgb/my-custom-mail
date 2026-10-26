/*
 * Minimal service worker. Its only jobs are to make the app installable and to show an
 * offline page when a page load fails.
 *
 * It deliberately caches NOTHING else. Mail pages, server-function calls, API responses and
 * attachments are authenticated and private, so every request except a failed navigation goes
 * straight to the network and is never stored. The only cached item is the public, static
 * /offline.html.
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
