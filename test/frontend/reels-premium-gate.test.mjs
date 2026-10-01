import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

test('premium Reels are visibly marked and never autoplay for a signed-out viewer', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.ADDABAAZ_ENV = {};
  window.YT = { Player() {} }; // keep this DOM-only test from loading YouTube's external player script
  const originalObserver = globalThis.IntersectionObserver;
  const originalRaf = globalThis.requestAnimationFrame;
  let observer;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = () => 1;

  try {
    const { app } = await import('../../app/js/app.js');
    const { Catalog } = await import('../../app/js/data/catalog.js');
    app.catalog = new Catalog({
      shows: [{ id: 'premium-series', title: 'Premium series', access: 'premium' }],
      videos: [{
        id: 'premium-reel', showId: 'premium-series', kind: 'reel', title: 'A reel',
        source: { type: 'youtube', id: 'abcdefghijk' }, duration: 30, publishedAt: '2026-01-01', access: 'free',
      }],
    });
    let streamRequests = 0;
    app.user = {
      gateFor: (video, catalog) => catalog.isPremium(video) ? 'login' : 'ok',
      streamUrl: async () => { streamRequests++; throw new Error('A YouTube reel must not request an R2 stream URL'); },
    };
    const { default: reels } = await import('../../app/js/views/reels.js');
    const root = document.createElement('main');
    document.body.appendChild(root);
    let cleanup;
    await reels({ root, params: {}, setTitle() {}, onCleanup(fn) { cleanup = fn; } });

    const section = root.querySelector('.reel');
    assert.ok(section.querySelector('.premium-mark'), 'the Reel displays the premium indicator');
    observer.callback([{ target: section, isIntersecting: true, intersectionRatio: 1 }]);
    assert.equal(section.querySelector('.reel-gate h2')?.textContent, 'Sign in to watch');
    assert.equal(section.querySelector('.reel-gate a')?.getAttribute('href'), '#/signin?next=%2Freels%2Fpremium-reel');
    assert.equal(section.querySelector('.reel-player'), null, 'locked Reels never create a player');
    assert.equal(streamRequests, 0);
    cleanup?.();
  } finally {
    globalThis.IntersectionObserver = originalObserver;
    globalThis.requestAnimationFrame = originalRaf;
  }
});
