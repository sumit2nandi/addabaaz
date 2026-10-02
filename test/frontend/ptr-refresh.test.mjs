// Pull-to-refresh must refresh WITHOUT a page reload - in the app and in mobile browsers: a reload
// replays the website's boot logo splash, which must never appear on a refresh. main.js therefore
// always hands the soft (in-place) refresh to the PTR module, and styles.css turns OFF the
// browser's own pull-to-refresh (overscroll-behavior-y: contain), which would reload the page.
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

const { initPullToRefresh } = await import('../../app/js/ui/ptr.js');

let refreshes = 0;
initPullToRefresh(async () => { refreshes++; });

const touch = (type, y) => {
  const e = new window.Event(type, { cancelable: true });
  e.touches = y == null ? [] : [{ clientY: y }];
  document.dispatchEvent(e);
};
const tick = () => new Promise((r) => setTimeout(r, 10));

test('pulling down past the threshold soft-refreshes in place: no page reload, no boot logo', async () => {
  touch('touchstart', 20);
  touch('touchmove', 140);          // dy = 120 > threshold 88
  touch('touchend');
  await tick();
  assert.equal(refreshes, 1, 'the soft refresh ran');
  assert.equal(reloads, 0, 'location.reload() was NOT called (it would flash the website boot logo)');
  assert.ok(document.getElementById('ptr'), 'the small pull indicator exists instead');
});

test('a short pull does nothing', async () => {
  touch('touchstart', 20);
  touch('touchmove', 60);           // dy = 40 < 88
  touch('touchend');
  await tick();
  assert.equal(refreshes, 1);
  assert.equal(reloads, 0);
});

test('every platform gets the in-place refresh; the browser\'s own reloading PTR is turned off', () => {
  const main = fs.readFileSync(new URL('../../app/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /initPullToRefresh\(softRefresh\)/, 'the soft refresh is handed in unconditionally (app AND mobile browsers)');
  assert.doesNotMatch(main, /initPullToRefresh\(isNative/, 'the web must not be sent down the reload path');
  assert.match(main, /app\.router\?\.resolve\(\)/, 'soft refresh re-renders the current screen');
  assert.match(main, /never a reload, so never the boot logo/);

  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /html \{[^}]*overscroll-behavior-y: contain/, 'the browser PTR (which reloads and shows the boot logo) is disabled on html');
  assert.match(css, /body \{[^}]*overscroll-behavior-y: contain/, 'and on body - browsers differ on which element they check');

  const ptr = fs.readFileSync(new URL('../../app/js/ui/ptr.js', import.meta.url), 'utf8');
  assert.match(ptr, /setTimeout\(\(\) => location\.reload\(\), 220\)/, 'the reload fallback exists only for a callback-less caller');
});
