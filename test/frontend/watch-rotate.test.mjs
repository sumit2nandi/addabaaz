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

const calls = { lock: 0, unlock: 0, fsEnter: 0, fsExit: 0, sbHide: 0, sbShow: 0 };
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'android',
  Plugins: {
    ScreenOrientation: { unlock: async () => { calls.unlock++; }, lock: async () => { calls.lock++; } },
    StatusBar: { hide: async () => { calls.sbHide++; }, show: async () => { calls.sbShow++; } },
  },
};
document.fullscreenElement = null;
document.documentElement.requestFullscreen = async () => { calls.fsEnter++; document.fullscreenElement = document.documentElement; };
document.exitFullscreen = async () => { calls.fsExit++; document.fullscreenElement = null; };

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

let prevCleanup = null;
const mount = async (id) => {
  prevCleanup?.(); prevCleanup = null;          // the previous page must release its listeners first
  globalThis.__watchOpts = null; globalThis.__watchCtl = null;
  document.getElementById('view').innerHTML = '';
  document.body.className = '';
  globalThis.screen.orientation.angle = 0;
  const root = document.createElement('div');
  document.getElementById('view').appendChild(root);
  let cleanupFn = null;
  await watch({ root, params: { id }, query: {}, path: `/watch/${id}`, setTitle: () => {}, onCleanup: (fn) => (cleanupFn = fn) });
  prevCleanup = () => cleanupFn?.();
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
  const [f0, h0, x0, s0] = [calls.fsEnter, calls.sbHide, calls.fsExit, calls.sbShow];
  turn(90);
  assert.ok(document.body.classList.contains('rot-fs'), 'landscape while playing full-screens the player');
  assert.ok(calls.fsEnter > f0 && calls.sbHide > h0, 'full screen is immersive: WebView fullscreen + status bar hidden');
  turn(0);
  assert.ok(!document.body.classList.contains('rot-fs'), 'portrait returns to the normal layout');
  assert.ok(calls.fsExit > x0 && calls.sbShow > s0, 'leaving full screen restores the bars');
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

test('native ships its own player controls; its fullscreen button uses the app flow, not the WebView custom view', async () => {
  const opts = await mount('vy');
  assert.equal(opts.controls, false, 'native player runs with the native controls OFF (their fullscreen breaks on rotation)');
  const root = document.getElementById('view');
  const bar = root.querySelector('.vctl');
  assert.ok(bar, 'the custom control bar is mounted');
  for (const n of ['play', 'mute', 'fs']) assert.ok(bar.querySelector(`[data-v="${n}"]`), `${n} button present`);
  opts.onState('playing');
  const [f0, h0] = [calls.fsEnter, calls.sbHide];
  bar.querySelector('[data-v="fs"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(document.body.classList.contains('watch-fs'), 'fs button full-screens through the app layout');
  assert.ok(calls.fsEnter > f0 && calls.sbHide > h0, 'fs button enters the immersive WebView fullscreen');
  const [x0, s0] = [calls.fsExit, calls.sbShow];
  turn(90);
  assert.ok(document.body.classList.contains('rot-fs'), 'rotating during app fullscreen still lands in the tested rot flow');
  turn(0);
  assert.ok(document.body.classList.contains('watch-fs'), 'back to portrait stays in fullscreen');
  bar.querySelector('[data-v="fs"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(!document.body.classList.contains('watch-fs'), 'second tap leaves fullscreen');
  assert.ok(calls.fsExit > x0 && calls.sbShow > s0, 'leaving restores the bars');
});
