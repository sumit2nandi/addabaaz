import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

// The floating mobile tab bar is pinned: it must not slide up, down, fade or hide while the page - or the
// Reels feed, which scrolls inside its own element - scrolls in either direction.
test('floating mobile tabs stay pinned while scrolling, including the nested Reels feed', async () => {
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
  assert.ok(bar.querySelector('a'), 'the tab bar is drawn');
  assert.equal(bar.querySelectorAll('a').length, 5, 'signed-in visitors see all five tabs');
  assert.equal(bar.querySelector('[data-tab="/account"] span')?.textContent, 'Profile', 'the personal tab is not labelled Me');
  const snapshot = () => JSON.stringify({ cls: bar.getAttribute('class'), style: bar.getAttribute('style') });
  const before = snapshot();

  const reels = document.createElement('div');
  reels.className = 'reels-feed';
  document.body.appendChild(reels);
  Object.defineProperties(reels, {
    scrollHeight: { configurable: true, value: 1600 },
    clientHeight: { configurable: true, value: 700 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  const scrollFeed = (position) => {
    reels.scrollTop = position;
    reels.dispatchEvent(new window.Event('scroll', { bubbles: true }));
  };
  const scrollPage = (position) => {
    pageY = position;
    window.dispatchEvent(new window.Event('scroll'));
  };

  // Nested Reels feed: down, further down, back up, back to the top.
  for (const y of [0, 20, 120, 300, 180, 40, 0]) {
    scrollFeed(y);
    assert.equal(bar.classList.contains('scroll-hidden'), false, `Reels feed at ${y}px does not hide the bar`);
    assert.equal(snapshot(), before, `Reels feed at ${y}px leaves the bar untouched`);
  }
  // Whole page: the same sweep.
  for (const y of [0, 20, 200, 900, 500, 12, 0]) {
    scrollPage(y);
    assert.equal(bar.classList.contains('scroll-hidden'), false, `page at ${y}px does not hide the bar`);
    assert.equal(snapshot(), before, `page at ${y}px leaves the bar untouched`);
  }
});

test('signed-out visitors keep the profile icon in the floating bar as a Sign in option', async () => {
  const { app } = await import('../../app/js/app.js');
  const { renderTabbar } = await import('../../app/js/ui/shell.js');
  app.user = { supportsAuth: true, account: null };
  renderTabbar();
  const bar = document.querySelector('#tabbar');
  const personalTab = bar.querySelector('[data-tab="/signin"]');
  assert.equal(bar.querySelectorAll('a').length, 5, 'the signed-out tab bar still has all five items');
  assert.equal(personalTab?.getAttribute('href'), '#/signin', 'the personal tab opens sign-in');
  assert.equal(personalTab?.querySelector('span')?.textContent, 'Sign in');
  assert.ok(personalTab?.querySelector('svg'), 'the user/profile icon remains visible');
});

test('local-only mode labels the personal tab Profile', async () => {
  const { app } = await import('../../app/js/app.js');
  const { renderTabbar } = await import('../../app/js/ui/shell.js');
  app.user = { supportsAuth: false };
  renderTabbar();
  assert.equal(document.querySelector('[data-tab="/account"] span')?.textContent, 'Profile');
});

test('the stylesheet has no scroll-driven hide state for the tab bar', () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.equal(/scroll-hidden/.test(css), false, 'no .scroll-hidden rule remains');
  const rule = css.split('\n').find((line) => line.startsWith('.tabbar {')) || '';
  assert.match(rule, /position:\s*fixed/, 'the tab bar is a fixed (floating) element');
  assert.equal(/transition:/.test(rule), false, 'the tab bar never animates its position');
});

test('header search hides at the floating-menu breakpoint, while both search links remain available in their layouts', () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  const shell = fs.readFileSync(new URL('../../app/js/ui/shell.js', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 899px\) \{\s*\/\*[^]*?\*\/\s*\.topbar \.search-link \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 900px\) \{[^}]*\} \.tabbar \{ display: none; \}/);
  assert.match(shell, /\['\/search', 'Search', 'search'\]/);
  assert.match(shell, /class="icon-btn search-link" href="#\/search"/);
});
