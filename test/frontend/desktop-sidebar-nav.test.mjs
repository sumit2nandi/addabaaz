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

test('desktop rail mirrors only the mobile floating-menu destinations and order', async () => {
  const { document } = await shellFixture();
  const nav = document.querySelector('#topbar .primary-nav');
  assert.equal(nav.getAttribute('aria-label'), 'Primary');
  const desktopLinks = [...nav.querySelectorAll(':scope > a')].map((a) => a.textContent.trim());
  assert.deepEqual(desktopLinks, ['Home', 'Shows', 'Reels', 'Search']);
  const desktopMenu = [...desktopLinks, document.querySelector('#profileWrap .sidebar-account-link > span:last-child').textContent.trim()];
  const floatingMenu = [...document.querySelectorAll('#tabbar a')].map((a) => a.querySelector('span').textContent.trim());
  assert.deepEqual(desktopMenu, floatingMenu, 'desktop and mobile expose exactly the same destinations in the same order');
  assert.equal(nav.querySelectorAll(':scope > a').length, 4, 'no desktop-only destinations appear in the rail');
  assert.equal(nav.querySelector('.nav-drop'), null, 'the Studio dropdown is not in the navigation rail');
  assert.ok(nav.querySelector('[data-nav="search"] svg'), 'Search has a visible icon');
  assert.ok(nav.querySelector('[data-nav="home"] svg'), 'Home has a visible icon');
  assert.equal(document.querySelector('#profileWrap .sidebar-account-link').getAttribute('href'), '#/account');
  assert.equal(document.querySelector('#tabbar').querySelectorAll('a').length, 5, 'the mobile tabs remain present and profile-aware');
});

test('guest rail mirrors the mobile Sign in destination and retains its menu', async () => {
  const { document, window } = await shellFixture({ account: null });
  const login = document.querySelector('#profileWrap .sidebar-account-link');
  assert.equal(login.getAttribute('href'), '#/signin');
  assert.equal(login.querySelector(':scope > span:last-child').textContent.trim(), 'Sign in');
  assert.equal(document.querySelector('#tabbar [data-tab="/signin"]').textContent.trim(), 'Sign in');
  const desktopMenu = [...document.querySelectorAll('#topbar .primary-nav > a')].map((a) => a.textContent.trim());
  desktopMenu.push(login.querySelector(':scope > span:last-child').textContent.trim());
  const floatingMenu = [...document.querySelectorAll('#tabbar a')].map((a) => a.querySelector('span').textContent.trim());
  assert.deepEqual(desktopMenu, floatingMenu, 'guest navigation uses the same destinations and labels on desktop and mobile');
  document.querySelector('#profileBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(document.querySelector('#profileMenu').hidden, false);
  assert.ok(document.querySelector('#profileMenu a[href="#/signup"]'), 'Create Account remains available');
});

test('desktop rail mirrors active sections from mobile and keeps the profile menu accessible', async () => {
  const { document, window, markActive } = await shellFixture();
  markActive({ path: '/shows', query: { access: 'free' } });
  assert.equal(document.querySelector('#topbar [data-nav="shows"]').classList.contains('active'), true,
    'the Free filter shares the Shows destination like it does on mobile');
  assert.equal(document.querySelector('#topbar [data-nav="shows"]').getAttribute('aria-current'), 'page');
  assert.equal(document.querySelector('#topbar [data-nav="free"]'), null);
  markActive({ path: '/upcoming' });
  assert.equal(document.querySelector('#topbar [data-nav="shows"]').classList.contains('active'), true,
    'upcoming titles also map to Shows in both menus');
  markActive({ path: '/plans' });
  assert.equal(document.querySelector('#profileWrap .sidebar-account-link').classList.contains('active'), true,
    'account routes stay associated with the Profile entry');

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
  assert.match(rail, /background: linear-gradient\(90deg, rgba\(5,5,5,\.92\) 0%, rgba\(5,5,5,\.86\) 48%, rgba\(5,5,5,\.62\) 72%[^;]*rgba\(5,5,5,0\) 100%/,
    'the rail fades smoothly from a readable dark edge into the page artwork');
  assert.match(rail, /\.topbar \.brand-text \{[^}]*max-width: none;[^}]*opacity: 1; transform: none;/,
    'the Addabaaz wordmark stays visible while the menu labels are collapsed');
  assert.doesNotMatch(rail, /\.topbar:hover \.brand-text/,
    'the wordmark does not depend on menu hover');
  assert.match(rail, /\.nav\.primary-nav\s*\{[^}]*flex-direction:\s*column/);
  assert.match(rail, /\.hero-inner\s*\{\s*padding-left:\s*var\(--desktop-content-left\)/);
  assert.match(rail, /\.primary-nav \.nav-link > span \{[^}]*max-width: 0;[^}]*opacity: 0;/,
    'menu labels are hidden at rest');
  assert.match(rail, /\.topbar:hover \.primary-nav \.nav-link > span[\s\S]*max-width: 180px; opacity: 1;/,
    'hover reveals the labels with a transition');
  assert.match(rail, /\.primary-nav \.nav-link\.active \{ color: var\(--accent-2\); background: transparent;/,
    'desktop active links use the same red as the mobile floating menu');
  assert.match(rail, /\.sidebar-account-link:hover, \.sidebar-account-link\.active \{ background: transparent; color: var\(--accent-2\); \}/,
    'the desktop Profile entry uses the same red active state');
  assert.doesNotMatch(rail, /\.nav-drop|\.studio-menu/,
    'desktop-only dropdown menus are absent from the rail');
  assert.match(css, /\.tabbar \{ display: none; \}/, 'desktop hides the floating phone tabs using the existing responsive rule');
  assert.match(css, /@media \(max-width: 899px\) \{\s*\/\* Search is already available in the floating mobile navigation\. \*\/\s*\.topbar \.search-link \{ display: none; \}/,
    'mobile keeps its compact topbar and bottom navigation');
});
