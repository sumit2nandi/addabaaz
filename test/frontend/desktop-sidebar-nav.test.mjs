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
  assert.match(rail, /--desktop-nav-width:\s*80px; --desktop-nav-open-width:\s*156px; --desktop-content-left:\s*var\(--desktop-nav-width\)/,
    'main content begins just after the collapsed icon rail');
  assert.match(rail, /\.topbar\s*\{[^}]*width:\s*var\(--desktop-nav-width\)[^}]*height:\s*100vh[^}]*background:\s*transparent[^}]*backdrop-filter:\s*none/s);
  assert.match(rail, /\.topbar::before \{[^}]*opacity: 0; visibility: hidden;[^}]*linear-gradient\(90deg, rgba\(5,5,5,\.92\)[^}]*rgba\(5,5,5,0\) 100%/,
    'the stronger navigation backdrop stays hidden at rest and fades to a transparent edge');
  assert.ok(rail.includes('.topbar:hover, .topbar:has(:focus-visible) { width: var(--desktop-nav-open-width); }'),
    'the entire left rail becomes the hover target and expands to the label boundary');
  assert.doesNotMatch(rail, /\.topbar:focus-within/,
    'a mouse click that leaves focus on a menu link does not pin the desktop rail open');
  assert.ok(rail.includes('.topbar:hover::before, .topbar:has(:focus-visible)::before {'),
    'the fading backdrop appears while the pointer or keyboard focus is inside the rail');
  assert.match(rail, /\.topbar \.brand-text \{[^}]*max-width: none;[^}]*opacity: 1; transform: none;/,
    'the Addabaaz wordmark stays visible while the menu labels are collapsed');
  assert.match(rail, /\.topbar \.brand::before \{[^}]*background: linear-gradient\(90deg, rgba\(5,5,5,\.7\)[^}]*mask-image: linear-gradient\(180deg/,
    'the header lockup keeps a readable fade whether premium text is shown or not');
  assert.doesNotMatch(rail, /\.topbar:hover \.brand-text/,
    'the wordmark does not depend on menu hover');
  assert.match(rail, /\.nav\.primary-nav\s*\{[^}]*flex-direction:\s*column/);
  assert.match(rail, /\.primary-nav \.nav-link \{[^}]*min-height: 56px;[^}]*font-size: 18px;/,
    'desktop menu text is larger and gets a little more vertical room');
  assert.match(rail, /\.primary-nav \.nav-link > svg:first-child \{ width: 32px; height: 32px;/,
    'desktop navigation icons are larger');
  assert.match(rail, /\.hero-inner\s*\{\s*padding-left:\s*var\(--desktop-content-left\)/);
  assert.match(rail, /\.primary-nav \.nav-link > span \{[^}]*max-width: 0;[^}]*opacity: 0;/,
    'menu labels are hidden at rest');
  assert.ok(rail.includes('.topbar:hover .primary-nav .nav-link, .topbar:has(:focus-visible) .primary-nav .nav-link {'),
    'hovering anywhere inside the rail expands every menu row');
  assert.ok(rail.includes('.topbar:hover .primary-nav .nav-link > span, .topbar:has(:focus-visible) .primary-nav .nav-link > span {'),
    'hovering anywhere inside the rail reveals every menu label together');
  assert.ok(rail.includes('color: rgba(255,255,255,.68); font-size: 18px;'),
    'unselected desktop destinations use softened white');
  assert.ok(rail.includes('.primary-nav .nav-link:hover, .primary-nav .nav-link:focus-visible { color: rgba(255,255,255,.88); }'),
    'the hovered icon brightens slightly without becoming pure white');
  assert.ok(rail.includes('.topbar:hover #profileWrap .sidebar-account-link > span:last-child,'),
    'hovering anywhere inside the rail also reveals the Profile label');
  assert.match(rail, /\.primary-nav \.nav-link\.active \{ color: #fff; background: transparent;/,
    'desktop menu icons and text stay white, including the active destination');
  assert.ok(rail.includes('.sidebar-account-link:hover { color: rgba(255,255,255,.88); }'),
    'the desktop Profile label stays soft while hovered');
  assert.ok(rail.includes('.sidebar-account-link.active { color: #fff; font-weight: 800; }'),
    'the desktop Profile label turns bright white when selected');
  assert.ok(rail.includes('padding: 0 8px; border-radius: 9px;'),
    'the Profile row leaves enough room for the full label');
  assert.ok(rail.includes('width: 28px; opacity: 1; pointer-events: auto;'),
    'the Profile disclosure control is compact enough to avoid cropping its label');
  assert.doesNotMatch(rail, /\.nav-drop|\.studio-menu/,
    'desktop-only dropdown menus are absent from the rail');
  assert.match(css, /\.tabbar \{ display: none; \}/, 'desktop hides the floating phone tabs using the existing responsive rule');
  assert.match(css, /@media \(max-width: 899px\) \{\s*\/\* Search is already available in the floating mobile navigation\. \*\/\s*\.topbar \.search-link \{ display: none; \}/,
    'mobile keeps its compact topbar and bottom navigation');
});
