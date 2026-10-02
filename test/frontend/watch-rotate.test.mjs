// Rotate-to-fullscreen in the Android app: the app itself stays portrait-locked, but while a
// LANDSCAPE video is actively playing the orientation is unlocked; turning the phone then
// full-screens the player (body.rot-fs). Pause/end re-locks portrait. Reels never unlock.
// Run: node --test test/frontend/watch-rotate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
globalThis.screen = { orientation: { angle: 0 } };   // the test turns the phone by editing this

const calls = { lock: 0, unlock: 0 };
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'android',
  Plugins: { ScreenOrientation: { unlock: async () => { calls.unlock++; }, lock: async () => { calls.lock++; } } },
};

register(new URL('./watch-mock-loader.mjs', import.meta.url));
const { Catalog } = await import('../../app/js/data/catalog.js');
const { app } = await import('../../app/js/app.js');
const watch = (await import('../../app/js/views/watch.js')).default;

const BASE = { id: 'v1', kind: 'episode', episode: 1, title: 'T', showId: 's1', duration: 100, views: 1, publishedAt: '2026-09-01T00:00:00Z' };
const YT = { ...BASE, id: 'vy', source: { type: 'youtube', id: 'abc' } };
const MP4 = { ...BASE, id: 'vm', source: { type: 'mp4', url: 'https://cdn.test/x.mp4' } };
const REEL = { ...BASE, id: 'vr', kind: 'reel', episode: null, source: { type: 'youtube', id: 'zzz' } };
app.catalog = app.fullCatalog = new Catalog({ schema: 1, updatedAt: '', shows: [{ id: 's1', title: 'Show', titleEn: 'Show', genres: [], cast: [], type: 'series', poster: 'media/shows/s1.webp' }], videos: [YT, MP4, REEL], upcoming: [], gallery: [] });
app.user = {
  remote: null, account: null, profiles: [], profile: { id: 'p1', name: 'T' }, activeId: 'p1', supportsAuth: false, isKids: false,
  gateFor: () => 'ok', progressOf: () => null, isFinished: () => false, pref: () => true, setPref: () => {},
  saveProgress: () => {}, fraction: () => 0, inList: () => false, hasReminder: () => false, on: () => {}, needsProfileChoice: () => false,
};

const mount = async (id) => {
  globalThis.__watchOpts = null; globalThis.__watchCtl = null;
  document.getElementById('view').innerHTML = '';
  document.body.className = '';
  globalThis.screen.orientation.angle = 0;
  const root = document.createElement('div');
  document.getElementById('view').appendChild(root);
  await watch({ root, params: { id }, query: {}, path: `/watch/${id}`, setTitle: () => {}, onCleanup: () => {} });
  await new Promise((r) => setTimeout(r, 20));
  return globalThis.__watchOpts;
};
const turn = (angle) => { globalThis.screen.orientation.angle = angle; window.dispatchEvent(new window.Event('orientationchange')); };

test('playing a landscape video unlocks rotation; turning the phone full-screens it; pause re-locks portrait', async () => {
  const opts = await mount('vy');
  const [u0, l0] = [calls.unlock, calls.lock];
  assert.equal(calls.unlock, u0, 'nothing unlocks before playback');
  opts.onState('playing');
  assert.equal(calls.unlock, u0 + 1, 'playback of a landscape video unlocks the sensor');
  turn(90);
  assert.ok(document.body.classList.contains('rot-fs'), 'landscape while playing full-screens the player');
  turn(0);
  assert.ok(!document.body.classList.contains('rot-fs'), 'portrait returns to the normal layout');
  opts.onState('paused');
  assert.equal(calls.lock, l0 + 1, 'pausing locks the app back to portrait');
  turn(90);
  assert.ok(!document.body.classList.contains('rot-fs'), 'no fullscreen while paused');
});

test('html5 videos unlock only when the metadata says landscape', async () => {
  const opts = await mount('vm');
  const u0 = calls.unlock;
  opts.onDimensions(480, 854);          // a portrait mp4
  opts.onState('playing');
  assert.equal(calls.unlock, u0, 'portrait videos never unlock');
  opts.onState('paused');
  const before = calls.unlock;
  opts.onDimensions(1920, 1080);        // e.g. a trailer re-reported as landscape
  opts.onState('playing');
  assert.equal(calls.unlock, before + 1, 'landscape metadata unlocks rotation');
});

test('reels never unlock rotation, even while playing', async () => {
  const opts = await mount('vr');
  const u0 = calls.unlock;
  opts.onState('playing');
  assert.equal(calls.unlock, u0, 'reels stay portrait-only');
  turn(90);
  assert.ok(!document.body.classList.contains('rot-fs'), 'reels never full-screen on rotation');
});
