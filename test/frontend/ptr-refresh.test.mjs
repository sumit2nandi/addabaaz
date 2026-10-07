// A completed custom pull-to-refresh reloads the current page; its startup fetch must bypass caches
// so video changes saved in Admin are visible immediately. The browser-native gesture stays disabled.
// The reload is flagged as an in-app refresh so it must NOT replay the launch splash (splash = first launch only).
// Run: node --test test/frontend/ptr-refresh.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.document = document;
globalThis.window = window;
let reloads = 0;
globalThis.location = { reload: () => { reloads++; }, protocol: 'https:', href: 'https://t.in/', hash: '', search: '', pathname: '/' };
window.location = globalThis.location;
const store = {};
globalThis.sessionStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { initPullToRefresh } = await import('../../app/js/ui/ptr.js');
initPullToRefresh();

const touch = (type, y) => {
  const e = new window.Event(type, { cancelable: true });
  e.touches = y == null ? [] : [{ clientY: y }];
  document.dispatchEvent(e);
};
// PTR lets the indicator appear for 220 ms before calling location.reload().
const tick = () => new Promise((r) => setTimeout(r, 240));

test('pulling down past the threshold reloads the current page', async () => {
  const before = reloads;      // counts are per-gesture: the tests must not depend on run order
  touch('touchstart', 20);
  touch('touchmove', 140);          // dy = 120 > threshold 88
  touch('touchend');
  await tick();
  assert.equal(reloads - before, 1, 'the completed pull called location.reload()');
  assert.ok(document.getElementById('ptr'), 'the pull indicator is present while reload starts');
});

test('a completed pull flags the reload as an in-app refresh so the launch splash is not replayed', async () => {
  delete store['ab:refresh'];   // the previous test's reload: refresh-flag.js consumed its flag
  assert.equal(store['ab:refresh'], undefined, 'no flag before the gesture');
  const before = reloads;
  touch('touchstart', 20);
  touch('touchmove', 140);          // dy = 120 > threshold 88
  touch('touchend');
  await tick();
  assert.equal(reloads - before, 1);
  assert.equal(store['ab:refresh'], '1', 'the flag is planted before the reload so the reloading page skips the splash');
});

test('the refresh flag swaps the launch splash for the compact loader (and applies to one reload only)', () => {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="app\/refresh-flag\.js"><\/script>/, 'the flag reader loads from <head> (before first paint)');
  const flag = fs.readFileSync(new URL('../../app/refresh-flag.js', import.meta.url), 'utf8');
  assert.match(flag, /sessionStorage\.getItem\('ab:refresh'\) === '1'/, 'it reads the flag ptr.js plants');
  assert.match(flag, /sessionStorage\.removeItem\('ab:refresh'\)/, 'it consumes the flag so the next genuine launch shows the splash again');
  assert.match(flag, /classList\.add\('ab-refresh'\)/, 'it marks the document before the first paint');

  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /html\.ab-refresh #boot \.boot-native \{ display: none; \}/, 'the full splash artwork is hidden on a refresh reload');
  assert.match(css, /html\.ab-refresh #boot \.boot-web \{ display: grid; \}/, '…and the compact loader takes its place');
  assert.ok(css.indexOf('html.ab-refresh #boot .boot-native') > css.indexOf('html[data-platform="android"] #boot .boot-native'),
    'the ab-refresh rules stay after the data-platform rules so they win the specificity tie');
});

test('a short pull does nothing', async () => {
  const before = reloads;
  touch('touchstart', 20);
  touch('touchmove', 60);           // dy = 40 < 88
  touch('touchend');
  await tick();
  assert.equal(reloads - before, 0);
});

test('a wobbling finger still completes the pull once the gesture engaged', async () => {
  const before = reloads;
  touch('touchstart', 20);
  touch('touchmove', 150);          // engage: dy = 130
  touch('touchmove', 26);           // finger wobbles back up to dy = 6 — the gesture is still ours
  touch('touchmove', 140);          // and pulls again: dy = 120 > threshold
  touch('touchend');
  await tick();
  assert.equal(reloads - before, 1, 'the pull completed instead of being eaten by native overscroll');
});

test('the system taking the gesture (touchcancel) never reloads the page', async () => {
  const before = reloads;
  touch('touchstart', 20);
  touch('touchmove', 160);          // well past the threshold…
  touch('touchcancel');             // …but the OS cancelled the gesture (scroll takeover, call, notification)
  await tick();
  assert.equal(reloads - before, 0, 'a cancelled gesture is not a completed pull');
});

test('no pull-to-refresh while a video is playing', async () => {
  const box = document.createElement('div');
  box.className = 'player-box is-playing';
  document.body.appendChild(box);
  const before = reloads;
  touch('touchstart', 20);
  touch('touchmove', 160);
  touch('touchend');
  await tick();
  assert.equal(reloads - before, 0, 'the gesture was refused while media plays');
  box.classList.remove('is-playing');
  touch('touchstart', 20);
  touch('touchmove', 160);
  touch('touchend');
  await tick();
  assert.equal(reloads - before, 1, 'a paused/stopped player lets the refresh through again');
});

test('all app platforms use the reload gesture, while the browser-native PTR stays disabled', () => {
  const main = fs.readFileSync(new URL('../../app/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /initPullToRefresh\(\)/, 'the app installs the reload gesture on all platforms');
  assert.doesNotMatch(main, /softRefresh|rerender: true/, 'there is no longer an in-place refresh path');

  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /html \{[^}]*overscroll-behavior-y: contain/, 'the browser PTR is disabled on html');
  assert.match(css, /body \{[^}]*overscroll-behavior-y: contain/, 'and on body - browsers differ on which element they check');

  const ptr = fs.readFileSync(new URL('../../app/js/ui/ptr.js', import.meta.url), 'utf8');
  assert.match(ptr, /setTimeout\(\(\) => location\.reload\(\), 220\)/, 'a completed pull triggers a full reload');
  assert.match(ptr, /player-box\.is-playing/, 'the gesture is refused while a video plays');
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
