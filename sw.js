/* sw.js — minimal cache-first service worker for the app shell.
 *
 * Pre-caches the offline app shell on install, then serves those assets
 * cache-first (falling back to the network for anything not yet cached).
 * Bump CACHE_NAME when the shell changes to refresh the cache.
 */
const CACHE_NAME = 'scholarship-shell-v2';

// App shell — everything needed to boot and run offline.
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './data.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached; // cache-first

      // Not in cache: fetch from the network and store a copy for offline use.
      return fetch(event.request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
