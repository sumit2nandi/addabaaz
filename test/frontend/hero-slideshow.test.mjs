// The home hero is an IMAGE slideshow: every featured show contributes one still banner (its
// latest episode's backdrop, the show's poster as fallback), the carousel crossfades between them
// every 5 seconds, and no trailer/episode media is ever mounted on a banner. Dots, swipe (touch
// WebViews in the Android app) and the pointer-only hover pause keep working.
// Run: node --test test/frontend/hero-slideshow.test.mjs
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
  // The first featured show keeps a YouTube trailer and the second an episode: neither may ever be
  // played - the banners are images only.
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
    await check(root, window, { intervals });
  } finally {
    cleanup?.();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
}

test('every banner is a still image and the slideshow ticks every 5 seconds', async () => {
  await withHome(async (root, window, { intervals }) => {
    await sleep(1100);
    const active = root.querySelector('.hero-slide.active');
    assert.ok(active, 'a slide is active');
    assert.ok(active.querySelector('.hero-bg img'), 'the banner shows the show image');
    for (const sel of ['.hero-video', 'iframe', 'video', '[data-sound]']) {
      assert.equal(root.querySelector(`.hero ${sel}`), null, `the banner mounts no ${sel}`);
    }
    const heroSrc = fs.readFileSync(new URL('../../app/js/views/home.js', import.meta.url), 'utf8');
    assert.doesNotMatch(heroSrc, /youtube\.com\/embed|heroTrailerSrc|createElement|innerHTML = `<video/, 'the hero carries no video playback code');
    assert.match(heroSrc, /pause on hover\/focus \(pointer devices\)/, 'the hover pause stays pointer-devices-only (touch must not freeze the slideshow)');
    assert.ok(intervals.includes(5000), 'the slideshow advances every 5 seconds');
  });
});

test('each hero banner links to its own show details without covering the action buttons', async () => {
  await withHome(async (root) => {
    const slides = [...root.querySelectorAll('.hero-slide')];
    assert.ok(slides.length >= 2, 'featured shows have slides');
    for (const slide of slides) {
      const link = slide.querySelector('.hero-banner-link');
      assert.ok(link, 'the banner image is an accessible link');
      assert.equal(link.getAttribute('href'), `#/show/${slide.dataset.showId}`, 'the link targets the show on this slide');
      assert.match(link.getAttribute('aria-label'), /details$/, 'the image link has an accessible name');
      assert.ok(link.querySelector('.hero-bg img'), 'the slideshow artwork is inside the link');
      assert.ok(slide.querySelector('.hero-actions a[href^="#/watch/"]'), 'Watch Now remains a separate action');
      assert.ok(slide.querySelector('.hero-actions [data-list]'), 'My List remains a separate action');
      assert.ok(slide.querySelector('.hero-actions a[href^="#/show/"]'), 'More info remains a separate action');
    }
  });
});

test('a horizontal swipe changes slides without following the banner link', async () => {
  await withHome(async (root, window) => {
    const hero = root.querySelector('.hero');
    const link = root.querySelector('.hero-slide.active .hero-banner-link');
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 300;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 120;
    hero.dispatchEvent(down); hero.dispatchEvent(up);
    const click = new window.Event('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true, 'a swipe-generated click cannot navigate to the show');
  });
});

test('the slideshow crossfades between the featured shows and drops no media when it moves on', async () => {
  await withHome(async (root, window) => {
    await sleep(60);
    const before = root.querySelector('.hero-slide.active').dataset.i;
    // Swipe to the next slide (the touch path the Android WebView uses).
    const hero = root.querySelector('.hero');
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 300;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 120;
    hero.dispatchEvent(down); hero.dispatchEvent(up);
    assert.notEqual(root.querySelector('.hero-slide.active').dataset.i, before, 'a horizontal swipe moves to the next banner');
    assert.ok(!root.querySelector('.hero-slide video'), 'no slide behind it mounted a video');
    const dots = root.querySelectorAll('[data-dot]');
    assert.ok(dots.length >= 2, 'the dots are there to pick a slide');
    dots[0].dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(root.querySelector('.hero-slide.active').dataset.i, '0', 'a dot jumps to its slide');
  });
});

test('the hero CSS keeps the swipe working and carries no player styling', async () => {
  await withHome(async (root) => {
    assert.ok(root.querySelector('.hero'), 'the hero rendered');
    const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.hero \{ touch-action: pan-y; \}/, 'touch-action lets touch WebViews deliver the swipe');
    assert.doesNotMatch(css, /\.hero-video|\.hero-sound/, 'the banner player styling is gone');
    assert.match(css, /\.hero-bg img \{[^}]*object-fit: cover/, 'the banner image fills the banner');
    assert.match(css, /\.hero-banner-link \.hero-bg \{ z-index: 0; \}/, 'the banner link remains the clickable image layer');
    assert.match(css, /\.hero-slide > \.hero-shade \{ z-index: 1; pointer-events: none; \}/, 'the visual scrim does not block the link');
    assert.match(css, /\.hero-slide > \.hero-inner a, \.hero-slide > \.hero-inner button \{ pointer-events: auto; \}/, 'the existing hero actions stay clickable above the banner link');
  });
});
