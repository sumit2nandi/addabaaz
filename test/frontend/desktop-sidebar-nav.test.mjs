import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

async function shellFixture(user = {}) {
  const { document, window } = parseHTML('<!doctype html><html><body><header id="topbar" class="topbar"></header><main id="view"></main><footer id="footer"></footer><nav id="tabbar" class="tabbar"></nav></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.ADDABAAZ_ENV = {};
  const { app } = await import('../../app/js/app.js');
  const { renderShell, markActive } = await import('../../app/js/ui/shell.js');
  app.user = {
    supportsAuth: true,
    account: { id: 'test' },
    profile: { id: 'profile', name: 'Viewer', color: 0 },
    profiles: [{ id: 'profile', name: 'Viewer', color: 0 }],
    activeId: 'profile',
    ...user,
  };
  renderShell();
  return { document, window, markActive };
}

test('desktop rail includes labeled destinations, a Free filter, Studio submenu and direct profile link', async () => {
  const { document } = await shellFixture();
  const nav = document.querySelector('#topbar .primary-nav');
  assert.equal(nav.getAttribute('aria-label'), 'Primary');
  assert.deepEqual([...nav.querySelectorAll(':scope > a')].map((a) => a.textContent.trim()), [
    'Search', 'Home', 'Shows', 'Free', 'Reels', 'Coming Soon', 'My List',
  ]);
  assert.equal(nav.querySelector('[href="#/shows?access=free"]').dataset.nav, 'free');
  assert.ok(nav.querySelector('[data-nav="search"] svg'), 'Search has a visible icon');
  assert.ok(nav.querySelector('[data-nav="home"] svg'), 'Home has a visible icon');
  assert.ok(nav.querySelector('.nav-drop .menu[hidden] a[href="#/support"]'), 'Studio destinations remain available in its submenu');
  assert.equal(document.querySelector('#profileWrap .sidebar-account-link').getAttribute('href'), '#/account');
  assert.equal(document.querySelector('#tabbar').querySelectorAll('a').length, 5, 'the mobile tabs remain present and profile-aware');
});

test('guest rail provides a direct Login link and retains the sign-in menu', async () => {
  const { document, window } = await shellFixture({ account: null });
  const login = document.querySelector('#profileWrap .sidebar-account-link');
  assert.equal(login.getAttribute('href'), '#/signin');
  assert.equal(login.textContent.trim(), 'Login');
  assert.equal(document.querySelector('#tabbar [data-tab="/signin"]').textContent.trim(), 'Sign in');
  document.querySelector('#profileBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(document.querySelector('#profileMenu').hidden, false);
  assert.ok(document.querySelector('#profileMenu a[href="#/signup"]'), 'Create Account remains available');
});

test('desktop rail updates active items and opens both accessible menus', async () => {
  const { document, window, markActive } = await shellFixture();
  markActive({ path: '/shows', query: { access: 'free' } });
  assert.equal(document.querySelector('#topbar [data-nav="free"]').classList.contains('active'), true);
  assert.equal(document.querySelector('#topbar [data-nav="shows"]').classList.contains('active'), false);
  assert.equal(document.querySelector('#topbar [data-nav="free"]').getAttribute('aria-current'), 'page');
  markActive({ path: '/plans' });
  assert.equal(document.querySelector('#sidebarPlan').classList.contains('active'), true, 'Plans highlights its subscription CTA');
  assert.equal(document.querySelector('#profileWrap .sidebar-account-link').classList.contains('active'), false);

  const studioButton = document.querySelector('.nav-drop-btn');
  studioButton.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(studioButton.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector('.nav-drop .menu').hidden, false);
  studioButton.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(document.querySelector('.nav-drop .menu').hidden, true);

  const profileButton = document.querySelector('#profileBtn');
  profileButton.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(profileButton.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector('#profileMenu').hidden, false);
});

test('desktop-only styling makes a fixed left rail without changing phone navigation', () => {
  const css = read('app/css/styles.css');
  const rail = css.slice(css.lastIndexOf('/* ---------- desktop streaming-style navigation rail ---------- */'));
  assert.match(rail, /@media \(min-width: 900px\)/);
  assert.match(rail, /--desktop-nav-width:\s*clamp\(/);
  assert.match(rail, /\.topbar\s*\{[^}]*width:\s*var\(--desktop-nav-width\)[^}]*height:\s*100vh/s);
  assert.match(rail, /\.nav\.primary-nav\s*\{[^}]*flex-direction:\s*column/);
  assert.match(rail, /\.hero-inner\s*\{\s*padding-left:\s*var\(--desktop-content-left\)/);
  assert.match(rail, /\.sidebar-premium, \.sidebar-account-link, \.desktop-profile-arrow \{ display: none; \}/,
    'desktop-only labels and CTA are hidden in the default mobile shell');
  assert.match(css, /\.tabbar \{ display: none; \}/, 'desktop hides the floating phone tabs using the existing responsive rule');
  assert.match(css, /@media \(max-width: 899px\) \{\s*\/\* Search is already available in the floating mobile navigation\. \*\/\s*\.topbar \.search-link \{ display: none; \}/,
    'mobile keeps its compact topbar and bottom navigation');
});
