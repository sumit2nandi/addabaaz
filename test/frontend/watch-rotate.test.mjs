// Rotation contract for the Android app (the YouTube-app behaviour):
//   - the app NEVER rotates while watching - playback does not unlock the sensor, turning the phone
//     changes nothing, and the watch page has no fullscreen CSS of its own;
//   - the player keeps its OWN (native, YouTube-style) controls: their fullscreen button is the one
//     way into full screen;
//   - full screen FOLLOWS THE PHONE: the native client switches the activity to FULL_SENSOR (the
//     video is portrait upright, landscape turned, in both directions, even with the device's own
//     auto-rotate switch off) and the page does NOT pin a fixed orientation on the way in - it only
//     locks the app back to portrait when full screen ends.
// Run: node --test test/frontend/watch-rotate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const calls = { lock: [], unlock: 0 };
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'android',
  Plugins: {
    ScreenOrientation: { unlock: async () => { calls.unlock++; }, lock: async ({ orientation }) => { calls.lock.push(orientation); } },
    StatusBar: { hide: async () => {}, show: async () => {} },
  },
};
// linkedom does not implement the Fullscreen API: give the document a controllable fullscreenElement.
let fullscreenEl = null;
Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenEl });
const setFullscreen = (el) => { fullscreenEl = el; document.dispatchEvent(new window.Event('fullscreenchange')); };
document.documentElement.requestFullscreen = async () => setFullscreen(document.documentElement);
document.exitFullscreen = async () => setFullscreen(null);

register(new URL('./watch-mock-loader.mjs', import.meta.url));
const { Catalog } = await import('../../app/js/data/catalog.js');
const { app } = await import('../../app/js/app.js');
const { initFullscreenRotation } = await import('../../app/js/orientation.js');
const watch = (await import('../../app/js/views/watch.js')).default;
initFullscreenRotation();   // what main.js does at boot

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
  setFullscreen(null);
  calls.lock.length = 0; calls.unlock = 0;
  const root = document.createElement('div');
  document.getElementById('view').appendChild(root);
  let cleanupFn = null;
  await watch({ root, params: { id }, query: {}, path: `/watch/${id}`, setTitle: () => {}, onCleanup: (fn) => (cleanupFn = fn) });
  prevCleanup = () => cleanupFn?.();
  await new Promise((r) => setTimeout(r, 20));
  return globalThis.__watchOpts;
};
const videoEl = (w, h) => { const el = document.createElement('video'); el.videoWidth = w; el.videoHeight = h; return el; };

test('the app never rotates on its own: playing (even a landscape video) keeps portrait locked', async () => {
  const opts = await mount('vy');
  opts.onState('playing');
  opts.onState('paused');
  opts.onState('playing');
  assert.equal(calls.unlock, 0, 'nothing unlocks the sensor while watching');
  assert.deepEqual(calls.lock, [], 'and nothing re-orients the screen either');
  const watchSrc = fs.readFileSync(new URL('../../app/js/views/watch.js', import.meta.url), 'utf8');
  assert.doesNotMatch(watchSrc, /unlockRotation|orientationchange|rot-fs|watch-fs/, 'watch.js carries no rotation/fullscreen feature');
  assert.doesNotMatch(watchSrc, /class="vctl"/, 'no custom control bar: the player keeps its own controls');
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /body\.rot-fs|body\.watch-fs|\.vctl/, 'the fullscreen/custom-control CSS is gone');
});

test('the player keeps its own (YouTube-style) controls with their fullscreen button', async () => {
  const opts = await mount('vy');
  assert.notEqual(opts.controls, false, 'controls are not switched off on native');
  assert.equal(opts.onDimensions, undefined, 'no app-level fullscreen logic hangs off the player');
  assert.equal(document.querySelector('.vctl'), null, 'no custom bar in the page');
});

test('entering full screen pins NO orientation (the screen follows the phone); leaving locks portrait', async () => {
  await mount('vm');
  setFullscreen(videoEl(1920, 1080));
  assert.deepEqual(calls.lock, [], 'no fixed lock on the way in - the native FULL_SENSOR (the phone\'s direction) decides');
  setFullscreen(videoEl(1080, 1920));
  assert.deepEqual(calls.lock, [], 'not for a vertical video either');
  setFullscreen(null);
  assert.deepEqual(calls.lock, ['portrait'], 'leaving full screen locks the app back to portrait');

  const src = fs.readFileSync(new URL('../../app/js/orientation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /lock\('landscape'\)|orientation: 'landscape'/, 'the page must never force landscape (that was the landscape-only full screen)');
  assert.equal(calls.unlock, 0, 'nor unlock() through the plugin: it maps to UNSPECIFIED, which obeys the phone\'s auto-rotate switch');
});

test('the native fullscreen client drives the same rule even without a fullscreenchange event', async () => {
  await mount('vy');
  calls.lock.length = 0;
  window.dispatchEvent(new window.CustomEvent('ab-video-fullscreen', { detail: { active: true } }));
  assert.deepEqual(calls.lock, [], 'the native "full screen started" event leaves the orientation to the sensor');
  window.dispatchEvent(new window.CustomEvent('ab-video-fullscreen', { detail: { active: false } }));
  assert.deepEqual(calls.lock, ['portrait'], 'and the "full screen ended" event locks portrait');
});

test('leaving the watch page always lands back in portrait', async () => {
  await mount('vy');
  calls.lock.length = 0;
  prevCleanup?.(); prevCleanup = null;
  assert.ok(calls.lock.includes('portrait'), 'the cleanup re-locks portrait');
});
