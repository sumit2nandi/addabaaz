/* ADDABAAZ service worker — offline-capable app shell.
 * - App shell + JS/CSS: stale-while-revalidate (fast, self-updating)
 * - data/*.json:        network-first, falls back to cache when offline
 * - media/*:            cache-first (immutable artwork)
 * - YouTube thumbnails: stale-while-revalidate (opaque responses allowed)
 * - /api/*, /admin/*, YouTube player, analytics: never intercepted
 * Bump VERSION (or run `npm run build:www`, which stamps it) to force a refresh. */
const VERSION = 'v2.4.0';
const SHELL = `ab-shell-${VERSION}`, DATA = `ab-data-${VERSION}`, MEDIA = `ab-media-${VERSION}`, THUMBS = `ab-thumbs-${VERSION}`;
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'app/env.js', 'app/css/styles.css', 'app/js/main.js', 'app/js/app.js', 'app/js/config.js', 'app/js/util.js', 'app/js/icons.js',
  'app/js/router.js', 'app/js/platform.js', 'app/js/social.js', 'app/js/payments.js', 'app/js/data/catalog.js', 'app/js/data/api.js', 'app/js/data/adapters.js', 'app/js/data/user.js',
  'app/js/ui/shell.js', 'app/js/ui/components.js', 'app/js/ui/dialog.js', 'app/js/ui/lightbox.js', 'app/js/views/home.js', 'app/js/views/show.js', 'app/js/views/watch.js',
  'app/js/players/index.js', 'app/js/players/youtube.js', 'app/js/players/html5.js', 'data/catalog.json', 'data/studio.json', 'media/icons/icon-192.png', 'media/icons/logo-96.webp'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('ab-') && !k.endsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const swr = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = (await cache.match(req)) || (await caches.match(req));
  const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
};
const networkFirst = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
  catch { const hit = (await cache.match(req)) || (await caches.match(req)); if (hit) return hit; throw new Error('offline'); }
};
const cacheFirst = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = (await cache.match(req)) || (await caches.match(req)); if (hit) return hit;
  const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.includes('/api/') || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return;   // the admin console is never cached or shadowed by the app shell
    if (url.pathname.startsWith('/uploads/')) return e.respondWith(cacheFirst(req, MEDIA));   // admin uploads have content-hash names
    if (req.mode === 'navigate') return e.respondWith(networkFirst(new Request('./'), SHELL).catch(() => caches.match('./').then((r) => r || caches.match('index.html'))));
    if (url.pathname.includes('/data/')) return e.respondWith(networkFirst(req, DATA));
    if (url.pathname.includes('/media/')) return e.respondWith(cacheFirst(req, MEDIA));
    return e.respondWith(swr(req, SHELL));
  }
  if (/(^|\.)ytimg\.com$/.test(url.hostname) || url.hostname === 'img.youtube.com') return e.respondWith(swr(req, THUMBS));
  if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'cdnjs.cloudflare.com') return e.respondWith(swr(req, SHELL));
});
