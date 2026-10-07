// The reported bug, end to end: pull down to refresh in the app and the page came back as the launch
// screen (the brand-red ADDABAAZ splash) instead of the page the viewer was reading.
//
// Cause: a completed pull called location.reload(), so the whole app start-up re-ran — boot screen
// included — and the current page was thrown away while the catalog came down.
//
// This test boots the REAL app (index.html + app/js/main.js, the same bundle Capacitor packages) in a
// DOM, pulls down on a page, and checks that the page is redrawn with the new catalog while the
// document is never reloaded and no launch screen ever appears.
//
// Run: node --test test/frontend/ptr-no-splash.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');

test('a pull-to-refresh redraws the page in place — the app never reloads and never shows the splash', async () => {
  /* ---------- a browser-ish environment around the real index.html ---------- */
  const { document, window } = parseHTML(read('index.html'));
  globalThis.document = document;
  globalThis.window = window;
  const nav = window.navigator ?? {};
  Object.defineProperty(nav, 'onLine', { value: true, configurable: true });
  try { globalThis.navigator = nav; } catch { Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true }); }

  let reloads = 0;
  globalThis.location = {
    reload: () => { reloads++; },
    protocol: 'https:', origin: 'https://app.addabaaz.in', host: 'app.addabaaz.in',
    pathname: '/index.html', href: 'https://app.addabaaz.in/index.html', hash: '#/', search: '',
    assign() {}, replace() {},
  };
  window.location = globalThis.location;
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  globalThis.localStorage = window.localStorage = store();
  globalThis.sessionStorage = window.sessionStorage = store();
  globalThis.history = window.history = { scrollRestoration: 'auto', length: 1, state: null, pushState() {}, replaceState() {}, back() {} };
  // The app dispatches plain Events ('ab:ready') and CustomEvents: the DOM's own classes, not Node's.
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent ?? class CustomEvent extends window.Event { constructor(type, opts) { super(type, opts); this.detail = opts?.detail; } };
  globalThis.HashChangeEvent = window.Event;
  globalThis.HTMLImageElement = window.HTMLImageElement ?? class HTMLImageElement {};
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  globalThis.matchMedia = window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.setInterval = () => 0;              // page timers (hero slideshow) must not hold the test open
  globalThis.clearInterval = () => {};
  const scrolls = [];
  globalThis.scrollTo = window.scrollTo = (x, y) => scrolls.push(typeof x === 'object' ? { ...x } : { top: y });
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });

  /* ---------- the "server": the shipped catalog, then a changed one ---------- */
  const shipped = JSON.parse(read('data/catalog.json'));
  let served = shipped;
  let apiDown = false;                       // flipped below to simulate the server being unreachable again
  const catalogRequests = [];
  globalThis.fetch = window.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/api/v1/health')) {
      if (apiDown) throw new TypeError('fetch failed');                        // unreachable: no response at all
      return { ok: true, status: 200, async json() { return { ok: true, service: 'addabaaz' }; } };
    }
    if (target.includes('catalog')) { catalogRequests.push(target); return { ok: true, status: 200, async json() { return served; } }; }
    if (target.includes('studio')) return { ok: true, status: 200, async json() { return JSON.parse(read('data/studio.json')); } };
    return { ok: false, status: 404, async json() { return {}; } };
  };

  const until = async (check, ms = 5000) => {
    const started = Date.now();
    while (Date.now() - started < ms) { if (check()) return true; await new Promise((r) => setTimeout(r, 25)); }
    return false;
  };

  /* ---------- boot the real app ---------- */
  await import('../../app/js/main.js');
  const { app } = await import('../../app/js/app.js');
  assert.equal(await until(() => document.body.classList.contains('booted')), true, 'the app started');
  assert.equal(typeof app.softRefresh, 'function', 'pull-to-refresh has an in-place refresh to call');
  assert.equal(document.getElementById('boot'), null, 'start-up replaced the launch screen with the first page');

  /* ---------- a page whose content comes straight from the catalog ---------- */
  const first = shipped.shows[0];
  const term = encodeURIComponent((first.titleEn || first.title).trim());
  globalThis.location.hash = `#/search?q=${term}`;
  window.dispatchEvent(new window.Event('hashchange'));
  assert.equal(await until(() => document.querySelector('.search-page')), true, 'the search page rendered');
  const hits = document.querySelectorAll('.search-page a.card').length;
  assert.ok(hits > 0, `the catalog has results for " ${decodeURIComponent(term)} "`);

  /* ---------- the pull ---------- */
  served = { shows: [], videos: [], upcoming: [], gallery: [], homePosters: {} };   // an admin changed the catalog
  const reloadsBefore = reloads;
  const requestsBefore = catalogRequests.length;
  const touch = (type, y) => { const e = new window.Event(type, { cancelable: true }); e.touches = y == null ? [] : [{ clientY: y }]; document.dispatchEvent(e); };
  touch('touchstart', 20);
  touch('touchmove', 150);
  touch('touchend');

  const indicator = document.getElementById('ptr');
  assert.ok(indicator && indicator.classList.contains('on'), 'the pull shows the refresh indicator');
  assert.equal(await until(() => !document.getElementById('ptr').classList.contains('on')), true, 'the refresh finished');

  /* ---------- the bug: what the viewer sees afterwards ---------- */
  const page = document.querySelector('.search-page');
  assert.ok(page, 'the same page is on screen — no reload, so nothing was torn down');
  assert.equal(reloads, reloadsBefore, 'the document was NEVER reloaded: the launch screen cannot come back');
  assert.equal(document.querySelector('#boot .boot-native'), null, 'no full-screen splash artwork');
  assert.equal(document.querySelector('#boot .boot-web'), null, 'and no compact boot loader either');
  assert.equal(document.getElementById('boot'), null, 'no launch screen at all — the viewer stayed on their page');
  assert.ok(catalogRequests.length > requestsBefore, 'the catalog was re-read, so the change is picked up');
  assert.equal(page.querySelectorAll('a.card').length, 0, 'the page shows the fresh catalog');
  assert.match(page.textContent, /No results for/, 'redrawn from the new data, in place');
  assert.equal(globalThis.location.hash, `#/search?q=${term}`, 'the URL did not change: a refresh is not a navigation');
  assert.deepEqual(scrolls.at(-1), { top: 0, behavior: 'instant' }, 'and the page was not scrolled away from where it was');

  /* ---------- an app that is NOT on the live catalog (its launch happened while the server was unreachable) ---------- */
  // It runs off the catalog bundled with it, where a re-read can never show a newer title. The pull
  // re-probes the API and only restarts when a restart would actually reach it — so the viewer is
  // never handed a loading screen for nothing.
  const apiClient = app.api;
  app.api = null;
  apiDown = true;

  const reloadsBeforeStale = reloads;
  touch('touchstart', 20); touch('touchmove', 150); touch('touchend');
  assert.equal(await until(() => !document.getElementById('ptr').classList.contains('on')), true, 'the probe finished');
  assert.equal(reloads, reloadsBeforeStale, 'the API is still unreachable: the page is kept, not reloaded');
  assert.ok(document.querySelector('.search-page'), 'the viewer is still on their page');
  assert.match(document.getElementById('toasts').textContent, /Couldn’t reach ADDABAAZ/, 'and is told why');

  apiDown = false;                                   // the server came back (cold start finished)
  const reloadsBeforeRestart = reloads;
  touch('touchstart', 20); touch('touchmove', 150); touch('touchend');
  assert.equal(await until(() => reloads > reloadsBeforeRestart), true, 'now a restart is worth it: the live catalog is within reach');
  assert.equal(globalThis.sessionStorage.getItem('ab:refresh'), '1', 'the restart is flagged, so it shows the compact loader — not the launch artwork');
  app.api = apiClient;
});
