// Every show banner plays a muted preview when it activates: the trailer, or the 1st episode when
// there is no trailer (only when the viewer's gate allows it). No preview plays longer than 5 s and
// the slideshow advances every 5 s; the unmute switch on the banner pauses the rotation. The
// carousel must stay swipeable on touch (the Android app).
// Run: node --test test/frontend/hero-trailer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const seedCatalog = () => JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withHome(check) {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.matchMedia = () => ({ matches: false });
  globalThis.matchMedia = window.matchMedia;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.IntersectionObserver = undefined;
  const seed = seedCatalog();
  const featured = seed.shows.slice(0, 2).map((s) => s.id);
  seed.shows = seed.shows.map((s) => ({ ...s, featured: featured.includes(s.id) }));
  // Only the FIRST featured show gets a trailer; the second must fall back to its 1st episode,
  // which we force onto R2 here so the signed-URL <video> branch is the one under test.
  seed.videos = seed.videos.filter((v) => v.kind !== 'trailer')
    .map((v) => (v.showId === featured[1] && v.kind === 'episode' ? { ...v, source: { type: 'r2', key: `media/${v.id}.mp4` } } : v));
  seed.videos.push({ id: `tr-${featured[0]}`, showId: featured[0], kind: 'trailer', title: 'Trailer', duration: 60, publishedAt: '2026-09-01T00:00:00Z', source: { type: 'youtube', id: 'AAAAAAAAA1' } });
  const intervals = [];
  const realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => { intervals.push(ms); return 1; };
  globalThis.clearInterval = () => {};
  let cleanup;
  try {
    const { app } = await import('../../app/js/app.js');
    const { Catalog } = await import('../../app/js/data/catalog.js');
    const { default: home } = await import('../../app/js/views/home.js');
    app.catalog = new Catalog(seed);
    app.user = {
      account: null, lib: { progress: {} },
      continueWatching: () => [], listItems: () => [], recommendations: () => null,
      fraction: () => 0, inList: () => false, hasReminder: () => false, resumeTarget: () => null,
      streamUrl: (v) => Promise.resolve({ type: 'mp4', url: `https://r2.test/${v.id}.mp4` }),
    };
    const root = document.createElement('main');
    await home({ root, setTitle() {}, onCleanup(fn) { cleanup = fn; } });
    await check(root, window, { intervals, featured });
  } finally {
    cleanup?.();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
}

test('slide 1 autoplays its trailer muted; the preview is capped at 5 s; the slideshow ticks every 5 s', async () => {
  await withHome(async (root, window, { intervals }) => {
    await sleep(1100);
    const active = root.querySelector('.hero-slide.active');
    const frame = active.querySelector('.hero-video iframe');
    assert.ok(frame, 'the trailer slide mounts its muted preview');
    for (const p of ['autoplay=1', 'mute=1', 'playsinline=1']) assert.ok(frame.src.includes(p), `embeds with ${p}`);
    assert.ok(intervals.includes(5000), 'the slideshow advances every 5 seconds');

    const btn = active.querySelector('[data-sound]');
    assert.ok(btn, 'the unmute switch sits on the banner');
    assert.equal(btn.getAttribute('aria-pressed'), 'false', 'starts muted');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(btn.getAttribute('aria-pressed'), 'true', 'the switch unmutes');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(btn.getAttribute('aria-pressed'), 'false', 'and mutes again');
  });
});

test('a show without a trailer falls back to its 1st episode, capped at 5 seconds', async () => {
  await withHome(async (root, window) => {
    await sleep(1050);
    // Swipe to the second slide (the one without a trailer).
    const hero = root.querySelector('.hero');
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 300;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 120;
    hero.dispatchEvent(down); hero.dispatchEvent(up);
    await sleep(1050);
    const active = root.querySelector('.hero-slide.active');
    const vid = active.querySelector('.hero-video video');
    assert.ok(vid, 'the 1st episode preview mounts when there is no trailer');
    assert.match(vid.getAttribute('src') || vid.src, /r2\.test/, 'via the signed stream URL');
    assert.equal(vid.hasAttribute('muted'), true, 'muted');
    let pausedCalls = 0; vid.pause = () => { pausedCalls++; };
    await sleep(5200);
    assert.ok(pausedCalls >= 1, 'the preview stops after 5 seconds');
    assert.ok(!root.querySelector('.hero-slide:not(.active) video'), 'inactive slides carry no media');
  });
});

test('the banner is swipeable with touch pointer events (the Android app)', async () => {
  await withHome(async (root, window) => {
    const hero = root.querySelector('.hero');
    const first = root.querySelector('.hero-slide.active').dataset.i;
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 300;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 120;
    hero.dispatchEvent(down); hero.dispatchEvent(up);
    assert.notEqual(root.querySelector('.hero-slide.active').dataset.i, first, 'a horizontal swipe moves to the next banner');
    const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.hero \{ touch-action: pan-y; \}/, 'touch-action lets touch WebViews deliver the swipe');
  });
});
