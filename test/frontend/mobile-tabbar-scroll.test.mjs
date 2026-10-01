import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

test('floating mobile tabs hide on downward scroll and return on upward scroll, including the nested Reels feed', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><header id="topbar"></header><nav id="tabbar" class="tabbar"></nav><main id="view"></main></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.ADDABAAZ_ENV = {};
  let pageY = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => pageY });

  const { app } = await import('../../app/js/app.js');
  const { renderShell } = await import('../../app/js/ui/shell.js');
  app.user = {
    supportsAuth: true,
    account: { id: 'test' },
    profile: { id: 'profile', name: 'Viewer', color: 0 },
    profiles: [{ id: 'profile', name: 'Viewer', color: 0 }],
    activeId: 'profile',
  };
  renderShell();
  const bar = document.querySelector('#tabbar');
  const reels = document.createElement('div');
  reels.className = 'reels-feed';
  document.body.appendChild(reels);
  Object.defineProperties(reels, {
    scrollHeight: { configurable: true, value: 1600 },
    clientHeight: { configurable: true, value: 700 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  const scroll = (element, position) => {
    element.scrollTop = position;
    element.dispatchEvent(new window.Event('scroll', { bubbles: true }));
  };

  scroll(reels, 0); // seed this nested scroll source
  scroll(reels, 20);
  assert.equal(bar.classList.contains('scroll-hidden'), true, 'scrolling down in Reels tucks the bar away');
  scroll(reels, 12);
  assert.equal(bar.classList.contains('scroll-hidden'), false, 'scrolling up in Reels brings the bar back');

  pageY = 0;
  window.dispatchEvent(new window.Event('scroll'));
  pageY = 20;
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(bar.classList.contains('scroll-hidden'), true, 'page scrolling down also hides the bar');
  pageY = 12;
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(bar.classList.contains('scroll-hidden'), false, 'page scrolling up restores the bar');
});
