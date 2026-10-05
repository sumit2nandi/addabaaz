import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const seedCatalog = () => JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));

// Renders the home page for a catalog (plain JSON) in a minimal DOM and hands the root element to `check`.
async function withHome(catalogJson, check) {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.matchMedia = () => ({ matches: false });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.IntersectionObserver = undefined;
  const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  const intervals = [];
  globalThis.setInterval = (_fn, ms) => { intervals.push(ms); return intervals.length; };
  globalThis.clearInterval = () => {};
  let cleanup;
  try {
    const { app } = await import('../../app/js/app.js');
    const { Catalog } = await import('../../app/js/data/catalog.js');
    const { default: home } = await import('../../app/js/views/home.js');
    // No featured show -> no hero slide, so the user stub below only needs what the rails use.
    app.catalog = new Catalog({ ...catalogJson, shows: (catalogJson.shows || []).map((show) => ({ ...show, featured: false })) });
    app.user = {
      account: null,
      lib: { progress: {} },
      continueWatching: () => [],
      listItems: () => [],
      recommendations: () => null,
      fraction: () => 0,
      inList: () => false,
      hasReminder: () => false,
    };
    const root = document.createElement('main');
    await home({ root, setTitle() {}, onCleanup(fn) { cleanup = fn; } });
    await check(root, { window, document, intervals });
  } finally {
    cleanup?.();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}

test('homepage releases rotate as detail-linked slides and Recently Added keeps only its parent heading', async () => {
  const seed = seedCatalog();
  seed.upcoming[1].category = 'releasing-this-month';

  await withHome(seed, async (root, { window, intervals }) => {
    const slides = [...root.querySelectorAll('[data-release-slide]')];
    assert.equal(slides.length, 2, 'each Releasing This Month title becomes a slideshow slide');
    assert.deepEqual(slides.map((slide) => slide.getAttribute('href')), ['#/soon/mayer-golpo', '#/soon/central-calcutta-boarding']);
    assert.equal(slides[0].classList.contains('active'), true);
    assert.equal(slides[1].classList.contains('after'), true, 'the next slide waits just off to the right');
    assert.ok(intervals.includes(9000), 'release posters rotate slowly, every nine seconds');
    assert.equal(root.querySelectorAll('.home-coming-soon .card-soon').length, seed.upcoming.length - 2, 'the Coming Soon row excludes release titles');

    const recent = root.querySelector('.recently-added');
    assert.ok(recent.querySelector('.r-reel .rail-track'));
    assert.ok(recent.querySelector('.r-video .rail-track'));
    assert.deepEqual([...recent.querySelectorAll('h2, h3')].map((heading) => heading.textContent.trim()), ['Recently Added']);
    assert.equal(root.querySelectorAll('.rail-sub').length, 0, 'home sections carry no detail text under their headings');

    root.querySelector('[data-release-next]').dispatchEvent(new window.Event('click'));
    assert.equal(slides[1].classList.contains('active'), true, 'the next control advances the slideshow');
    assert.equal(slides[0].classList.contains('before'), true, 'the outgoing poster glides off to the left');
    assert.equal(slides[0].getAttribute('aria-hidden'), 'true');
    assert.equal(root.querySelector('[data-release-dot="1"]').getAttribute('aria-selected'), 'true');

    root.querySelector('[data-release-prev]').dispatchEvent(new window.Event('click'));
    assert.equal(slides[0].classList.contains('active'), true, 'the previous control reverses the slideshow');
    assert.equal(slides[1].classList.contains('after'), true, 'the outgoing poster glides right when moving backwards');
    assert.equal(root.querySelector('[data-release-dot="0"]').getAttribute('aria-selected'), 'true');
  });
});

// A finger/pen drag: press at `from`, move to `to` at the same height, and hold the release back so
// the test can look at what the drag did before it is finished.
function dragOn(target, window) {
  return (from, to, y = 100) => {
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = from; down.clientY = y;
    const move = new window.Event('pointermove', { bubbles: true }); move.clientX = to; move.clientY = y;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = to; up.clientY = y;
    target.dispatchEvent(down); target.dispatchEvent(move);
    return () => target.dispatchEvent(up);
  };
}

test('release posters swipe smoothly and a swipe never opens the poster link', async () => {
  const seed = seedCatalog();
  seed.upcoming = seed.upcoming.slice(0, 2).map((item) => ({ ...item, category: 'releasing-this-month' }));

  await withHome(seed, async (root, { window }) => {
    const carousel = root.querySelector('[data-release-carousel]');
    const slides = [...root.querySelectorAll('[data-release-slide]')];
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 300; down.clientY = 100;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 120; up.clientY = 100;
    carousel.dispatchEvent(down); carousel.dispatchEvent(up);
    assert.equal(slides[1].classList.contains('active'), true, 'a left swipe advances to the next release');
    assert.equal(slides[0].classList.contains('before'), true, 'the previous artwork moves left');
    const click = new window.Event('click', { bubbles: true, cancelable: true });
    slides[1].dispatchEvent(click);
    assert.equal(click.defaultPrevented, true, 'the swipe does not accidentally follow the poster link');
  });
});

test('a drag carries the incoming release along with the finger, in both directions', async () => {
  const seed = seedCatalog();
  seed.upcoming = seed.upcoming.slice(0, 3).map((item) => ({ ...item, category: 'releasing-this-month' }));

  await withHome(seed, async (root, { window }) => {
    const carousel = root.querySelector('[data-release-carousel]');
    const slides = [...root.querySelectorAll('[data-release-slide]')];
    const drag = dragOn(carousel, window);
    const offsets = () => slides.map((slide) => slide.style.transform);

    // Forwards: the finger travels left, so the next release slides in from the right.
    let release = drag(300, 190);
    assert.equal(slides[1].classList.contains('peek'), true, 'the next release is on screen during the drag');
    assert.equal(slides[1].getAttribute('aria-hidden'), 'false', 'and it is exposed while it is visible');
    assert.equal(slides[0].classList.contains('dragging'), true, 'the release under the finger follows it');
    assert.equal(slides[1].classList.contains('dragging'), true, 'so does the incoming one');
    assert.deepEqual(offsets(), ['translate3d(-110px,0,0)', 'translate3d(calc(100% - 110px),0,0)', ''],
      'the pair moves together, one frame apart');
    assert.equal(carousel.classList.contains('is-dragging'), true, 'the slideshow knows a drag is in progress');
    release();
    assert.equal(slides[1].classList.contains('active'), true, 'the drag finishes on the next release');
    assert.deepEqual(offsets(), ['', '', ''], 'the inline offsets go back to the CSS transition');
    assert.equal(carousel.classList.contains('is-dragging'), false, 'and the drag is over');

    // Backwards: the finger travels right, so the previous release comes back in from the left.
    release = drag(120, 260);
    assert.equal(slides[0].classList.contains('peek'), true, 'the previous release is on screen during the back drag');
    assert.deepEqual(offsets(), ['translate3d(calc(-100% + 140px),0,0)', 'translate3d(140px,0,0)', ''],
      'it waits one frame to the left and moves with the finger');
    release();
    assert.equal(slides[0].classList.contains('active'), true, 'the back drag finishes on the previous release');
    assert.deepEqual(offsets(), ['', '', ''], 'and the movement is handed back to the transition again');

    // A drag that does not go far enough leaves the slide alone.
    release = drag(300, 284);
    assert.equal(slides[1].classList.contains('peek'), true, 'the neighbour shows while the finger is down');
    release();
    assert.equal(slides[0].classList.contains('active'), true, 'a short drag does not change the release');
    assert.equal(slides[1].classList.contains('peek'), false, 'the neighbour is tucked away again');
    assert.deepEqual(offsets(), ['', '', ''], 'both glide back with the normal transition');
  });
});

test('a drag on the releases, like a swipe, never opens the poster link', async () => {
  const seed = seedCatalog();
  seed.upcoming = seed.upcoming.slice(0, 2).map((item) => ({ ...item, category: 'releasing-this-month' }));

  await withHome(seed, async (root, { window }) => {
    const slides = [...root.querySelectorAll('[data-release-slide]')];
    dragOn(root.querySelector('[data-release-carousel]'), window)(300, 150)();   // press, move, release
    const click = new window.Event('click', { bubbles: true, cancelable: true });
    slides[1].dispatchEvent(click);
    assert.equal(click.defaultPrevented, true, 'the click left behind by the drag does not open the release page');
    const tap = new window.Event('click', { bubbles: true, cancelable: true });
    slides[1].dispatchEvent(tap);
    assert.equal(tap.defaultPrevented, false, 'the next genuine tap still opens it');
  });
});

test('the arrows stay tappable: a press on one is never a swipe', async () => {
  const seed = seedCatalog();
  seed.upcoming = seed.upcoming.slice(0, 2).map((item) => ({ ...item, category: 'releasing-this-month' }));

  await withHome(seed, async (root, { window }) => {
    const arrow = root.querySelector('[data-release-next]');
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 320; down.clientY = 100;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 220; up.clientY = 100;   // a thumb that slipped
    arrow.dispatchEvent(down); arrow.dispatchEvent(up);
    const click = new window.Event('click', { bubbles: true, cancelable: true });
    arrow.dispatchEvent(click);
    assert.equal(click.defaultPrevented, false, 'the arrow click is not swallowed by the swipe handler');
    const slides = [...root.querySelectorAll('[data-release-slide]')];
    assert.equal(slides[1].classList.contains('active'), true, 'so the arrow still advances the slideshow');
  });
});

test('a vertical drag on the releases scrolls the page instead of moving the slideshow', async () => {
  const seed = seedCatalog();
  seed.upcoming = seed.upcoming.slice(0, 2).map((item) => ({ ...item, category: 'releasing-this-month' }));

  await withHome(seed, async (root, { window }) => {
    const carousel = root.querySelector('[data-release-carousel]');
    const slides = [...root.querySelectorAll('[data-release-slide]')];
    const down = new window.Event('pointerdown', { bubbles: true }); down.clientX = 200; down.clientY = 120;
    const move = new window.Event('pointermove', { bubbles: true }); move.clientX = 205; move.clientY = 300;
    const up = new window.Event('pointerup', { bubbles: true }); up.clientX = 205; up.clientY = 300;
    carousel.dispatchEvent(down); carousel.dispatchEvent(move); carousel.dispatchEvent(up);
    assert.equal(slides[0].classList.contains('active'), true, 'scrolling the page never changes the release on screen');
    assert.equal(carousel.classList.contains('is-dragging'), false, 'the slideshow never claims a vertical drag');
    assert.deepEqual(slides.map((slide) => slide.style.transform), ['', ''], 'no artwork is dragged sideways');
    const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.home-release-carousel \{[^}]*touch-action: pan-y/, 'touch-action leaves vertical scrolling to the browser');
  });
});

test('release slides show the whole landscape artwork, uncovered, using the widest artwork available', async () => {
  const seed = seedCatalog();
  const base = { type: 'series', category: 'releasing-this-month' };
  seed.upcoming = [
    { ...base, id: 'only-card', title: 'Only card', poster: 'media/upcoming/card.webp' },
    { ...base, id: 'has-large', title: 'Has large', poster: 'media/upcoming/card.webp', posterLg: 'media/upcoming/large.webp' },
    { ...base, id: 'has-wide', title: 'Has wide', titleEn: 'Has wide (English)', poster: 'media/upcoming/card.webp', posterLg: 'media/upcoming/large.webp', backdrop: 'media/upcoming/wide.webp' },
  ];

  await withHome(seed, async (root) => {
    const slides = [...root.querySelectorAll('[data-release-slide]')];
    assert.equal(slides.length, 3);
    const art = (slide) => slide.querySelector('img.home-release-art')?.getAttribute('src');
    assert.deepEqual(slides.map(art), ['media/upcoming/card.webp', 'media/upcoming/large.webp', 'media/upcoming/wide.webp'],
      'backdrop first, then the large poster, then the card poster (the same order as the title page)');
    for (const slide of slides) {
      assert.equal(slide.querySelectorAll('img.home-release-art').length, 1, 'exactly one artwork image per slide');
      assert.equal(slide.querySelector('img.home-release-bg')?.getAttribute('src'), art(slide), 'the blurred fill is a copy of the same artwork');
      assert.equal(slide.querySelector('img.home-release-bg')?.getAttribute('alt'), '', 'the blurred fill is decorative');
      assert.equal(slide.querySelector('.home-release-title, .home-release-badge, .home-release-shade'), null,
        'nothing is drawn over the poster: it already carries its own title and logo');
    }
    assert.equal(slides[2].getAttribute('aria-label'), 'Has wide (English) — Releasing This Month', 'the slide is still named for screen readers');
    assert.equal(slides[0].querySelector('img.home-release-art').getAttribute('loading'), null, 'the first slide loads at once');
    assert.equal(slides[1].querySelector('img.home-release-art').getAttribute('loading'), 'lazy', 'later slides load lazily');
  });
});

test('the slideshow frame is a 16:9 landscape box that never crops the artwork', () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  const block = (selector) => {
    const line = css.split('\n').find((l) => l.startsWith(`${selector} {`));
    return line ? line.slice(line.indexOf('{') + 1, line.lastIndexOf('}')) : '';
  };
  const frame = block('.home-release-carousel');
  assert.match(frame, /aspect-ratio:\s*16\s*\/\s*9/, 'a landscape frame');
  assert.equal(/aspect-ratio:\s*2\s*\/\s*3/.test(frame), false, 'no longer a portrait 2:3 box');
  assert.match(frame, /width:\s*100%/, 'it spans the page content (phones: edge to edge within the page padding)');
  assert.match(block('.home-release-slide'), /transform:\s*translateX\(100%\)/, 'release slides start outside the frame');
  assert.match(block('.home-release-slide'), /transition:\s*transform 1\.2s cubic-bezier/, 'poster movement is slow and smoothly eased');
  assert.match(css, /\.home-release-slide\.before \{ transform: translateX\(-100%\); \}/, 'the previous poster moves off to the left');
  assert.match(css, /\.home-release-slide\.after \{ transform: translateX\(100%\); \}/, 'the next poster waits on the right');
  assert.match(block('.home-release-carousel'), /touch-action:\s*pan-y/, 'horizontal swipes remain available while vertical page scrolling stays native');
  assert.match(block('.home-release-art'), /object-fit:\s*contain/, 'the artwork is contained, never cropped');
  assert.match(block('.home-release-bg'), /filter:\s*blur/, 'any leftover space is a blurred copy of the artwork');
  assert.equal(/\.home-release-(title|badge|shade)/.test(css), false, 'no overlay rules are left behind');
  assert.match(css, /\.home-release-slide\.dragging \{ transition: none; \}/, 'a dragged release follows the finger with no easing in between');
  assert.match(css, /\.home-release-slide\.peek \{ visibility: visible; z-index: 2; \}/, 'the incoming release is on screen while it is being dragged in');
});
