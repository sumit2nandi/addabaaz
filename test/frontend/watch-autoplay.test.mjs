// Watch page (#/watch/:id) autoplay fallbacks: when a phone refuses even muted autoplay (Low Power Mode,
// data saver...), the page must offer an obvious "Tap to play" pill — and the tap itself is the gesture
// the browser needs. The muted-start case must offer "Tap to unmute".
// Run:  node --test test/frontend/watch-autoplay.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
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
globalThis.ResizeObserver = class { observe() {} disconnect() {} };   // rails (related videos) measure themselves; linkedom has no layout

register(new URL('./watch-mock-loader.mjs', import.meta.url));
const { Catalog } = await import('../../app/js/data/catalog.js');
const { app } = await import('../../app/js/app.js');
const watch = (await import('../../app/js/views/watch.js')).default;

const VIDEO = { id: 'v1', kind: 'episode', episode: 1, title: 'Test episode', showId: 's1', duration: 100, views: 1, publishedAt: '2026-09-01T00:00:00Z', source: { type: 'youtube', id: 'abc' } };
const PREMIUM_VIDEO = { ...VIDEO, id: 'vp', episode: 2, title: 'Premium episode', access: 'premium', poster: 'media/premium-vp.webp', source: { type: 'r2', key: 'premium/x.mp4' } };
app.catalog = app.fullCatalog = new Catalog({ schema: 1, updatedAt: '', shows: [{ id: 's1', title: 'Show', titleEn: 'Show', genres: [], cast: [], type: 'series' }], videos: [VIDEO, PREMIUM_VIDEO], upcoming: [], gallery: [] });
app.user = {
  remote: null, account: null, profiles: [], profile: { id: 'p1', name: 'T' }, activeId: 'p1', supportsAuth: false, isKids: false,
  gateFor: () => 'ok', progressOf: () => null, isFinished: () => false, pref: () => true, setPref: () => {},
  saveProgress: () => {}, fraction: () => 0, inList: () => false, hasReminder: () => false, on: () => {}, needsProfileChoice: () => false,
};

async function mount(id = 'v1') {
  globalThis.__watchOpts = null; globalThis.__watchCtl = null;
  document.getElementById('view').innerHTML = '';
  const root = document.createElement('div');
  document.getElementById('view').appendChild(root);
  const ctx = { root, params: { id }, query: {}, path: `/watch/${id}`, setTitle: () => {}, onCleanup: () => {} };
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

// The player mock is not given a stream URL for R2 videos, so give the premium page one.
app.user.streamUrl = async () => ({ type: 'mp4', url: 'https://r2.test/premium/x.mp4' });

test('premium crown: top-left of the player, hidden while the video plays, back on pause / end / error', async () => {
  await mount('vp');
  const box = document.querySelector('#playerBox');
  assert.ok(box.classList.contains('has-premium'), 'a premium video marks its player box');
  const mark = box.querySelector('.premium-mark.premium-mark-player');
  assert.ok(mark, 'the crown is drawn inside the player box');
  assert.equal(box.classList.contains('is-playing'), false, 'visible before playback starts');
  const { opts } = { opts: globalThis.__watchOpts };

  opts.onState('buffering');
  assert.equal(box.classList.contains('is-playing'), false, 'still visible while the first frames load');
  opts.onState('playing');
  assert.equal(box.classList.contains('is-playing'), true, 'hidden (via .is-playing) while the video plays');
  opts.onState('buffering');
  assert.equal(box.classList.contains('is-playing'), true, 'a mid-play stall does not make the crown flash back in');
  opts.onState('paused');
  assert.equal(box.classList.contains('is-playing'), false, 'back on pause');
  opts.onState('playing');
  assert.equal(box.classList.contains('is-playing'), true);
  opts.onState('ended');
  assert.equal(box.classList.contains('is-playing'), false, 'back when the video ends');
  opts.onState('playing');
  opts.onState('error', 2);
  assert.equal(box.classList.contains('is-playing'), false, 'back when playback fails');
});

test('free videos get no crown and no premium markers', async () => {
  await mount('v1');
  const box = document.querySelector('#playerBox');
  assert.equal(box.querySelector('.premium-mark'), null);
  assert.equal(box.classList.contains('has-premium'), false);
  globalThis.__watchOpts.onState('playing');   // toggling the state class on a free video is harmless
  assert.equal(box.querySelector('.premium-mark'), null);
});

test('locked premium shows the video artwork behind the lock wall instead of a black background', async () => {
  const originalGate = app.user.gateFor;
  app.user.gateFor = (v, c) => (c.isPremium(v) ? 'plan' : 'ok');   // signed-in viewer without a plan
  try {
    document.getElementById('view').innerHTML = '';
    const root = document.createElement('div');
    document.getElementById('view').appendChild(root);
    await watch({ root, params: { id: 'vp' }, setTitle() {}, onCleanup() {} });
    const box = root.querySelector('#playerBox');
    assert.ok(box.classList.contains('has-wall'), 'the player box flags that artwork sits behind the wall');
    const art = box.querySelector('img.player-wall-art');
    assert.ok(art, 'the video thumbnail/poster is drawn behind the lock wall');
    assert.equal(art.getAttribute('src'), 'media/premium-vp.webp');
    assert.equal(root.querySelector('#playerMsg').hidden, false, 'the lock wall itself still shows');
    assert.equal(root.querySelector('#playerSlot').innerHTML, '', 'no player is created while locked');
  } finally {
    app.user.gateFor = originalGate;
  }
});

test('lock-wall CSS: artwork covers the box and the wall stays readable over it', () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /img\.player-wall-art \{[^}]*object-fit: cover/, 'the artwork fills the player box instead of a black background');
  assert.match(css, /\.player-box\.has-wall \.player-overlay \{[^}]*linear-gradient/, 'the wall dims the artwork so its text stays readable');
});
