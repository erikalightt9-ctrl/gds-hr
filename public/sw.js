// Service worker for the installable GDS HR app.
// Privacy rule: HR data is never cached. Only a small offline screen and its assets are stored,
// and every request goes to the network first so staff always see current records.
const CACHE = 'gds-hr-shell-v1';
const OFFLINE_ASSETS = ['/offline.html', '/style.css', '/theme.css', '/icons/icon-192.png'];

self.addEventListener('install', event => {
  // If storage is unavailable (full or restricted), install anyway; only the offline screen is lost.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(OFFLINE_ASSETS)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/offline.html')) || new Response('You are offline. Reconnect and try again.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
    return;
  }
  if (OFFLINE_ASSETS.includes(new URL(request.url).pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
  }
  // Everything else, including all /api requests, goes straight to the network and is never stored.
});
