// Service worker for the /playground route — offline support, deploy-safe.
//
// Strategy is intentionally conservative so a new deploy is never masked by a
// stale cache:
//   • Navigations (HTML): network-first, falling back to cache only when offline.
//   • Hashed build assets (/_next/static/**): cache-first — they're immutable
//     (content-hashed filenames), so this is safe forever.
//   • Everything else (incl. huge model weights from the HF CDN): left to the
//     browser/IndexedDB cache that Transformers.js already manages.

const CACHE = 'teo-playground-v2'

self.addEventListener('install', event => {
    // No precache — runtime caching populates the shell on first visit. Avoids a
    // failed install if the export serves /chat under a slightly different path.
    self.skipWaiting()
})

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    )
    self.clients.claim()
})

self.addEventListener('fetch', event => {
    const { request } = event
    if (request.method !== 'GET') return
    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return // never touch cross-origin (model CDN, etc.)

    // Immutable hashed assets: cache-first.
    if (url.pathname.startsWith('/_next/static/')) {
        event.respondWith(
            caches.match(request).then(
                hit =>
                    hit ||
                    fetch(request).then(res => {
                        const copy = res.clone()
                        caches.open(CACHE).then(c => c.put(request, copy))
                        return res
                    })
            )
        )
        return
    }

    // Navigations: network-first so deploys are picked up immediately; fall back
    // to the cached shell when offline.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(res => {
                    const copy = res.clone()
                    caches.open(CACHE).then(c => c.put(request, copy))
                    return res
                })
                .catch(() => caches.match(request).then(hit => hit || caches.match('/playground')))
        )
    }
})
