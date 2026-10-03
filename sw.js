/* ADDABAAZ service worker — offline-capable app shell.
 * - App shell + JS/CSS: stale-while-revalidate (fast, self-updating)
 * - data/*.json:        network-first, falls back to cache when offline
 * - media/*:            cache-first (immutable artwork)
 * - YouTube thumbnails: stale-while-revalidate (opaque responses allowed)
 * - /api/*, /admin/*, YouTube player, analytics: never intercepted
 * The admin console can also invalidate every client's cache on demand (bump `client_cache_version` via
 * POST /api/v1/admin/cache/purge): this worker checks GET /api/v1/client-version on activation and on every
 * message, and throws away its caches when the number it stored is stale.
 * Bump VERSION (or run `npm run build:www`, which stamps it) to force a refresh. */
const VERSION = 'v2.11.0';   // promotional credit & referrals (checkout, Account → Refer & earn, Admin → Promotions)
// One cache per kind of content, all tagged with the version so old caches are deleted when the version changes.
const SHELL = `ab-shell-${VERSION}`, DATA = `ab-data-${VERSION}`, MEDIA = `ab-media-${VERSION}`, THUMBS = `ab-thumbs-${VERSION}`;
// Files downloaded at install so the app shell opens offline. A missing file is skipped rather than failing the install.
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'app/env.js', 'app/css/styles.css', 'app/js/main.js', 'app/js/app.js', 'app/js/config.js', 'app/js/util.js', 'app/js/icons.js',
  'app/js/router.js', 'app/js/mode.js', 'app/js/routes.js', 'app/js/seo/meta.js', 'app/js/seo/head.js', 'app/js/platform.js', 'app/js/social.js', 'app/js/payments.js', 'app/js/consent.js', 'app/js/errors.js', 'app/js/push.js', 'app/js/push-native.js', 'app/js/client-version.js', 'app/js/notify-prompt.js', 'app/js/legal-text.js', 'app/js/data/catalog.js', 'app/js/data/api.js', 'app/js/data/adapters.js', 'app/js/data/user.js',
  'app/js/ui/shell.js', 'app/js/ui/components.js', 'app/js/ui/dialog.js', 'app/js/ui/lightbox.js', 'app/js/ui/parental.js', 'app/js/views/engage.js', 'app/js/views/home.js', 'app/js/views/show.js', 'app/js/views/watch.js',
  'app/js/players/index.js', 'app/js/players/youtube.js', 'app/js/players/html5.js', 'data/catalog.json', 'data/studio.json', 'media/icons/icon-192.png', 'media/icons/logo-96.webp'];
// The service worker keeps the client-cache generation in its own meta cache (the page keeps a copy in
// localStorage), so a purge survives even when the worker is restarted between visits.
const META = 'ab-meta';
const META_URL = '/__client-version';

// Install: pre-cache the shell.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
// Activate: delete caches from older versions, then check whether an admin asked for a client-wide purge.
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('ab-') && !k.endsWith(VERSION)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => syncClientVersion()));
});

/* ---------- client cache invalidation (admin "Clear client caches" button) ---------- */
// Deletes every `ab-*` cache (scope 'assets'), or every cache of this origin (scope 'all').
async function purgeCaches(scope) {
  const keys = await caches.keys();
  const doomed = scope === 'all' ? keys.filter((k) => k !== META) : keys.filter((k) => k.startsWith('ab-') && k !== META);
  const done = await Promise.all(doomed.map((k) => caches.delete(k).catch(() => false)));
  return done.some(Boolean);
}
// Compares the generation the server advertises with the one stored here. Returns true when it purged.
async function syncClientVersion() {
  let version = '', scope = 'assets';
  try {
    const res = await fetch('/api/v1/client-version', { cache: 'no-store' });
    if (res.ok) { const data = await res.json(); version = String(data?.version ?? '').trim(); scope = data?.scope === 'all' ? 'all' : 'assets'; }
    else return false;
  } catch { return false; }                        // offline: keep what we have
  if (!version) return false;
  const cache = await caches.open(META);
  const known = await cache.match(META_URL);
  const stored = known ? (await known.json().catch(() => null)) : null;
  if (stored && stored.version === version) return false;
  let purged = false;
  if (stored) purged = await purgeCaches(scope);
  await cache.put(META_URL, new Response(JSON.stringify({ version, scope }), { headers: { 'Content-Type': 'application/json' } }));
  if (purged) {
    // Let every open page know: it shows "restart to load the latest version" instead of silently running old code.
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach((c) => c.postMessage({ type: 'ab:purged', scope, version }));
  }
  return purged;
}
self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'ab:check-version' || msg.type === 'ab:purge') e.waitUntil(syncClientVersion().then((did) => {
    const reply = { type: 'ab:version-checked', purged: !!did };
    if (msg.type === 'ab:purge' && msg.scope) return purgeCaches(msg.scope === 'all' ? 'all' : 'assets').then((p) => { reply.purged = p || reply.purged; e.source?.postMessage?.(reply); });
    e.source?.postMessage?.(reply);
  }));
});

// Caching strategies. stale-while-revalidate: answer from cache immediately, refresh the cache from the network in the background.
const swr = (req, cacheName, event) => {
  // Start the refresh while looking up the cached response, and keep the service worker alive until
  // the network response has actually replaced it. Without waitUntil(), iOS can stop the worker
  // as soon as it returns the stale hit, so CSS/JS updates may never reach an installed web app.
  const cachePromise = caches.open(cacheName);
  const network = cachePromise.then((cache) => fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) return cache.put(req, res.clone()).catch(() => {}).then(() => res);
    return res;
  }));
  event.waitUntil(network.catch(() => {}));
  return cachePromise.then(async (cache) => {
    const hit = (await cache.match(req)) || (await caches.match(req));
    return hit || network;
  });
};
// network-first: try the network, use the cached copy only when offline (catalog data should be fresh).
const networkFirst = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
  catch { const hit = (await cache.match(req)) || (await caches.match(req)); if (hit) return hit; throw new Error('offline'); }
};
// cache-first: use the cache, go to the network only on a miss (artwork never changes).
const cacheFirst = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = (await cache.match(req)) || (await caches.match(req)); if (hit) return hit;
  const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res;
};

// Routing: decide, per request, which strategy applies (or leave the request alone).
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // The management consoles (/admin/ and the Content studio /content/) are never cached or shadowed by
    // the app shell — they must always come from the server, where their strict CSP and no-store apply.
    if (url.pathname.includes('/api/') || ['/admin', '/content'].some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return;
    if (url.pathname.startsWith('/uploads/')) return e.respondWith(cacheFirst(req, MEDIA));   // admin uploads have content-hash names
    // Pages: ask the server for the real URL (it answers /show/x with that page's HTML and the right status); offline → the cached app shell.
    if (req.mode === 'navigate') return e.respondWith(fetch(req).catch(() => caches.match('./').then((r) => r || caches.match('index.html'))));
    if (url.pathname.includes('/data/')) return e.respondWith(networkFirst(req, DATA));
    if (url.pathname.includes('/media/')) return e.respondWith(cacheFirst(req, MEDIA));
    return e.respondWith(swr(req, SHELL, e));
  }
  if (/(^|\.)ytimg\.com$/.test(url.hostname) || url.hostname === 'img.youtube.com') return e.respondWith(swr(req, THUMBS, e));
  if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'cdnjs.cloudflare.com') return e.respondWith(swr(req, SHELL, e));
});

/* ---------- Web Push ---------- */
// Push: show a notification when the server sends one.
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ADDABAAZ', {
    body: d.body || '', icon: 'media/icons/icon-192.png', badge: 'media/icons/icon-96.png', image: d.image || undefined,
    tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/' },
  }));
});
// Click: focus an open tab of the site and go to the notification's link, or open a new tab.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (new URL(c.url).origin === new URL(target).origin && 'focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
