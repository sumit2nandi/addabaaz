// Pull-to-refresh in the native app must refresh WITHOUT a page reload: a reload replays the
// website's boot logo splash, which the app must never show on a refresh. main.js passes a soft
// refresh callback on native; the web keeps the plain reload.
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
  assert.equal(refreshes, 1, 'the native soft refresh ran');
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

test('the web path still reloads; main.js hands the soft refresh only to the native shell', () => {
  const ptr = fs.readFileSync(new URL('../../app/js/ui/ptr.js', import.meta.url), 'utf8');
  assert.match(ptr, /setTimeout\(\(\) => location\.reload\(\), 220\)/, 'web keeps the full reload');
  const main = fs.readFileSync(new URL('../../app/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /initPullToRefresh\(isNative \? softRefresh : null\)/, 'native gets the in-place refresh');
  assert.match(main, /app\.router\?\.resolve\(\)/, 'soft refresh re-renders the current screen');
});
