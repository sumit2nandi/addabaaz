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
  const desktopLinks = [...nav.querySelectorAll(':scope > a')].map((a) => a.textContent.trim());
  assert.deepEqual(desktopLinks, [
    'Home', 'Shows', 'Reels', 'Search', 'Free', 'Coming Soon', 'My List',
  ]);
  const desktopCore = [...desktopLinks.slice(0, 4), document.querySelector('#profileWrap .sidebar-account-link > span:last-child').textContent.trim()];
  const floatingMenu = [...document.querySelectorAll('#tabbar a')].map((a) => a.querySelector('span').textContent.trim());
  assert.deepEqual(desktopCore, floatingMenu, 'shared desktop destinations and Profile follow the mobile floating-menu order');
  assert.equal(nav.querySelector('[href="#/shows?access=free"]').dataset.nav, 'free');
  assert.ok(nav.querySelector('[data-nav="search"] svg'), 'Search has a visible icon');
  assert.ok(nav.querySelector('[data-nav="home"] svg'), 'Home has a visible icon');
  assert.ok(nav.querySelector('.nav-drop .studio-menu[aria-hidden="true"] a[href="#/support"]'), 'Studio destinations start hidden in the flyout');
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
  assert.equal(document.querySelector('#sidebarPlan'), null, 'the extra Premium section is removed from the rail');
  assert.equal(document.querySelector('#profileWrap .sidebar-account-link').classList.contains('active'), true,
    'Plans stays associated with the account entry in the sidebar');

  const studioDrop = document.querySelector('.nav-drop');
  const studioButton = document.querySelector('.nav-drop-btn');
  studioDrop.dispatchEvent(new window.Event('pointerenter'));
  assert.equal(studioButton.getAttribute('aria-expanded'), 'true', 'hover opens the Studio flyout');
  assert.equal(document.querySelector('.nav-drop .studio-menu').getAttribute('aria-hidden'), 'false');
  studioDrop.dispatchEvent(new window.Event('pointerleave'));
  assert.equal(studioButton.getAttribute('aria-expanded'), 'false', 'the flyout closes when the pointer leaves');
  studioDrop.dispatchEvent(new window.Event('focusin'));
  assert.equal(studioButton.getAttribute('aria-expanded'), 'true', 'keyboard focus also opens the flyout');
  studioDrop.dispatchEvent(new window.Event('focusout'));
  assert.equal(studioButton.getAttribute('aria-expanded'), 'false', 'the flyout closes when keyboard focus leaves');
  studioButton.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(studioButton.getAttribute('aria-expanded'), 'true', 'click remains available as a fallback');

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
  assert.match(rail, /\.primary-nav \.nav-drop \.menu \{[^}]*opacity: 0; visibility: hidden; transform: translateX\(-8px\)/,
    'Studio details start hidden');
  assert.match(rail, /\.primary-nav \.nav-drop\.open \.menu \{[^}]*opacity: 1; visibility: visible;/,
    'the Studio flyout transitions into view when opened');
  assert.match(read('app/js/ui/shell.js'), /studioDrop\?\.addEventListener\('pointerenter'/,
    'hovering the Studio row opens the flyout');
  assert.match(rail, /\.primary-nav \.nav-link\.active, \.primary-nav \.nav-drop-btn\.active \{ color: #fff; background: transparent;/,
    'active sections no longer get a highlighted pill');
  assert.match(css, /\.tabbar \{ display: none; \}/, 'desktop hides the floating phone tabs using the existing responsive rule');
  assert.match(css, /@media \(max-width: 899px\) \{\s*\/\* Search is already available in the floating mobile navigation\. \*\/\s*\.topbar \.search-link \{ display: none; \}/,
    'mobile keeps its compact topbar and bottom navigation');
});
