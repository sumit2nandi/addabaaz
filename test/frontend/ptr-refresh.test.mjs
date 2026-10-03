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

test('a wobbling finger still completes the pull once the gesture engaged', async () => {
  touch('touchstart', 20);
  touch('touchmove', 150);          // engage: dy = 130
  touch('touchmove', 26);           // finger wobbles back up to dy = 6 — the gesture is still ours
  touch('touchmove', 140);          // and pulls again: dy = 120 > threshold
  touch('touchend');
  await tick();
  assert.equal(refreshes, 2, 'the pull completed instead of being eaten by native overscroll');
});

test('the system taking the gesture (touchcancel) never fires a refresh', async () => {
  touch('touchstart', 20);
  touch('touchmove', 160);          // well past the threshold…
  touch('touchcancel');             // …but the OS cancelled the gesture (scroll takeover, call, notification)
  await tick();
  assert.equal(refreshes, 2, 'a cancelled gesture is not a completed pull');
  assert.equal(reloads, 0);
});

test('no pull-to-refresh while a video is playing (it would restart the episode mid-watch)', async () => {
  const box = document.createElement('div');
  box.className = 'player-box is-playing';
  document.body.appendChild(box);
  touch('touchstart', 20);
  touch('touchmove', 160);
  touch('touchend');
  await tick();
  assert.equal(refreshes, 2, 'the gesture was refused while media plays');
  box.classList.remove('is-playing');
  touch('touchstart', 20);
  touch('touchmove', 160);
  touch('touchend');
  await tick();
  assert.equal(refreshes, 3, 'a paused/stopped player lets the refresh through again');
});

test('every platform gets the in-place refresh; the browser\'s own reloading PTR is turned off', () => {
  const main = fs.readFileSync(new URL('../../app/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /initPullToRefresh\(softRefresh\)/, 'the soft refresh is handed in unconditionally (app AND mobile browsers)');
  assert.doesNotMatch(main, /initPullToRefresh\(isNative/, 'the web must not be sent down the reload path');
  assert.match(main, /app\.router\?\.resolve\(\{ rerender: true \}\)/, 'soft refresh re-renders the current screen in place');
  assert.match(main, /never a reload, so never the boot logo/);

  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /html \{[^}]*overscroll-behavior-y: contain/, 'the browser PTR (which reloads and shows the boot logo) is disabled on html');
  assert.match(css, /body \{[^}]*overscroll-behavior-y: contain/, 'and on body - browsers differ on which element they check');

  const ptr = fs.readFileSync(new URL('../../app/js/ui/ptr.js', import.meta.url), 'utf8');
  assert.match(ptr, /setTimeout\(\(\) => location\.reload\(\), 220\)/, 'the reload fallback exists only for a callback-less caller');
  assert.match(ptr, /player-box\.is-playing/, 'the gesture is refused while a video plays');

  // A soft refresh is a re-draw, NOT navigation: it must leave the router's depth/scroll
  // bookkeeping alone, or Back goes wrong after every pull-to-refresh.
  const router = fs.readFileSync(new URL('../../app/js/router.js', import.meta.url), 'utf8');
  assert.match(router, /resolve\(\{ rerender = false \} = \{\}\)/, 'resolve() takes an explicit re-render mode');
  assert.match(router, /if \(rerender\) restore = true;/, 'the re-render keeps the viewer where they are');
  assert.match(router, /jumpScroll\(rerender \? keepY/, 'and preserves their scroll position');
  assert.match(router, /if \(rerender\) restore = true;[\s\S]{0,160}?else \{[\s\S]{0,400}?this\.#depth = this\.#fresh/,
    'the __navDepth bookkeeping runs only in the non-rerender branch — a soft refresh never changes navigation depth');
});
