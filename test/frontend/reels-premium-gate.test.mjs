// Trailers, clips and reels are NEVER locked and never carry the crown: even flagged premium
// themselves, or belonging to a Plus-only show, the gate says 'ok', the Reels feed plays them like
// any other reel and no premium badge is drawn - the preview is free, only the show is Plus.
// Run:  node --test test/frontend/reels-premium-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const { document, window, Element } = parseHTML('<!doctype html><html><head></head><body></body></html>');
Element.prototype.scrollIntoView = () => {};
const mem = new Map();
const storageStub = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
globalThis.window = window; globalThis.document = document;
globalThis.location = { protocol: 'https:', origin: 'https://t.in', pathname: '/', hash: '', href: 'https://t.in/', search: '' };
window.location = globalThis.location;
globalThis.localStorage = window.localStorage || storageStub;
window.localStorage = globalThis.localStorage;
globalThis.sessionStorage = window.sessionStorage || storageStub;
window.sessionStorage = globalThis.sessionStorage;
let youtubePlayerAttempts = 0;
window.YT = {
  PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 },
  Player: function Player(_mount, options) {
    youtubePlayerAttempts++;
    this.getPlayerState = () => 1; this.getCurrentTime = () => 0; this.getDuration = () => 30;
    this.isMuted = () => true; this.mute = () => {}; this.unMute = () => {}; this.setVolume = () => {};
    this.playVideo = () => {}; this.pauseVideo = () => {}; this.destroy = () => {};
    options.events.onReady({ target: this });
    queueMicrotask(() => options.events.onStateChange({ data: 1 }));
  },
};   // DOM-only test: never load YouTube's external player script
globalThis.IntersectionObserver = class {
  constructor() {}
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = (fn) => { setTimeout(fn, 0); return 1; };

const { app } = await import('../../app/js/app.js');
const { Catalog } = await import('../../app/js/data/catalog.js');
const { User } = await import('../../app/js/data/user.js');
const { LocalAdapter } = await import('../../app/js/data/adapters.js');

app.catalog = new Catalog({
  shows: [{ id: 'premium-series', title: 'Premium series', description: 'A plus-only show.', poster: 'media/shows/p.webp', access: 'premium' }],
  videos: [
    { id: 'newer-reel', showId: 'premium-series', kind: 'reel', title: 'Newest reel', source: { type: 'youtube', id: 'lmnopqrstuv' }, duration: 30, publishedAt: '2026-02-01' },
    { id: 'premium-reel', showId: 'premium-series', kind: 'reel', title: 'A reel', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 30, publishedAt: '2026-01-01', access: 'premium' },
    { id: 'premium-trailer', showId: 'premium-series', kind: 'trailer', title: 'A trailer', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 60, publishedAt: '2026-01-01', access: 'premium' },
    { id: 'premium-clip', showId: 'premium-series', kind: 'clip', title: 'A clip', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 45, publishedAt: '2026-01-01', access: 'premium' },
    { id: 'premium-ep', showId: 'premium-series', kind: 'episode', episode: 1, title: 'An episode', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 900, publishedAt: '2026-01-01', access: 'premium' },
  ],
});

async function guestUser() {
  const u = new User(new LocalAdapter());
  await u.init();
  u.activeId = u.profiles[0]?.id;
  assert.equal(u.account, null, 'starts signed out');
  return u;
}

test('gateFor: trailers, clips and reels always play; the premium episode stays locked', async () => {
  const u = await guestUser();
  const cat = app.catalog;
  assert.equal(u.gateFor(cat.video('premium-reel'), cat), 'ok', 'a premium-show reel is free for a signed-out guest');
  assert.equal(u.gateFor(cat.video('premium-trailer'), cat), 'ok', 'a premium-show trailer is free');
  assert.equal(u.gateFor(cat.video('premium-clip'), cat), 'ok', 'a premium-show clip is free');
  assert.notEqual(u.gateFor(cat.video('premium-ep'), cat), 'ok', 'the episode of the same show still requires a plan');
});

test('the Reels feed plays a premium-show reel with no lock wall and no crown', async () => {
  app.user = await guestUser();
  app.user.streamUrl = async () => { throw new Error('A YouTube reel must not request an R2 stream URL'); };
  const { default: reels } = await import('../../app/js/views/reels.js');
  const root = document.createElement('main');
  document.body.appendChild(root);
  let cleanup;
  youtubePlayerAttempts = 0;
  await reels({ root, params: { id: 'premium-reel' }, setTitle() {}, onCleanup(fn) { cleanup = fn; } });

  const section = root.querySelector('.reel[data-i="1"]');
  assert.equal(section.querySelector('.reel-slot img').getAttribute('fetchpriority'), 'high', 'the directly selected reel poster gets the browser highest image priority');
  assert.equal(section.querySelector('.premium-mark'), null, 'free previews wear no crown, even on a premium show');
  assert.equal(section.querySelector('.reel-frame.has-premium'), null, 'no premium framing on a free preview');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(youtubePlayerAttempts, 1, 'a directly selected /reels/:id starts without waiting for IntersectionObserver');
  assert.ok(section.querySelector('.reel-player'), 'the player is attached to the selected reel');
  assert.equal(section.querySelector('.reel-gate'), null, 'no lock wall is ever drawn on a reel');
  assert.equal(section.classList.contains('locked'), false, 'the reel is not treated as locked');
  cleanup?.();
});

test('mobile Reels fill the feed width up to the mobile-tabbar breakpoint', () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  const mobileReels = css.slice(css.indexOf('@media (max-width: 899px)'), css.indexOf('/* ---------- lightbox', css.indexOf('@media (max-width: 899px)')));
  assert.match(mobileReels, /\.reel \{ padding: 0; \}/, 'remove card gutters on mobile layouts');
  assert.match(mobileReels, /\.reel-frame \{[^}]*width: 100%;[^}]*height: 100%;[^}]*aspect-ratio: auto;/, 'the reel itself stretches to the full available feed instead of retaining a narrow portrait card');
});

test('the initially selected R2 reel starts signing before the player activation callback', async () => {
  const originalCatalog = app.catalog, originalStreamUrl = app.user.streamUrl;
  const realRequestAnimationFrame = globalThis.requestAnimationFrame;
  let requests = 0, cleanup;
  app.catalog = new Catalog({ shows: [], videos: [
    { id: 'r2-reel', kind: 'reel', title: 'R2 reel', source: { type: 'r2', key: 'reels/first.mp4' }, duration: 30, publishedAt: '2026-03-01' },
  ] });
  app.user.streamUrl = async () => { requests++; return { type: 'mp4', url: 'https://r2.test/reels/first.mp4' }; };
  globalThis.requestAnimationFrame = () => 1; // leave activation pending so this only measures render-time prefetch
  try {
    const { default: reels } = await import('../../app/js/views/reels.js');
    const root = document.createElement('main'); document.body.appendChild(root);
    await reels({ root, params: { id: 'r2-reel' }, setTitle() {}, onCleanup(fn) { cleanup = fn; } });
    assert.equal(requests, 1, 'the first selected reel overlaps URL signing with feed render');
    cleanup?.();
  } finally {
    app.catalog = originalCatalog;
    app.user.streamUrl = originalStreamUrl;
    globalThis.requestAnimationFrame = realRequestAnimationFrame;
  }
});
