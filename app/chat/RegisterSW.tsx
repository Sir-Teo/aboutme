'use client'

import { useEffect } from 'react'

// Register the playground service worker (scope /chat) so the app shell works
// offline after the first visit. Scoped to /chat to leave the homepage alone.
export default function RegisterSW() {
    useEffect(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
        const host = window.location.hostname
        const isLocal = host === 'localhost' || host === '127.0.0.1'

        // On localhost, dev rebuilds reuse chunk filenames, so a cache-first SW
        // serves stale modules → hydration mismatches. Actively tear down any SW
        // that was registered before this guard existed, and clear its caches.
        if (isLocal) {
            navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()))
            if (window.caches) caches.keys().then(keys => keys.forEach(k => caches.delete(k)))
            return
        }

        navigator.serviceWorker.register('/sw.js', { scope: '/chat' }).catch(() => {
            /* offline support is best-effort */
        })
    }, [])
    return null
}
