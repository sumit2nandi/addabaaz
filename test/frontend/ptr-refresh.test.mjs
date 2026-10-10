// Pull-to-refresh refreshes the page IN PLACE.
//
// A reload re-runs app start-up, so the WebView painted the launch screen again (the brand-red splash)
// and the page the viewer was looking at vanished while the catalog came down. A completed pull now
// asks the app for a soft refresh (main.js `softRefresh` → `router.refresh()`): the catalog is re-read
// with cache-busting (Admin edits show up immediately) and the current page is redrawn from it. No
// reload → no launch screen, no blank frame, same URL, same history/back depth, same reading position.
//
// `softRefresh` reports what happened, and the gesture acts on it: 'refreshed' (done), 'stale' (nothing
// could be read — the page is kept, the toast has already explained why) and 'restart' (the app is not
// on the live catalog, so a fresh start is the only way — main.js only asks for that once the API
// answers again).
//
// `location.reload()` survives as the last-resort fallback (no soft refresh in the running bundle, it
// threw, or the app needs the restart). Even that reload is flagged (sessionStorage `ab:refresh`, read
// by app/refresh-flag.js) so it cannot replay the launch artwork either.
//
// The browser-native pull-to-refresh gesture stays disabled; this custom gesture is the only one.
// Run: node --test test/frontend/ptr-refresh.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

/* ---------- DOM harness ---------- */
// #boot sits inside #view exactly as in index.html: the launch screen the viewer must never see again
// during a refresh, and the node a reload would put back on screen.
const { document, window } = parseHTML('<!doctype html><html><head></head><body><main id="view"><div id="boot" class="boot"></div></main><div id="announcer"></div><div id="toasts"></div></body></html>');
globalThis.document = document;
globalThis.window = window;
window.matchMedia = () => ({ matches: false });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
let reloads = 0;
globalThis.location = { reload: () => { reloads++; }, protocol: 'https:', origin: 'https://t.in', href: 'https://t.in/#/', hash: '#/', search: '', pathname: '/' };
window.location = globalThis.location;
globalThis.localStorage = window.localStorage ?? { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.sessionStorage ?? { getItem: () => null, setItem() {}, removeItem() {} };
// linkedom has no session history: the router touches scrollRestoration/pushState/replaceState.
globalThis.history = window.history ?? { scrollRestoration: 'auto', length: 1, state: null, pushState() {}, replaceState() {}, back() {} };
window.history = globalThis.history;
const scrolls = [];
window.scrollTo = (x, y) => scrolls.push(typeof x === 'object' ? { ...x } : { top: y });
Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
globalThis.scrollTo = window.scrollTo;

const store = {};
globalThis.sessionStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { app } = await import('../../app/js/app.js');
const { initPullToRefresh } = await import('../../app/js/ui/ptr.js');
initPullToRefresh();

const touch = (type, y) => {
  const e = new window.Event(type, { cancelable: true });
  e.touches = y == null ? [] : [{ clientY: y }];
  document.dispatchEvent(e);
};
// Like `touch` above, but with a real clientX too, for the horizontal-vs-vertical tests below.
const touchXY = (type, x, y) => {
  const e = new window.Event(type, { cancelable: true });
  e.touches = y == null ? [] : [{ clientX: x, clientY: y }];
  document.dispatchEvent(e);
  return e;
};
// A completed pull spins the indicator while it refreshes, and holds it for a beat (MIN_SPIN) so the
// gesture feels acknowledged even when the data lands instantly.
const settle = () => new Promise((r) => setTimeout(r, 520));
const pull = async () => { touch('touchstart', 20); touch('touchmove', 140); touch('touchend'); await settle(); };

/* ---------- the gesture ---------- */
test('a completed pull refreshes the app in place — no reload, so no launch screen', async () => {
  const before = reloads;
  const calls = [];
  app.softRefresh = async () => { calls.push('refresh'); return 'refreshed'; };
  await pull();
  assert.deepEqual(calls, ['refresh'], 'the pull asked the app for a soft refresh');
  assert.equal(reloads - before, 0, 'the document was never reloaded — there is no launch screen to replay');
  assert.equal(document.getElementById('ptr').classList.contains('on'), false, 'and the indicator is put away when it is done');
});

test('the indicator stays up while the refresh is running', async () => {
  let resolveRefresh;
  app.softRefresh = () => new Promise((resolve) => { resolveRefresh = resolve; });
  touch('touchstart', 20);
  touch('touchmove', 140);
  touch('touchend');
  await new Promise((r) => setTimeout(r, 60));
  const indicator = document.getElementById('ptr');
  assert.ok(indicator.classList.contains('on'), 'the spinner is visible while the catalog is being re-read');
  assert.equal(indicator.style.transform, 'translateY(0px)', 'held at the top of the screen');
  resolveRefresh('refreshed');
  await settle();
  assert.equal(indicator.classList.contains('on'), false, 'and slides away once the page has been refreshed');
});

test('a refresh that could not complete leaves the page alone instead of reloading it', async () => {
  const before = reloads;
  app.softRefresh = async () => 'stale';      // offline: softRefresh already told the viewer why
  await pull();
  assert.equal(reloads - before, 0, 'no reload: the page the viewer is looking at is not thrown away for nothing');
  assert.equal(document.getElementById('ptr').classList.contains('on'), false, 'the indicator still goes away');
});

test('an app that never reached the API reloads: a fresh start is the only way back onto the live catalog', async () => {
  const before = reloads;
  delete store['ab:refresh'];
  app.softRefresh = async () => 'restart';    // main.js: the app is running off its bundled catalog
  await pull();
  assert.equal(reloads - before, 1, 'the pull restarts the app, which re-probes the API and re-reads the catalog');
  assert.equal(store['ab:refresh'], '1', 'flagged like the other fallbacks, so no launch artwork is replayed');
});

test('without an in-place refresh the pull falls back to a flagged reload (never the launch artwork)', async () => {
  const before = reloads;
  delete store['ab:refresh'];               // the previous test consumed it (refresh-flag.js does that on load)
  app.softRefresh = null;
  await pull();
  assert.equal(reloads - before, 1, 'a bundle with no soft refresh still refreshes — by reloading');
  assert.equal(store['ab:refresh'], '1', 'the reload is flagged so it skips the splash');
});

test('a soft refresh that throws also falls back to the flagged reload', async () => {
  const before = reloads;
  delete store['ab:refresh'];
  app.softRefresh = async () => { throw new Error('boom'); };
  await pull();
  assert.equal(reloads - before, 1, 'an unexpected failure still ends in a fresh document');
  assert.equal(store['ab:refresh'], '1', 'flagged, so even that reload shows the compact loader');
  app.softRefresh = async () => 'refreshed';
});

test('a short pull does nothing', async () => {
  const before = reloads;
  const calls = [];
  app.softRefresh = async () => { calls.push('refresh'); return 'refreshed'; };
  touch('touchstart', 20);
  touch('touchmove', 60);           // dy = 40 < 88
  touch('touchend');
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(reloads - before, 0);
});

test('a wobbling finger still completes the pull once the gesture engaged', async () => {
  const calls = [];
  app.softRefresh = async () => { calls.push('refresh'); return 'refreshed'; };
  touch('touchstart', 20);
  touch('touchmove', 150);          // engage: dy = 130
  touch('touchmove', 26);           // finger wobbles back up to dy = 6 — the gesture is still ours
  touch('touchmove', 140);          // and pulls again: dy = 120 > threshold
  touch('touchend');
  await settle();
  assert.deepEqual(calls, ['refresh'], 'the pull completed instead of being eaten by native overscroll');
});

test('the system taking the gesture (touchcancel) never refreshes', async () => {
  const before = reloads;
  const calls = [];
  app.softRefresh = async () => { calls.push('refresh'); return 'refreshed'; };
  touch('touchstart', 20);
  touch('touchmove', 160);          // well past the threshold…
  touch('touchcancel');             // …but the OS cancelled the gesture (scroll takeover, call, notification)
  await settle();
  assert.equal(calls.length, 0, 'a cancelled gesture is not a completed pull');
  assert.equal(reloads - before, 0);
});

test('no pull-to-refresh while a video is playing', async () => {
  const box = document.createElement('div');
  box.className = 'player-box is-playing';
  document.body.appendChild(box);
  const before = reloads;
  const calls = [];
  app.softRefresh = async () => { calls.push('refresh'); return 'refreshed'; };
  touch('touchstart', 20);
  touch('touchmove', 160);
  touch('touchend');
  await settle();
  assert.equal(calls.length, 0, 'the gesture was refused while media plays');
  box.classList.remove('is-playing');
  touch('touchstart', 20);
  touch('touchmove', 160);
  touch('touchend');
  await settle();
  assert.equal(calls.length, 1, 'a paused/stopped player lets the refresh through again');
  assert.equal(reloads - before, 0);
});

// Regression: whichever side calls preventDefault() first on a touch sequence wins the gesture. The
// gesture used to wait until the indicator was about to appear (dy > 4, with nothing prevented before
// that) to claim it — long enough, on some devices/browsers, for their own native pull-to-refresh to
// already have committed to running instead, so the same pull sometimes soft-refreshed and sometimes
// fell through to a real page reload. It must now be claimed on the very first touchmove that reads as
// a downward pull, not deferred any further.
test('a vertical pull is claimed (preventDefault) on its first qualifying move, not deferred until the indicator shows', () => {
  app.softRefresh = async () => 'refreshed';
  touchXY('touchstart', 100, 20);
  const first = touchXY('touchmove', 100, 30);   // dy = 10, dx = 0: unmistakably a downward pull
  assert.equal(first.defaultPrevented, true, 'claimed immediately — no window where the browser could win the race');
  touchXY('touchend');
});

test('a horizontal swipe (rails/carousels) at the top of the page is handed back to the browser untouched', async () => {
  const calls = [];
  app.softRefresh = async () => { calls.push('refresh'); return 'refreshed'; };
  touchXY('touchstart', 100, 20);
  const horizontal = touchXY('touchmove', 180, 24);   // dx = 80, dy = 4: clearly horizontal
  assert.equal(horizontal.defaultPrevented, false, 'a horizontal swipe is never captured');
  const later = touchXY('touchmove', 260, 140);       // even if the same gesture later drifts well downward
  assert.equal(later.defaultPrevented, false, 'once handed back, the rest of that gesture is left alone too');
  touchXY('touchend');
  await settle();
  assert.equal(calls.length, 0, 'and it never turns into a refresh');
});

test('all app platforms use the gesture, while the browser-native PTR stays disabled', () => {
  const main = fs.readFileSync(new URL('../../app/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /initPullToRefresh\(\)/, 'the app installs the refresh gesture on all platforms');

  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /html \{[^}]*overscroll-behavior-y: contain/, 'the browser PTR is disabled on html');
  assert.match(css, /body \{[^}]*overscroll-behavior-y: contain/, 'and on body - browsers differ on which element they check');

  const ptr = fs.readFileSync(new URL('../../app/js/ui/ptr.js', import.meta.url), 'utf8');
  assert.match(ptr, /app\?\.softRefresh/, 'the pull asks the app for the in-place refresh first');
  assert.match(ptr, /player-box\.is-playing/, 'the gesture is refused while a video plays');
  // location.reload() lives in the fallback helper only — never in the normal refresh path.
  const fn = (name) => ptr.slice(ptr.indexOf(`async function ${name}(`), ptr.indexOf('\n}', ptr.indexOf(`async function ${name}(`)));
  const fallback = fn('reloadForRefresh');
  assert.match(fallback, /setItem\('ab:refresh', '1'\)[\s\S]*?location\.reload\(\)/, 'the fallback plants the refresh flag, then reloads');
  assert.doesNotMatch(fn('refresh'), /location\.reload\(\)/, 'the normal path never reloads the document directly');
  assert.match(fn('refresh'), /if \(result === 'restart'\) return reloadForRefresh\(since\);/, "only 'restart' (a bundle that cannot reach the live catalog) asks for the reload fallback");
});

/* ---------- the in-place refresh itself ---------- */
test('softRefresh re-reads the catalog (cache-busting) and redraws the current page without navigating', () => {
  const main = fs.readFileSync(new URL('../../app/js/main.js', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('export async function softRefresh'), main.indexOf('// The first-run "turn on notifications"'));
  assert.match(body, /loadCatalog\(catalogSource\.url, undefined, \{ mediaBase: catalogSource\.mediaBase \}\)/,
    'the same source as start-up is read again — and loadCatalog asks for it with cache: "no-store", so Admin edits are not served from a cache');
  assert.match(body, /app\.fullCatalog = catalog;\s*\n\s*app\.catalog = catalog;\s*\n\s*applyKids\(\);/,
    'the same hand-off as start-up, so a Kids profile re-derives its filtered catalog from the fresh one (never a stale one)');
  assert.match(body, /app\.studio = null;/, 'the cached studio profile is dropped so About/Contact re-read it, like a reload would');
  assert.match(body, /await app\.router\.refresh\(\)/, 'the page on screen is redrawn from the new data');
  assert.match(body, /const stale = \(message\) => \{ toast\(message\); return 'stale'; \};/,
    'a refresh that cannot complete keeps the page and says so');
  assert.match(body, /return stale\(friendly\(err/, 'the catalog fetch failure reports the real reason');
  assert.match(body, /if \(!app\.api\) \{\s*\n\s*if \(navigator\.onLine === false\) return stale\(/,
    "with no API the catalog being re-read is the app's own bundled copy, so a restart is asked for instead");
  assert.match(body, /const reachable = await detectApi\(CONFIG\.apiBase\);\s*\n\s*return reachable \? 'restart' : stale\(/,
    'and only once the API answers again — a restart must actually get somewhere (cold starts, flaky launches)');
  assert.doesNotMatch(body, /location\.reload\(\)/, 'softRefresh never reloads the document itself');
  assert.match(main, /app\.softRefresh = softRefresh;/, 'the router app exposes it to the gesture');

  const router = fs.readFileSync(new URL('../../app/js/router.js', import.meta.url), 'utf8');
  assert.match(router, /refresh\(\) \{ return this\.resolve\(\{ refresh: true \}\)/, 'router.refresh() is the in-place redraw');
  assert.match(router, /const holdScroll = refresh \? window\.scrollY : null;/, 'a refresh keeps the reading position');
  assert.match(router, /jumpScroll\(refresh \? holdScroll/, 'and puts the viewer back where they were');
  // A refresh must not go through the history bookkeeping (depth/scroll map): it is not a navigation.
  const resolveBody = router.slice(router.indexOf('async resolve('), router.indexOf('const token = ++this.#token'));
  assert.match(resolveBody, /if \(refresh\) restore = false;\s*\n\s*else \{[\s\S]*?window\.__navDepth = this\.#depth;/, 'the back-button depth is only touched by a real navigation');

  const appSrc = fs.readFileSync(new URL('../../app/js/app.js', import.meta.url), 'utf8');
  assert.match(appSrc, /softRefresh: null/, 'the shared app object declares it, so the gesture can check for it');
});

test('a refresh reload (fallback) shows the compact loader on the app background — never the launch canvas', () => {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="app\/refresh-flag\.js"><\/script>/, 'the flag reader loads from <head> (before first paint)');
  const flag = fs.readFileSync(new URL('../../app/refresh-flag.js', import.meta.url), 'utf8');
  assert.match(flag, /sessionStorage\.getItem\('ab:refresh'\) === '1'/, 'it reads the flag ptr.js plants');
  assert.match(flag, /sessionStorage\.removeItem\('ab:refresh'\)/, 'it consumes the flag so the next genuine launch shows the splash again');
  assert.match(flag, /classList\.add\('ab-refresh'\)/, 'it marks the document before the first paint');

  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /html\.ab-refresh #boot \{ background: var\(--bg\)/, 'the brand-red launch canvas is NOT repainted on a refresh');
  assert.match(css, /html\.ab-refresh #boot \.boot-native \{ display: none; \}/, 'the full splash artwork is hidden');
  assert.match(css, /html\.ab-refresh #boot \.boot-web \{ display: grid; \}/, '…and the compact loader takes its place');
  assert.ok(css.indexOf('html.ab-refresh #boot .boot-native') > css.indexOf('html[data-platform="android"] #boot .boot-native'),
    'the ab-refresh rules stay after the data-platform rules so they win the specificity tie');
});

test('the catalog loader bypasses browser HTTP caches on startup after reload', async () => {
  const { loadCatalog } = await import('../../app/js/data/catalog.js');
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, async json() { return { shows: [], videos: [] }; } };
  };
  try {
    await loadCatalog('/api/v1/catalog');
    assert.deepEqual(requests, [{ url: '/api/v1/catalog', options: { cache: 'no-store' } }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ---------- router.refresh(): the page on screen is redrawn, and nothing else moves ---------- */
test('router.refresh() redraws the current page from the new catalog, keeping URL, history depth and scroll', async () => {
  const { Catalog } = await import('../../app/js/data/catalog.js');
  const { Router } = await import('../../app/js/router.js');
  const seed = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));

  app.catalog = new Catalog(seed);
  app.studio = null;
  app.user = { lib: { progress: {}, list: [], reminders: [] }, inList: () => false, hasReminder: () => false, fraction: () => 0 };
  globalThis.location.hash = '#/search?q=shahid';

  const root = document.getElementById('view');
  const router = new Router(root, { onRoute: () => { document.getElementById('boot')?.remove(); document.body.classList.add('booted'); } });
  router.start();
  await new Promise((r) => setTimeout(r, 60));

  const before = root.querySelector('.search-page');
  assert.ok(before, 'the search page rendered from the catalog');
  const hits = before.querySelectorAll('a.card').length;
  assert.ok(hits > 0, 'the seeded catalog has results for "shahid"');
  assert.equal(document.getElementById('boot'), null, 'start-up removed the launch screen (`booted`)');
  const depth = window.__navDepth;

  // The server-side catalog changed (an admin re-titled or removed the title) and the viewer pulls down.
  app.catalog = new Catalog({ shows: [], videos: [], upcoming: [], gallery: [], homePosters: {} });
  window.scrollY = 620;                       // a refresh must not throw the viewer back to the top
  scrolls.length = 0;
  const reloadsBefore = reloads;
  await router.refresh();

  const after = root.querySelector('.search-page');
  assert.ok(after, 'the page is redrawn (still the search page — the URL did not change)');
  assert.notEqual(after, before, 'a fresh page, like a reload would give — but without reloading');
  assert.equal(after.querySelectorAll('a.card').length, 0, 'the new catalog is what is on screen now');
  assert.match(after.textContent, /No results for “shahid”/, 'the empty state comes from the fresh data');
  assert.equal(reloads, reloadsBefore, 'no document reload happened: the launch screen can never come back');
  assert.equal(document.getElementById('boot'), null, 'so the launch screen is still gone after the refresh');
  assert.equal(globalThis.location.hash, '#/search?q=shahid', 'the URL is untouched');
  assert.equal(window.__navDepth, depth, 'a refresh is not a navigation: the back-button depth is untouched');
  assert.equal(window.history.scrollRestoration, 'manual', 'the router still owns scroll restoration');
  assert.equal(scrolls[scrolls.length - 1]?.top, 620, 'the viewer stays exactly where they were reading');
});
