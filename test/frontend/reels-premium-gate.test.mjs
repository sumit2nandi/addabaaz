// Trailers, clips and reels are NEVER locked and never carry the crown: even flagged premium
// themselves, or belonging to a Plus-only show, the gate says 'ok', the Reels feed plays them like
// any other reel and no premium badge is drawn - the preview is free, only the show is Plus.
// Run:  node --test test/frontend/reels-premium-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
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
window.YT = { Player() {} };   // DOM-only test: never load YouTube's external player script
let observerCb = null;
globalThis.IntersectionObserver = class {
  constructor(callback) { observerCb = callback; }
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = () => 1;

const { app } = await import('../../app/js/app.js');
const { Catalog } = await import('../../app/js/data/catalog.js');
const { User } = await import('../../app/js/data/user.js');
const { LocalAdapter } = await import('../../app/js/data/adapters.js');

app.catalog = new Catalog({
  shows: [{ id: 'premium-series', title: 'Premium series', description: 'A plus-only show.', poster: 'media/shows/p.webp', access: 'premium' }],
  videos: [
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
  await reels({ root, params: {}, setTitle() {}, onCleanup(fn) { cleanup = fn; } });

  const section = root.querySelector('.reel');
  assert.equal(section.querySelector('.premium-mark'), null, 'free previews wear no crown, even on a premium show');
  assert.equal(section.querySelector('.reel-frame.has-premium'), null, 'no premium framing on a free preview');
  observerCb([{ target: section, isIntersecting: true, intersectionRatio: 1 }]);   // scroll the reel into view
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(section.querySelector('.reel-gate'), null, 'no lock wall is ever drawn on a reel');
  assert.equal(section.classList.contains('locked'), false, 'the reel is not treated as locked');
  cleanup?.();
});
