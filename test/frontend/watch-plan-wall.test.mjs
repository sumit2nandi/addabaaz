// A signed-in viewer WITHOUT an active plan must always be offered the subscribe path on the
// premium lock wall - in the browser AND in the Android app (the app used to show only
// "Back to home", leaving no way to subscribe). Plan holders never see the wall (gateFor 'ok').
// Run:  node --test test/frontend/watch-plan-wall.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';
import { parseHTML } from 'linkedom';

const { document, window, Element } = parseHTML('<!doctype html><html><head></head><body><main id="view"></main><div id="toasts"></div></body></html>');
globalThis.window = window; globalThis.document = document;
globalThis.location = { protocol: 'https:', origin: 'https://t.in', pathname: '/', hash: '', href: 'https://t.in/', search: '' };
window.location = globalThis.location;
globalThis.localStorage = window.localStorage ?? { getItem: () => null, setItem: () => {} };
globalThis.fetch = globalThis.fetch || (async () => { throw new Error('offline'); });
window.fetch = globalThis.fetch;
Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

// The Android shell: the wall must offer "See plans" HERE too (that was the bug).
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
const { isNative } = await import('../../app/js/platform.js');
assert.equal(isNative, true, 'this test runs as the native app');

register(new URL('./watch-mock-loader.mjs', import.meta.url));
const { Catalog } = await import('../../app/js/data/catalog.js');
const { app } = await import('../../app/js/app.js');
const watch = (await import('../../app/js/views/watch.js')).default;

const PREMIUM_VIDEO = { id: 'vp', kind: 'episode', episode: 1, title: 'Premium episode', showId: 's1', duration: 100, views: 1, publishedAt: '2026-09-01T00:00:00Z', access: 'premium', poster: 'media/premium-vp.webp', source: { type: 'r2', key: 'premium/x.mp4' } };
app.catalog = app.fullCatalog = new Catalog({ schema: 1, updatedAt: '', shows: [{ id: 's1', title: 'Show', titleEn: 'Show', genres: [], cast: [], type: 'series', poster: 'media/shows/s1.webp' }], videos: [PREMIUM_VIDEO], upcoming: [], gallery: [] });
// Signed in, no active plan => gateFor says 'plan'.
app.user = {
  remote: null, account: { id: 'u1', email: 's@x.in' }, profiles: [{ id: 'p1', name: 'S' }], profile: { id: 'p1', name: 'S' }, activeId: 'p1',
  supportsAuth: true, isPremium: false, isKids: false,
  gateFor: () => 'plan', progressOf: () => null, isFinished: () => false, pref: () => true, setPref: () => {},
  saveProgress: () => {}, fraction: () => 0, inList: () => false, hasReminder: () => false, on: () => {}, needsProfileChoice: () => false,
};

test('the native lock wall offers the subscribe path, not just "Back to home"', async () => {
  const root = document.createElement('div');
  document.getElementById('view').appendChild(root);
  const ctx = { root, params: { id: 'vp' }, query: {}, path: '/watch/vp', setTitle: () => {}, onCleanup: () => {} };
  await watch(ctx);
  await new Promise((r) => setTimeout(r, 20));
  const wall = root.querySelector('#playerMsg');
  assert.ok(wall, 'the lock wall is shown');
  assert.match(wall.textContent, /ADDABAAZ premium exclusive/);
  assert.equal(wall.querySelector('.brand-lockup b')?.textContent, 'ADDA');
  assert.equal(wall.querySelector('.brand-lockup i')?.textContent, 'BAAZ');
  assert.equal(wall.querySelector('.brand-lockup .premium-word')?.textContent, 'premium');
  const cta = wall.querySelector('a[href^="#/plans"]');
  assert.ok(cta, 'a See plans button exists in the app');
  assert.match(cta.textContent, /See plans/);
  assert.match(cta.getAttribute('href'), /next=/, 'after subscribing the viewer lands back on this video');
  assert.equal(globalThis.__watchCtl ?? null, null, 'no player behind the wall');
});
