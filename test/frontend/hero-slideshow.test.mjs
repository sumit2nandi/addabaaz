// The home hero is an IMAGE slideshow: every featured show contributes one still banner (its
// latest episode's backdrop, the show's poster as fallback), the carousel moves between them
// every 8 seconds, and no trailer/episode media is ever mounted on a banner. Dots, swipe (touch
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

test('every banner is a still image and the slideshow ticks every 8 seconds', async () => {
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
    assert.ok(intervals.includes(8000), 'the slideshow advances every 8 seconds');
  });
});

test('each hero banner links to its show and the action dock stays outside the moving slides', async () => {
  await withHome(async (root) => {
    const slides = [...root.querySelectorAll('.hero-slide')];
    const actions = root.querySelector('.hero-actions-fixed');
    assert.ok(slides.length >= 2, 'featured shows have slides');
    assert.ok(actions, 'the hero has one action dock');
    assert.equal(actions.closest('.hero-slide'), null, 'the action dock is not part of a moving banner');
    for (const slide of slides) {
      const link = slide.querySelector('.hero-banner-link');
      assert.ok(link, 'the banner image is an accessible link');
      assert.equal(link.getAttribute('href'), `#/show/${slide.dataset.showId}`, 'the link targets the show on this slide');
      assert.match(link.getAttribute('aria-label'), /details$/, 'the image link has an accessible name');
      assert.ok(link.querySelector('.hero-bg img'), 'the slideshow artwork is inside the link');
      assert.equal(slide.querySelector('.hero-actions'), null, 'buttons do not slide with the banner');
    }
    const active = root.querySelector('.hero-slide.active');
    assert.equal(actions.querySelector('.list-btn').dataset.list, `show:${active.dataset.showId}`, 'the fixed actions target the active show');
    assert.ok(actions.querySelector('a[href^="#/watch/"]'), 'Watch Now remains available in the fixed dock');
    assert.ok(actions.querySelector('a[href^="#/show/"]'), 'More info remains available in the fixed dock');
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

test('hero artwork follows a touch drag while its button dock stays anchored and updates for the active show', async () => {
  await withHome(async (root, window) => {
    const hero = root.querySelector('.hero');
    const actions = root.querySelector('.hero-actions-fixed');
    const originalDock = actions;
    hero.getBoundingClientRect = () => ({ width: 400 });
    const outgoing = root.querySelector('.hero-slide.active');
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 300; down.clientY = 100;
    const move = new window.Event('pointermove', { bubbles: true }); move.clientX = 210; move.clientY = 108;
    hero.dispatchEvent(down); hero.dispatchEvent(move);
    const incoming = [...root.querySelectorAll('.hero-slide')].find((slide) => slide !== outgoing);
    assert.match(outgoing.style.transform, /translate3d\(-90px/, 'the current banner moves with the finger');
    assert.match(incoming.style.transform, /translate3d\(310px/, 'the next banner enters from the edge as the finger drags');
    assert.equal(actions.style.transform, '', 'the action dock does not move with either banner');

    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 120; up.clientY = 106;
    hero.dispatchEvent(up);
    const active = root.querySelector('.hero-slide.active');
    assert.notEqual(active, outgoing, 'releasing the drag advances the banner');
    assert.equal(root.querySelector('.hero-actions-fixed'), originalDock, 'the same button dock remains in place');
    const list = actions.querySelector('.list-btn');
    assert.equal(list.dataset.list, `show:${active.dataset.showId}`, 'its actions now belong to the newly active show');
    const press = new window.Event('pointerdown', { bubbles: true }); press.clientX = 120; press.clientY = 106;
    list.dispatchEvent(press);
    const click = new window.Event('click', { bubbles: true, cancelable: true }); list.dispatchEvent(click);
    assert.equal(click.defaultPrevented, false, 'the anchored action remains tappable immediately after a swipe');
  });
});

test('the home banner omits its type eyebrow, shows one genre and uses a plus-only list action', async () => {
  await withHome(async (root) => {
    const slides = [...root.querySelectorAll('.hero-slide')];
    for (const slide of slides) {
      assert.equal(slide.querySelector('.hero-copy > .eyebrow'), null, 'Original Series / category eyebrow is omitted from the home banner');
      const parts = [...slide.querySelectorAll('.meta-line > span:not(.dot)')].map((part) => part.textContent.trim());
      assert.ok(parts[1], 'the first genre remains in banner metadata');
      assert.doesNotMatch(parts[1], /·/, 'only one genre is shown');
    }
    const actions = root.querySelector('.hero-actions-fixed');
    const list = actions.querySelector('[data-list]');
    assert.ok(list.classList.contains('icon-only'), 'My List uses a compact icon button');
    assert.equal(list.querySelector('.lbl'), null, 'the My List text label is removed');
    assert.ok(list.getAttribute('aria-label'), 'the plus/check button stays accessible');
    const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.hero-actions \.btn-lg \{ height: 48px; min-height: 48px; \}/, 'hero actions share one button height across pages');
    assert.match(css, /\.hero-actions \.btn-lg\.icon-only \{ flex: 0 0 48px; width: 48px; padding: 0; \}/, 'icon-only hero actions keep the same 48px height and width');
  });
});

test('the slideshow moves horizontally between featured shows and drops no media when it moves on', async () => {
  await withHome(async (root, window) => {
    await sleep(60);
    const outgoing = root.querySelector('.hero-slide.active');
    const before = outgoing.dataset.i;
    // Swipe to the next slide (the touch path the Android WebView uses).
    const hero = root.querySelector('.hero');
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 300;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 120;
    hero.dispatchEvent(down); hero.dispatchEvent(up);
    assert.notEqual(root.querySelector('.hero-slide.active').dataset.i, before, 'a horizontal swipe moves to the next banner');
    assert.equal(outgoing.classList.contains('before'), true, 'the outgoing banner glides to the left');
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
    assert.match(css, /\.hero-slide > \.hero-inner a, \.hero-slide > \.hero-inner button \{ pointer-events: auto; \}/, 'the hero poster link stays clickable above the banner image');
    assert.match(css, /\.hero-actions-fixed \{[^}]*position: absolute;[^}]*z-index: 4/, 'the action dock is independently layered above moving banners');
    assert.match(css, /\.hero-slide \{[^}]*transform: translateX\(100%\); transition: transform 1\.2s cubic-bezier/, 'banner slides move slowly with a smooth easing curve');
    assert.match(css, /\.hero-slide\.before \{ transform: translateX\(-100%\); \}/, 'the previous slide moves off to the left');
    assert.match(css, /\.hero-slide\.active \{ visibility: visible; transform: translateX\(0\); z-index: 2; \}/, 'the active banner settles in the frame');
  });
});
