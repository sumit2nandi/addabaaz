// The website keeps the full buying flow (docs/PAYMENTS.md — Razorpay is collected on the web only).
//
// Its mirror image: test/frontend/watch-plan-wall.test.mjs proves the store apps sell nothing; this test proves
// the browser still does — the premium lock wall offers "See plans" with a return link, and the plans page shows
// prices, the Razorpay note and a buy button.
// Run:  node --test test/frontend/plan-purchase-web.test.mjs
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

// A normal browser: no Capacitor, so isNative is false.
const { isNative } = await import('../../app/js/platform.js');
assert.equal(isNative, false, 'this test runs in a browser');

register(new URL('./watch-mock-loader.mjs', import.meta.url));
const { Catalog } = await import('../../app/js/data/catalog.js');
const { app } = await import('../../app/js/app.js');
const watch = (await import('../../app/js/views/watch.js')).default;
const plans = (await import('../../app/js/views/plans.js')).default;

const PREMIUM_VIDEO = { id: 'vp', kind: 'episode', episode: 1, title: 'Premium episode', showId: 's1', duration: 100, views: 1, publishedAt: '2026-09-01T00:00:00Z', access: 'premium', poster: 'media/premium-vp.webp', source: { type: 'r2', key: 'premium/x.mp4' } };
app.catalog = app.fullCatalog = new Catalog({ schema: 1, updatedAt: '', shows: [{ id: 's1', title: 'Show', titleEn: 'Show', genres: [], cast: [], type: 'series', poster: 'media/shows/s1.webp' }], videos: [PREMIUM_VIDEO], upcoming: [], gallery: [] });
app.user = {
  remote: null, account: { id: 'u1', email: 's@x.in' }, profiles: [{ id: 'p1', name: 'S' }], profile: { id: 'p1', name: 'S' }, activeId: 'p1',
  supportsAuth: true, isPremium: false, isKids: false, subscription: { planId: 'free', status: 'active' },
  gateFor: () => 'plan', progressOf: () => null, isFinished: () => false, pref: () => true, setPref: () => {},
  saveProgress: () => {}, fraction: () => 0, inList: () => false, hasReminder: () => false, on: () => {}, needsProfileChoice: () => false,
  plans: async () => ({
    plans: [
      { id: 'free', name: 'Free', priceINR: 0, interval: 'month', features: ['Free episodes'] },
      { id: 'plus-monthly', name: 'ADDABAAZ Plus', priceINR: 99, interval: 'month', features: ['Premium titles'] },
      { id: 'plus-yearly', name: 'ADDABAAZ Plus Yearly', priceINR: 799, interval: 'year', features: ['Premium titles', 'Best value'] },
    ],
    payments: { provider: 'razorpay', keyId: 'rzp_test_key' },
    billing: { gst: true, coupons: true, states: [] },
  }),
};

const ctxFor = (path, query = {}) => ({ root: document.createElement('div'), params: { id: 'vp' }, query, path, setTitle: () => {}, onCleanup: () => {} });

test('the browser lock wall offers the subscribe path, with a return link', async () => {
  const ctx = ctxFor('/watch/vp');
  document.getElementById('view').appendChild(ctx.root);
  await watch(ctx);
  await new Promise((r) => setTimeout(r, 20));
  const wall = ctx.root.querySelector('#playerMsg');
  assert.ok(wall, 'the lock wall is shown');
  assert.match(wall.textContent, /ADDABAAZ Plus exclusive/);
  const cta = wall.querySelector('a[href^="#/plans"]');
  assert.ok(cta, 'a See plans button exists on the website');
  assert.match(cta.textContent, /See plans/);
  assert.match(cta.getAttribute('href'), /next=/, 'after subscribing the viewer lands back on this video');
  assert.equal(globalThis.__watchCtl ?? null, null, 'no player behind the wall');
});

test('the browser plans page still shows prices and a buy button', async () => {
  const ctx = ctxFor('/plans');
  document.getElementById('view').appendChild(ctx.root);
  await plans(ctx);
  await new Promise((r) => setTimeout(r, 20));
  const text = ctx.root.textContent;
  assert.match(text, /₹99/, 'the monthly price is shown');
  assert.match(text, /₹799/, 'the yearly price is shown');
  assert.match(text, /Razorpay/, 'the payment method is disclosed');
  const buy = ctx.root.querySelector('[data-plan="plus-monthly"]');
  assert.ok(buy, 'a buy button exists for a signed-in viewer');
  assert.match(buy.textContent, /Get monthly plan/);
});
