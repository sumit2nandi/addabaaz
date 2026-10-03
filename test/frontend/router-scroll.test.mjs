// Navigation scroll. The site sets `html { scroll-behavior: smooth }`, and a plain
// scrollTo({ behavior: 'auto' }) resolves 'auto' to that CSS value - so switching tabs after
// scrolling deep into a long page (Home) played a slow visible scroll-up on the new page. Every
// navigation must land INSTANTLY: the router calls jumpScroll(), which forces the inline
// scroll-behavior to `auto` for that one jump (and asks for `instant` outright).
// Run: node --test test/frontend/router-scroll.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body><main id="view"></main><div id="announcer"></div></body></html>');
globalThis.document = document;
globalThis.window = window;
globalThis.location = { protocol: 'https:', origin: 'https://t.in', pathname: '/', hash: '#/', href: 'https://t.in/#/', search: '' };
window.location = globalThis.location;
globalThis.localStorage = window.localStorage ?? { getItem: () => null, setItem: () => {} };
// linkedom has no session history: the router touches scrollRestoration/pushState/replaceState.
globalThis.history = window.history ?? { scrollRestoration: 'auto', length: 1, state: null, pushState() {}, replaceState() {}, back() {} };
globalThis.fetch = globalThis.fetch || (async () => { throw new Error('offline'); });
window.fetch = globalThis.fetch;
globalThis.screen = { orientation: { angle: 0 } };
globalThis.matchMedia = window.matchMedia = () => ({ matches: false });

// Records every scroll request, plus what the html element's inline scroll-behavior was at that
// moment (that is what makes the jump instant: it beats the stylesheet's `smooth`).
const scrolls = [];
window.scrollTo = (x, y) => {
  scrolls.push(typeof x === 'object' ? { ...x, inline: document.documentElement.style.scrollBehavior } : { top: y, inline: document.documentElement.style.scrollBehavior });
};
Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });

const { jumpScroll, Router } = await import('../../app/js/router.js');
const { app } = await import('../../app/js/app.js');

test('jumpScroll jumps instantly, with the stylesheet smooth-scroll overridden for that one call', () => {
  document.documentElement.style.scrollBehavior = '';
  scrolls.length = 0;
  jumpScroll(1234);
  assert.equal(scrolls.length, 1, 'exactly one scroll request');
  assert.equal(scrolls[0].top, 1234);
  assert.notEqual(scrolls[0].behavior, 'smooth', 'never animates');
  assert.equal(scrolls[0].inline, 'auto', 'the inline override is in place while the jump happens (beats html { scroll-behavior: smooth })');
  assert.equal(document.documentElement.style.scrollBehavior, '', 'and the inline value is put back afterwards');
});

test('jumpScroll survives engines that reject behavior: instant', () => {
  document.documentElement.style.scrollBehavior = '';
  scrolls.length = 0;
  const real = window.scrollTo;
  window.scrollTo = (x, y) => {
    if (typeof x === 'object' && x.behavior === 'instant') throw new TypeError("Failed to read the 'behavior' property: 'instant' is not a valid value");
    scrolls.push(typeof x === 'object' ? { ...x, inline: document.documentElement.style.scrollBehavior } : { top: y, inline: document.documentElement.style.scrollBehavior });
  };
  try {
    jumpScroll(50);
    assert.equal(scrolls.length, 1, 'the fallback still scrolls');
    assert.equal(scrolls[0].top, 50);
    assert.equal(scrolls[0].inline, 'auto', 'with the non-smooth override still in place');
  } finally { window.scrollTo = real; }
});

test('a real navigation jumps instead of animating the scroll-up from the old page', async () => {
  // Hash routing (no server meta tag in this DOM): '/nope' matches no route, which still goes
  // through the same render-and-scroll path as any page.
  const root = document.getElementById('view');
  const router = new Router(root, {});
  assert.equal(globalThis.history.scrollRestoration, 'manual', 'the router owns scroll restoration (the browser must not re-scroll the new page)');
  scrolls.length = 0;
  window.scrollY = 4200;                       // deep into Home before tapping a tab
  globalThis.location.hash = '#/nope-1';
  router.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(scrolls.length >= 1, 'navigating asked for a scroll position');
  const first = scrolls[scrolls.length - 1];
  assert.equal(first.top, 0, 'a fresh page starts at the top');
  assert.notEqual(first.behavior, 'smooth', 'instantly, not with a visible scroll-up animation');
  assert.equal(first.inline, 'auto', 'the smooth CSS cannot animate it');

  // Move on to another tab, then go back: the saved offset comes back - instantly too.
  globalThis.location.hash = '#/nope-2';
  window.dispatchEvent(new window.Event('hashchange'));     // no click: a tab switch is still "fresh" in the app, a Back is not
  await new Promise((r) => setTimeout(r, 30));
  scrolls.length = 0;
  globalThis.location.hash = '#/nope-1';                    // Back to the page we scrolled deep into
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(scrolls.length >= 1, 'going back also asks for a scroll position');
  assert.equal(scrolls[scrolls.length - 1].top, 4200, 'and restores where the page was left');
  for (const s of scrolls) assert.notEqual(s.behavior, 'smooth', 'restores never animate either');

  const src = fs.readFileSync(new URL('../../app/js/router.js', import.meta.url), 'utf8');
  assert.match(src, /jumpScroll\(rerender \? keepY : restore \? this\.#scroll\.get\(key\) \|\| 0 : 0\)/, 'the navigation path uses the instant jump (a re-render keeps the viewer where they are)');
  assert.doesNotMatch(src, /window\.scrollTo\(\{ top: restore/, 'no raw scrollTo left on the navigation path');
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /html \{[^}]*scroll-behavior: smooth/, 'in-page anchors keep their smooth scrolling (that is why the override exists)');
});

test('pointing at a watch link prewarms YouTube without navigating away', async () => {
  let apiChecks = 0;
  Object.defineProperty(window, 'YT', { configurable: true, get() { apiChecks++; return { Player: function Player() {} }; } });
  app.catalog = { video: () => ({ source: { type: 'youtube' } }), reels: () => [] };
  app.user = { gateFor: () => 'ok' };
  const a = document.createElement('a'); a.setAttribute('href', '#/watch/fast-start'); document.body.appendChild(a);
  const before = globalThis.location.hash;
  a.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(apiChecks > 0, 'the IFrame API is warmed before the video link is clicked');
  assert.equal(globalThis.location.hash, before, 'prewarming does not trigger navigation');
  a.remove();
});
