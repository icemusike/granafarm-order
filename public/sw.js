/*
 * Service worker GranaFarm, cache ușor pentru instalarea ca aplicație (PWA).
 *
 * Reguli:
 *   - API-ul, panoul /admin (inclusiv admin.js) și paginile private
 *     (urmărire, livrare) NU se pun niciodată în cache.
 *   - resursele statice publice (imagini, CSS, JS magazin) folosesc
 *     cache-first, cu completare din rețea.
 *   - paginile HTML publice folosesc network-first, cu fallback din cache
 *     doar offline.
 */

const CACHE = 'granafarm-v4';
const PRECACHE = [
  '/',
  '/catalog.html',
  '/style.css',
  '/app.js',
  '/logo.png',
  '/favicon.png',
  '/manifest.webmanifest',
];

function isAdminAsset(pathname) {
  return pathname === '/admin'
    || pathname.startsWith('/admin/')
    || pathname === '/admin.html'
    || pathname === '/admin.js'
    || pathname === '/manifest-admin.webmanifest';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // niciodată în cache: API, admin, urmărire comandă, pagina șoferului
  if (url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/track/')
    || url.pathname.startsWith('/delivery/')
    || isAdminAsset(url.pathname)) return;

  const isStatic = /\.(png|webp|jpg|jpeg|svg|ico|css|js|woff2?)$/.test(url.pathname)
    || url.pathname.endsWith('.webmanifest');

  if (isStatic && !url.pathname.endsWith('/sw.js')) {
    // cache-first pentru resursele statice publice
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
    return;
  }

  // network-first pentru pagini publice
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request))
  );
});
