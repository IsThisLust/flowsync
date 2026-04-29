/**
 * FlowSync Service Worker
 * Caches app shell for offline access.
 * Keeps it simple — cache-first for assets, network-first for pages.
 */

const CACHE_NAME = 'flowsync-v11';
const SHELL_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './tasks.html',
  './pomodoro.html',
  './report.html',
  './ipr.html',
  './signup.html',
  './waitlist.html',
  './js/store.js',
  './manifest.json',
];
const EXTERNAL_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
];

// Install — cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS).then(() =>
        Promise.all(
          EXTERNAL_ASSETS.map(asset =>
            fetch(asset, { mode: 'no-cors' })
              .then(res => {
                if (res.ok || res.type === 'opaque') return cache.put(asset, res);
              })
              .catch(() => {})
          )
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first for HTML, cache first for everything else
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  const isDocument = event.request.mode === 'navigate'
    || event.request.headers.get('accept')?.includes('text/html');

  // HTML pages — network first, fallback to cache
  if (isDocument) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // Everything else — Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networked = fetch(event.request)
        .then(res => {
          if (res.ok || res.type === 'opaque') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networked;
    })
  );
});
