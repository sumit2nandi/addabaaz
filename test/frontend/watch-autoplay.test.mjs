// Watch page (#/watch/:id) autoplay fallbacks: when a phone refuses even muted autoplay (Low Power Mode,
// data saver...), the page must offer an obvious "Tap to play" pill — and the tap itself is the gesture
// the browser needs. The muted-start case must offer "Tap to unmute".
// Run:  node --test test/frontend/watch-autoplay.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';
import { parseHTML } from 'linkedom';

// Minimal DOM, installed before any app module is imported (they read window/document at module scope).
const { document, window, Element } = parseHTML('<!doctype html><html><head></head><body><main id="view"></main><div id="toasts"></div></body></html>');
globalThis.window = window; globalThis.document = document;
globalThis.location = { protocol: 'https:', origin: 'https://t.in', pathname: '/', hash: '', href: 'https://t.in/', search: '' };
window.location = globalThis.location;
globalThis.localStorage = window.localStorage ?? { getItem: () => null, setItem: () => {} };
globalThis.fetch = globalThis.fetch || (async () => { throw new Error('offline'); });
window.fetch = globalThis.fetch;
Element.prototype.scrollIntoView = () => {};

register(new URL('./watch-mock-loader.mjs', import.meta.url));
const { Catalog } = await import('../../app/js/data/catalog.js');
const { app } = await import('../../app/js/app.js');
const watch = (await import('../../app/js/views/watch.js')).default;

const VIDEO = { id: 'v1', kind: 'episode', episode: 1, title: 'Test episode', showId: 's1', duration: 100, views: 1, publishedAt: '2026-09-01T00:00:00Z', source: { type: 'youtube', id: 'abc' } };
app.catalog = app.fullCatalog = new Catalog({ schema: 1, updatedAt: '', shows: [{ id: 's1', title: 'Show', titleEn: 'Show', genres: [], cast: [], type: 'series' }], videos: [VIDEO], upcoming: [], gallery: [] });
app.user = {
  remote: null, account: null, profiles: [], profile: { id: 'p1', name: 'T' }, activeId: 'p1', supportsAuth: false, isKids: false,
  gateFor: () => 'ok', progressOf: () => null, isFinished: () => false, pref: () => true, setPref: () => {},
  saveProgress: () => {}, fraction: () => 0, inList: () => false, hasReminder: () => false, on: () => {}, needsProfileChoice: () => false,
};

async function mount() {
  globalThis.__watchOpts = null; globalThis.__watchCtl = null;
  document.getElementById('view').innerHTML = '';
  const root = document.createElement('div');
  document.getElementById('view').appendChild(root);
  const ctx = { root, params: { id: 'v1' }, query: {}, path: '/watch/v1', setTitle: () => {}, onCleanup: () => {} };
  await watch(ctx);
  await new Promise((r) => setTimeout(r, 30));   // startPlayer() resolves (mock player)
  assert.ok(globalThis.__watchCtl, 'the player was created');
  return { ctx, ctl: globalThis.__watchCtl, opts: globalThis.__watchOpts };
}

before(() => assert.ok(watch, 'watch view imported'));

test('page asks the player to start automatically on all devices', async () => {
  const { opts } = await mount();
  assert.equal(opts.autoplay, true, 'watch page must pass autoplay: true (mobile autostart is then muted-only, per browser policy)');
});

test('when even muted autoplay is blocked, a "Tap to play" pill starts playback with one tap', async () => {
  const { ctx, ctl, opts } = await mount();
  assert.equal(document.querySelector('#playPill'), null, 'no pill while autostart works');
  opts.onAutoplayBlocked();   // the browser refused even muted playback
  const pill = document.querySelector('#playPill');
  assert.ok(pill, 'Tap-to-play pill shown when even muted autoplay is blocked');
  pill.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(ctl.__played, true, 'the tap started playback (the tap is the user gesture the browser needed)');
  await new Promise((r) => setTimeout(r));
  assert.equal(document.querySelector('#playPill'), null, 'pill removed after use');
  // Once playback reports 'playing', the pill must not linger.
  opts.onAutoplayBlocked(); opts.onState('playing');
  assert.equal(document.querySelector('#playPill'), null, 'playing state clears any leftover pill');
  assert.ok(ctx);
});

test('muted autostart offers a one-tap "Tap to unmute" pill', async () => {
  const { ctl, opts } = await mount();
  opts.onAutoplayMuted();     // autoplay with sound refused: video is running muted
  const pill = document.querySelector('#unmutePill');
  assert.ok(pill, 'unmute pill shown for muted autostart');
  pill.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(ctl.__unmuted, true);
});
