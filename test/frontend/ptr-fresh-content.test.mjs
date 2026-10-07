// "If admin publishes a new episode (or any new content), does pull-to-refresh show it?" — yes, and
// this test proves it end to end on the REAL app.
//
// The refresh reads the catalog from the same source start-up used, with `cache: 'no-store'`, and the
// server serves that endpoint with `Cache-Control: no-store, max-age=0` and `catalog.get({ fresh: true })`
// (it re-checks the database version on every request, so an admin write is visible immediately). The
// page is then redrawn from the new catalog. Nothing is cached in between.
//
//   1. the app is booted against the shipped catalog and a show page is open
//   2. "admin publishes a new episode"  →  the catalog the server serves gains that episode
//   3. the viewer pulls down            →  the episode is on the page, with no reload and no launch screen
//
// Run: node --test test/frontend/ptr-fresh-content.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');

test('a new episode published in Admin is on the page after a pull-to-refresh', async () => {
  /* ---------- a browser-ish environment around the real index.html (as in ptr-no-splash.test.mjs) ---------- */
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
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent ?? class CustomEvent extends window.Event { constructor(type, opts) { super(type, opts); this.detail = opts?.detail; } };
  globalThis.HashChangeEvent = window.Event;
  globalThis.HTMLImageElement = window.HTMLImageElement ?? class HTMLImageElement {};
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  globalThis.matchMedia = window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  globalThis.scrollTo = window.scrollTo = () => {};
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });

  /* ---------- the server, and a fresh episode published in Admin ---------- */
  const after = JSON.parse(read('data/catalog.json'));            // what the server serves after the publish
  const show = after.shows[0];
  const existing = after.videos.filter((v) => v.showId === show.id && v.kind === 'episode');
  const nextEpisode = Math.max(...existing.map((v) => v.episode || 0)) + 1;
  const NEW_TITLE = 'Fresh From Admin';
  after.videos.push({
    // Shaped exactly like a real catalog row, the way the admin console writes one.
    id: 'admin-fresh-episode', showId: show.id, kind: 'episode', episode: nextEpisode,
    title: `${NEW_TITLE} | ${show.titleEn || show.title} | EP ${nextEpisode} | ADDABAAZ`,
    shortTitle: NEW_TITLE,                                                   // what the cards and episode rows show
    source: { type: 'youtube', id: 'adminfresh001' },
    duration: 754, publishedAt: new Date(Date.now() + 60000).toISOString(),  // newest → top of "Recently added"
    views: 0, access: 'free',
  });

  let served = JSON.parse(read('data/catalog.json'));              // what the server serves right now
  const catalogRequests = [];
  globalThis.fetch = window.fetch = async (url) => {
    const target = String(url);
    if (target.includes('catalog')) { catalogRequests.push(target); return { ok: true, status: 200, headers: { get: () => 'no-store, max-age=0' }, async json() { return served; } }; }
    if (target.includes('studio')) return { ok: true, status: 200, async json() { return JSON.parse(read('data/studio.json')); } };
    if (target.includes('/api/v1/health')) return { ok: true, status: 200, async json() { return { ok: true, service: 'addabaaz' }; } };
    return { ok: false, status: 404, async json() { return {}; } };
  };

  const until = async (check, ms = 5000) => {
    const started = Date.now();
    while (Date.now() - started < ms) { if (check()) return true; await new Promise((r) => setTimeout(r, 25)); }
    return false;
  };
  const pull = async () => {
    const touch = (type, y) => { const e = new window.Event(type, { cancelable: true }); e.touches = y == null ? [] : [{ clientY: y }]; document.dispatchEvent(e); };
    touch('touchstart', 20); touch('touchmove', 150); touch('touchend');
    assert.equal(await until(() => !document.getElementById('ptr')?.classList.contains('on')), true, 'the refresh finished');
  };

  /* ---------- boot the real app and open a show page ---------- */
  await import('../../app/js/main.js');
  const { app } = await import('../../app/js/app.js');
  assert.equal(await until(() => document.body.classList.contains('booted')), true, 'the app started');
  assert.ok(app.api, 'the app is on the live API (the phone runs with API_BASE baked in), not on the bundled catalog');

  globalThis.location.hash = `#/show/${show.id}`;
  window.dispatchEvent(new window.Event('hashchange'));
  assert.equal(await until(() => document.querySelector('.ep-row')), true, 'the show page rendered its episode list');

  const episodesBefore = document.querySelectorAll('.ep-row').length;
  const titlesBefore = [...document.querySelectorAll('.ep-row .ep-title')].map((el) => el.textContent);
  assert.equal(existing.length, episodesBefore, 'every episode of the show is listed');
  assert.ok(!titlesBefore.includes(NEW_TITLE), 'the new episode does not exist in the app yet');

  /* ---------- Admin publishes the episode; the viewer pulls down ---------- */
  served = after;
  const reloadsBefore = reloads;
  const requestsBefore = catalogRequests.length;
  await pull();

  /* ---------- the page now has it ---------- */
  const rows = [...document.querySelectorAll('.ep-row .ep-title')].map((el) => el.textContent);
  assert.ok(catalogRequests.length > requestsBefore, 'the pull re-read the catalog (no HTTP cache in the way)');
  assert.equal(document.querySelectorAll('.ep-row').length, episodesBefore + 1, 'the new episode is in the list');
  assert.ok(rows.includes(NEW_TITLE), `"${NEW_TITLE}" is on the page after the pull`);
  assert.equal(reloads, reloadsBefore, 'in place: no reload, so no launch screen');
  assert.equal(document.getElementById('boot'), null, 'no launch screen on the page');
  assert.equal(globalThis.location.hash, `#/show/${show.id}`, 'and the viewer is still on the same show page');
});
