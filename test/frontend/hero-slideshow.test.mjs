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

test('each hero banner links to its own show, and the three actions share one stationary dock', async () => {
  await withHome(async (root) => {
    const hero = root.querySelector('.hero');
    const slides = [...root.querySelectorAll('.hero-slide')];
    assert.ok(slides.length >= 2, 'featured shows have slides');
    const docks = root.querySelectorAll('.hero-dock');
    assert.equal(docks.length, 1, 'the carousel carries one action dock, not one per banner');
    const dock = docks[0];
    assert.equal(dock.parentElement, hero, 'the dock hangs off the carousel itself');
    assert.equal(dock.closest('.hero-slide'), null, 'no banner owns it, so it cannot slide away with one');
    assert.ok(dock.classList.contains('hero-actions'), 'the dock keeps the hero action styling');
    for (const slide of slides) {
      const link = slide.querySelector('.hero-banner-link');
      assert.ok(link, 'the banner image is an accessible link');
      assert.equal(link.getAttribute('href'), `#/show/${slide.dataset.showId}`, 'the link targets the show on this slide');
      assert.match(link.getAttribute('aria-label'), /details$/, 'the image link has an accessible name');
      assert.ok(link.querySelector('.hero-bg img'), 'the slideshow artwork is inside the link');
      assert.equal(slide.querySelector('.hero-actions'), null, 'the actions are not duplicated onto every banner');
    }
    assert.ok(dock.querySelector('a[href^="#/watch/"]'), 'Watch Now stays available in the dock');
    assert.ok(dock.querySelector('[data-list]'), 'My List stays available in the dock');
    assert.ok(dock.querySelector('a[href^="#/show/"]'), 'More info stays available in the dock');
  });
});

test('the stationary dock repoints itself at whichever banner is on screen', async () => {
  await withHome(async (root, window) => {
    const slides = [...root.querySelectorAll('.hero-slide')];
    const dock = root.querySelector('.hero-dock');
    const watch = dock.querySelector('[data-hero-watch]'), info = dock.querySelector('[data-hero-info]'), list = dock.querySelector('[data-list]');
    const targetsFor = (index) => ({
      watch: `#/watch/${slides[index].dataset.watchId}`,
      info: `#/show/${slides[index].dataset.showId}`,
      list: `show:${slides[index].dataset.showId}`,
    });
    assert.notDeepEqual(targetsFor(0), targetsFor(1), 'the two banners lead to different shows and videos');
    for (const index of [0, 1]) {
      root.querySelector(`[data-dot="${index}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
      const want = targetsFor(index);
      assert.equal(watch.getAttribute('href'), want.watch, `Watch Now plays the banner on screen (slide ${index})`);
      assert.equal(info.getAttribute('href'), want.info, `More info opens the banner on screen (slide ${index})`);
      assert.equal(list.dataset.list, want.list, `My List stores the banner on screen (slide ${index})`);
      assert.equal(root.querySelector('.hero-slide.active'), slides[index], `slide ${index} is the one on screen`);
      assert.equal(root.querySelector('.hero-dock'), dock, 'the dock is the very same element, never rebuilt');
      assert.equal(dock.style.transform, '', 'and the carousel never moves it');
      assert.equal(dock.closest('.hero-slide'), null, 'it never travels inside a banner');
    }
  });
});

// A finger/pen drag: press at `from`, move to `to` at the same height, and hold the release back so
// the test can look at what the drag did before it is finished.
function dragOn(target, window) {
  return (from, to, y = 200) => {
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = from; down.clientY = y;
    const move = new window.Event('pointermove', { bubbles: true }); move.clientX = to; move.clientY = y;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = to; up.clientY = y;
    target.dispatchEvent(down); target.dispatchEvent(move);
    return () => target.dispatchEvent(up);
  };
}

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

test('a drag pulls the neighbouring banner in with the finger, forwards and backwards', async () => {
  await withHome(async (root, window) => {
    const hero = root.querySelector('.hero');
    const slides = [...root.querySelectorAll('.hero-slide')];
    const drag = dragOn(hero, window);
    const offsets = () => slides.map((slide) => slide.style.transform);

    // Forwards: the finger travels left, so the next banner comes in from the right.
    let release = drag(300, 200);
    assert.equal(slides[1].classList.contains('peek'), true, 'the next banner is revealed during the drag');
    assert.equal(slides[1].getAttribute('aria-hidden'), 'false', 'and it is exposed while it is on screen');
    assert.equal(slides[0].classList.contains('dragging'), true, 'the banner under the finger follows it');
    assert.equal(slides[1].classList.contains('dragging'), true, 'the incoming banner follows it too');
    assert.deepEqual(offsets(), ['translate3d(-100px,0,0)', 'translate3d(calc(100% - 100px),0,0)'],
      'both banners carry the same drag offset, one frame apart');
    assert.equal(hero.classList.contains('is-dragging'), true, 'the carousel knows a drag is in progress');
    release();
    assert.equal(root.querySelector('.hero-slide.active'), slides[1], 'the drag completes onto the next banner');
    assert.deepEqual(offsets(), ['', ''], 'the inline offsets are handed back to the CSS transition');
    assert.equal(slides[1].classList.contains('peek'), false, 'the revealed banner is an ordinary slide again');
    assert.equal(hero.classList.contains('is-dragging'), false, 'and the drag is over');

    // Backwards: the finger travels right, so the previous banner comes in from the left.
    release = drag(100, 240);
    assert.equal(slides[0].classList.contains('peek'), true, 'the previous banner is revealed during the back drag');
    assert.equal(slides[0].getAttribute('aria-hidden'), 'false', 'and it too is exposed while on screen');
    assert.deepEqual(offsets(), ['translate3d(calc(-100% + 140px),0,0)', 'translate3d(140px,0,0)'],
      'the incoming banner waits one frame to the left and moves with the finger');
    release();
    assert.equal(root.querySelector('.hero-slide.active'), slides[0], 'the back drag completes onto the previous banner');
    assert.deepEqual(offsets(), ['', ''], 'and the movement is handed back to the transition again');
  });
});

test('a drag that goes nowhere snaps the banner back', async () => {
  await withHome(async (root, window) => {
    const slides = [...root.querySelectorAll('.hero-slide')];
    const release = dragOn(root.querySelector('.hero'), window)(300, 285);   // 15px: a wobble, not a swipe
    assert.equal(slides[1].classList.contains('peek'), true, 'the neighbour still shows while the finger is down');
    release();
    assert.equal(root.querySelector('.hero-slide.active'), slides[0], 'a short drag leaves the banner alone');
    assert.equal(slides[1].classList.contains('peek'), false, 'the neighbour is tucked away again');
    assert.equal(slides[1].getAttribute('aria-hidden'), 'true', 'and hidden from screen readers again');
    assert.deepEqual(slides.map((slide) => slide.style.transform), ['', ''], 'both banners glide back with the normal transition');
  });
});

test('a drag, like a swipe, never follows the banner link', async () => {
  await withHome(async (root, window) => {
    const link = root.querySelector('.hero-slide.active .hero-banner-link');
    dragOn(root.querySelector('.hero'), window)(300, 140)();                 // press, move, release
    const click = new window.Event('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true, 'the click a drag leaves behind cannot navigate to the show');
    const tap = new window.Event('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(tap);
    assert.equal(tap.defaultPrevented, false, 'the next genuine tap still opens the show');
  });
});

test('a tap on a dock action is never mistaken for a swipe', async () => {
  await withHome(async (root, window) => {
    const watch = root.querySelector('.hero-dock [data-hero-watch]');
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 300; down.clientY = 200;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 190; up.clientY = 200;   // a thumb that slipped
    watch.dispatchEvent(down); watch.dispatchEvent(up);
    const click = new window.Event('click', { bubbles: true, cancelable: true });
    watch.dispatchEvent(click);
    assert.equal(click.defaultPrevented, false, 'the action still fires: the dock is not a drag surface');
    assert.equal(root.querySelector('.hero-slide.active').dataset.i, '0', 'and a sloppy tap never changes the banner');
  });
});

test('a vertical drag belongs to the page, not the carousel', async () => {
  await withHome(async (root, window) => {
    const hero = root.querySelector('.hero');
    const before = root.querySelector('.hero-slide.active').dataset.i;
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 200; down.clientY = 120;
    const move = new window.Event('pointermove', { bubbles: true }); move.clientX = 206; move.clientY = 320;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 206; up.clientY = 320;
    hero.dispatchEvent(down); hero.dispatchEvent(move); hero.dispatchEvent(up);
    assert.equal(root.querySelector('.hero-slide.active').dataset.i, before, 'scrolling the page never changes the banner');
    assert.equal(hero.classList.contains('is-dragging'), false, 'the carousel never claims a vertical drag');
    assert.deepEqual([...root.querySelectorAll('.hero-slide')].map((slide) => slide.style.transform), ['', ''], 'no banner is dragged sideways');
    const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.hero \{ touch-action: pan-y; \}/, 'touch-action leaves vertical scrolling to the browser');
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
    {
      const list = root.querySelector('.hero-dock [data-list]');
      assert.ok(list.classList.contains('icon-only'), 'My List uses a compact icon button');
      assert.equal(list.querySelector('.lbl'), null, 'the My List text label is removed');
      assert.ok(list.getAttribute('aria-label'), 'the plus/check button stays accessible');
    }
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
    assert.match(css, /\.hero-slide > \.hero-inner a, \.hero-slide > \.hero-inner button \{ pointer-events: auto; \}/, 'the existing hero actions stay clickable above the banner link');
    assert.match(css, /\.hero-slide \{[^}]*transform: translateX\(100%\); transition: transform 1\.2s cubic-bezier/, 'banner slides move slowly with a smooth easing curve');
    assert.match(css, /\.hero-slide\.before \{ transform: translateX\(-100%\); \}/, 'the previous slide moves off to the left');
    assert.match(css, /\.hero-slide\.active \{ visibility: visible; transform: translateX\(0\); z-index: 2; \}/, 'the active banner settles in the frame');
    assert.match(css, /\.hero-slide\.dragging \{ transition: none; \}/, 'a dragged banner follows the finger with no easing in between');
    assert.match(css, /\.hero-slide\.peek \{ visibility: visible; z-index: 2; \}/, 'the neighbour is on screen while it is being dragged in');
    assert.match(css, /\.hero-dock \{[^}]*position: absolute; z-index: 4;[^}]*pointer-events: none; \}/, 'the action dock floats above the banners and lets taps through to the link');
    assert.match(css, /\.hero-dock > a, \.hero-dock > button \{ pointer-events: auto; \}/, 'while its own buttons stay tappable');
  });
});

test('phones fade the banner from the bottom only, leaving the artwork on top clear', async () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  const mobileFrom = css.indexOf('@media (max-width: 759px)');
  assert.ok(mobileFrom > 0, 'the phone breakpoint is there');
  const desktop = css.slice(0, mobileFrom), mobile = css.slice(mobileFrom);

  const fade = css.match(/--hero-fade-mobile:\s*([^;]+);/)?.[1] || '';
  assert.ok(fade, 'the phone fade is defined once, as a token every banner can share');
  assert.match(fade, /^linear-gradient\(0deg/, 'it rises from the bottom edge upwards');
  assert.doesNotMatch(fade, /180deg|90deg|270deg/, 'nothing darkens the poster from the top or from either side');
  assert.match(fade, /var\(--bg\) 0%/, 'it is at its darkest at the very bottom, where the text and actions sit');
  assert.match(fade, /rgba\(5,5,5,0\)\s+7\d%/, 'and it is gone by the upper third, so the artwork up there is untouched');
  assert.ok(css.indexOf('--hero-fade-mobile') > mobileFrom, 'the token only exists for phones');

  assert.match(mobile, /\.hero-shade, \.detail-hero \.hero-shade \{ background: var\(--hero-fade-mobile\); \}/,
    'the home hero and the show / Coming Soon banners share that one fade');
  assert.doesNotMatch(mobile, /^\s*\.hero-shade \{[^}]*background:/m, 'the home hero has no separate phone scrim left');
  assert.doesNotMatch(mobile, /^\s*\.detail-hero \.hero-shade \{[^}]*background:/m, 'and neither does the detail banner');

  assert.match(desktop, /\.hero-shade \{[^}]*linear-gradient\(90deg/, 'desktops keep the side scrim behind the hero text');
  assert.doesNotMatch(desktop, /\.hero-shade \{[^}]*linear-gradient\(180deg/, 'no top scrim: the top of the artwork stays clear');
  assert.match(desktop, /\.hero-shade \{[^}]*linear-gradient\(270deg/, 'a right-side scrim behind the poster edge');
  assert.doesNotMatch(desktop, /--hero-fade-mobile/, 'the phone fade never touches the desktop layout');
});
