// The hero banner plays the featured show's YouTube trailer muted (autoplay policy) with an
// unmute switch on the banner - the behaviour the main branch's hero had - and the carousel must
// be swipeable on touch (the Android app), where pointer swipes need touch-action: pan-y.
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
  featured.forEach((id, k) => seed.videos.push({ id: `tr-${id}`, showId: id, kind: 'trailer', title: 'Trailer', duration: 60, publishedAt: '2026-09-01T00:00:00Z', source: { type: 'youtube', id: `AAAAAAAAA${k + 1}` } }));
  let cleanup;
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 1;   // no auto-advance during the test
  try {
    const { app } = await import('../../app/js/app.js');
    const { Catalog } = await import('../../app/js/data/catalog.js');
    const { default: home } = await import('../../app/js/views/home.js');
    app.catalog = new Catalog(seed);
    app.user = {
      account: null, lib: { progress: {} },
      continueWatching: () => [], listItems: () => [], recommendations: () => null,
      fraction: () => 0, inList: () => false, hasReminder: () => false, resumeTarget: () => null,
    };
    const root = document.createElement('main');
    await home({ root, setTitle() {}, onCleanup(fn) { cleanup = fn; } });
    await check(root, window);
  } finally {
    cleanup?.();
    globalThis.setInterval = realSetInterval;
  }
}

test('the active hero slide autoplays its trailer muted, with an unmute switch on the banner', async () => {
  await withHome(async (root) => {
    await sleep(1100);   // the iframe lands after the crossfade delay
    const active = root.querySelector('.hero-slide.active');
    const frame = active.querySelector('.hero-video iframe');
    assert.ok(frame, 'the active slide mounts the trailer iframe');
    for (const p of ['autoplay=1', 'mute=1', 'playsinline=1', 'enablejsapi=1', 'controls=0']) assert.ok(frame.src.includes(p), `trailer embeds with ${p}`);
    assert.ok(!root.querySelector('.hero-slide:not(.active) iframe'), 'inactive slides carry no iframe');

    const btn = active.querySelector('[data-sound]');
    assert.ok(btn, 'the unmute switch sits on the banner');
    assert.equal(btn.getAttribute('aria-pressed'), 'false', 'starts muted (autoplay policy)');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(btn.getAttribute('aria-pressed'), 'true', 'the switch unmutes');
    assert.match(btn.getAttribute('aria-label'), /Mute trailer/);
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(btn.getAttribute('aria-pressed'), 'false', 'and mutes again');
  });
});

test('the banner is swipeable with touch pointer events (the Android app)', async () => {
  await withHome(async (root, window) => {
    const hero = root.querySelector('.hero');
    assert.ok(hero, 'the hero carousel rendered');
    const first = root.querySelector('.hero-slide.active').dataset.i;
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 300;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 120;   // 180px left-swipe
    hero.dispatchEvent(down); hero.dispatchEvent(up);
    const now = root.querySelector('.hero-slide.active').dataset.i;
    assert.notEqual(now, first, 'a horizontal swipe moves to the next banner');
    const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.hero \{ touch-action: pan-y; \}/, 'touch-action lets touch WebViews deliver the swipe instead of cancelling it');
  });
});
