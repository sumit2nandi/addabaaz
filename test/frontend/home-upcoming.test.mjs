import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

test('homepage releases rotate as detail-linked slides and Recently Added keeps only its parent heading', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.matchMedia = () => ({ matches: false });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.IntersectionObserver = undefined;
  const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  let cleanup;

  try {
    const { app } = await import('../../app/js/app.js');
    const { Catalog } = await import('../../app/js/data/catalog.js');
    const { default: home } = await import('../../app/js/views/home.js');
    const seed = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
    seed.shows = seed.shows.map((show) => ({ ...show, featured: false }));
    seed.upcoming[1].category = 'releasing-this-month';
    app.catalog = new Catalog(seed);
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

    const slides = [...root.querySelectorAll('[data-release-slide]')];
    assert.equal(slides.length, 2, 'each Releasing This Month title becomes a slideshow slide');
    assert.deepEqual(slides.map((slide) => slide.getAttribute('href')), ['#/soon/mayer-golpo', '#/soon/central-calcutta-boarding']);
    assert.equal(root.querySelectorAll('.home-coming-soon .card-soon').length, seed.upcoming.length - 2, 'the Coming Soon row excludes release titles');

    const recent = root.querySelector('.recently-added');
    assert.ok(recent.querySelector('.r-reel .rail-track'));
    assert.ok(recent.querySelector('.r-video .rail-track'));
    assert.deepEqual([...recent.querySelectorAll('h2, h3')].map((heading) => heading.textContent.trim()), ['Recently Added']);

    root.querySelector('[data-release-next]').dispatchEvent(new window.Event('click'));
    assert.equal(slides[1].classList.contains('active'), true, 'the next control advances the slideshow');
    assert.equal(slides[0].getAttribute('aria-hidden'), 'true');
    assert.equal(root.querySelector('[data-release-dot="1"]').getAttribute('aria-selected'), 'true');
  } finally {
    cleanup?.();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
