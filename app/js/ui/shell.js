// The page frame: top navigation, mobile bottom tabs, profile menu and footer. It is drawn once; only the <main> area changes between pages.
import { app } from '../app.js';
import { go } from '../router.js';
import { html, $, $$, el } from '../util.js';
import { icon } from '../icons.js';
import { avatar, toast, confirmSignOut } from './components.js';
import { CONFIG } from '../config.js';
import { mayLeaveKids } from './parental.js';

// Menu definitions: [path, label] for the top bar, and [path, label, icon] for the mobile tab bar.
const NAV = [
  ['/', 'Home', 'home'], ['/shows', 'Shows', 'shows'], ['/reels', 'Reels', 'reels'],
  ['/upcoming', 'Coming Soon', 'upcoming'], ['/list', 'My List', 'list'],   // the photo gallery is hidden (app/js/views/gallery.js redirects home)
];
const STUDIO = [['/about', 'About'], ['/services', 'Services'], ['/contact', 'Contact'], ['/support', 'Support']];
const TABS = [['/', 'Home', 'home'], ['/shows', 'Shows', 'tv'], ['/reels', 'Reels', 'reels'], ['/search', 'Search', 'search']];
// Keep a personal destination in the floating bar for every visitor: guests get Sign in; everyone else gets Profile.
const isGuest = () => !!app.user?.supportsAuth && !app.user?.account;
let lastPath = '/';

// Which top-level menu item a URL belongs to (so "/watch/…" highlights the right tab).
const section = (path) => {
  if (path === '/' ) return 'home';
  const seg = path.split('/')[1];
  return { shows: 'shows', show: 'shows', watch: 'shows', reels: 'reels', upcoming: 'upcoming', soon: 'upcoming', list: 'list',
    about: 'studio', services: 'studio', contact: 'studio', support: 'studio', search: 'search', account: 'account', profiles: 'account', plans: 'account', billing: 'account', signin: 'account', signup: 'account' }[seg] || '';
};

/* The floating bar has no Coming Soon item of its own, and upcoming titles are shows too — so a viewer who
 * taps a Coming Soon banner on the home page (or browses #/upcoming) sees the Shows tab light up there,
 * exactly as they would after tapping a released show. The top bar keeps them separate: it has both. */
const tabSection = (path) => { const sec = section(path); return sec === 'upcoming' ? 'shows' : sec; };

// Light haptic tick on menu taps. Only vibrate-capable devices (mostly Android) respond — everywhere else this is a silent no-op.
const tick = () => { try { if (typeof navigator !== 'undefined') navigator.vibrate?.(12); } catch { /* haptics unavailable */ } };

// The header brand wears a superscript premium word for paid subscribers. Synced on boot, on account changes and after every navigation, so it appears right after a purchase with no reload.
function syncBrandPremium() { const s = $('#brandPremium'); if (s) s.hidden = !app.user?.isPremium; }

// Draw the frame and hook up menus and the search box.
export function renderShell() {
  const version = $('#appVersion');
  if (version) version.textContent = `App Version ${CONFIG.version}`;
  $('#topbar').innerHTML = html`
    <a class="brand" href="#/" aria-label="ADDABAAZ home"><img src="media/icons/logo-96.webp" alt="" width="36" height="36"><span class="brand-text"><b>ADDA</b><i>BAAZ</i><em class="premium-word premium-sup" id="brandPremium" aria-hidden="true" hidden>premium</em></span></a>
    <nav class="nav" aria-label="Primary">
      ${NAV.map(([p, l, k]) => html`<a href="#${p}" data-nav="${k}">${l}</a>`)}
      <div class="nav-drop"><button type="button" class="nav-drop-btn" data-nav="studio" aria-haspopup="true" aria-expanded="false">Studio ${icon('right', { size: 14, cls: 'caret' })}</button>
        <div class="menu" hidden>${STUDIO.map(([p, l]) => html`<a href="#${p}">${l}</a>`)}</div></div>
    </nav>
    <div class="top-actions">
      <a class="icon-btn search-link" href="#/search" aria-label="Search" title="Search (/)">${icon('search', { size: 22 })}</a>
      <button type="button" class="btn btn-sm btn-primary" id="installBtn" hidden>${icon('download', { size: 16 })} Install app</button>
      <div class="menu-wrap" id="profileWrap"></div>
    </div>`.s;
  renderProfileMenu();
  wireMenus();
  window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', window.scrollY > 24), { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { e.preventDefault(); go('/search'); }
  });
}

// Bottom tab bar (phones). Keep the personal icon visible for signed-in, signed-out and local-only users.
export function renderTabbar() {
  const bar = $('#tabbar'); if (!bar) return;
  const personalTab = isGuest() ? ['/signin', 'Sign in', 'user'] : ['/account', 'Profile', 'user'];
  const tabs = [...TABS, personalTab];
  bar.style.setProperty('--tabs', tabs.length);
  // 22px icons in a 54px pill: the bar stays finger-sized but reads much thinner than it did at 24px/62px.
  bar.innerHTML = tabs.map(([p, l, ic]) => html`<a href="#${p}" data-tab="${p}">${icon(ic, { size: 22 })}<span>${l}</span></a>`).map(String).join('');
  markTabs(lastPath);
}

// The avatar dropdown: switch profile, account, sign in/out. Re-drawn when the user or profile changes.
export function renderProfileMenu() {
  syncBrandPremium();
  const u = app.user; const wrap = $('#profileWrap'); if (!wrap) return;
  const p = u.profile;
  renderTabbar();
  if (isGuest()) {       // signed out: no profile avatar or profile list, just a neutral icon with sign-in links
    wrap.innerHTML = html`
      <button type="button" class="avatar-btn" id="profileBtn" aria-haspopup="true" aria-expanded="false" aria-label="Sign in and settings"><span class="avatar" style="--av:#444;width:34px;height:34px">${icon('user', { size: 18 })}</span></button>
      <div class="menu menu-right" id="profileMenu" hidden>
        <a class="menu-item" href="#/signin">${icon('user', { size: 18 })}<span>Sign In</span></a>
        <a class="menu-item" href="#/signup">${icon('plus', { size: 18 })}<span>Create Account</span></a>
        <hr>
        <a class="menu-item" href="#/list">${icon('list', { size: 18 })}<span>My List</span></a>
        <a class="menu-item" href="#/plans">${icon('crown', { size: 18 })}<span>Plans</span></a>
        <a class="menu-item" href="#/account">${icon('edit', { size: 18 })}<span>Settings &amp; privacy</span></a>
        <a class="menu-item" href="#/support">${icon('chat', { size: 18 })}<span>Help &amp; Support</span></a>
      </div>`.s;
    return;
  }
  wrap.innerHTML = html`
    <button type="button" class="avatar-btn" id="profileBtn" aria-haspopup="true" aria-expanded="false" aria-label="Profile menu">${p ? avatar(p, { size: 34 }) : html`<span class="avatar" style="--av:#444;width:34px;height:34px">${icon('user', { size: 18 })}</span>`}</button>
    <div class="menu menu-right" id="profileMenu" hidden>
      ${u.profiles.map((x) => html`<button type="button" class="menu-item ${x.id === u.activeId ? 'current' : ''}" data-switch-profile="${x.id}">${avatar(x, { size: 26 })}<span>${x.name}</span>${x.id === u.activeId ? icon('check', { size: 16 }) : ''}</button>`)}
      <a class="menu-item" href="#/profiles?manage=1">${icon('edit', { size: 18 })}<span>Manage Profiles</span></a>
      <hr>
      <a class="menu-item" href="#/list">${icon('list', { size: 18 })}<span>My List</span></a>
      <a class="menu-item" href="#/account">${icon('user', { size: 18 })}<span>Account &amp; settings</span></a>
      <a class="menu-item" href="#/support">${icon('chat', { size: 18 })}<span>Help &amp; Support</span></a>
      ${u.supportsAuth ? html`<a class="menu-item" href="#/plans">${icon('crown', { size: 18 })}<span>Plans</span></a>` : ''}
      ${u.supportsAuth ? (u.account
        ? html`<button type="button" class="menu-item" data-signout>${icon('logout', { size: 18 })}<span>Sign out</span></button>`
        : html`<a class="menu-item" href="#/signin">${icon('user', { size: 18 })}<span>Sign In</span></a>`) : ''}
    </div>`.s;
}

// Open/close dropdowns on click, and close them on outside click or Escape. Leaving a Kids profile asks for the PIN first.
function wireMenus() {
  const closeAll = () => $$('.menu').forEach((m) => { m.hidden = true; m.parentElement.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false'); });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#tabbar a, #topbar a, #topbar button')) tick();
    const btn = e.target.closest('#profileBtn, .nav-drop-btn');
    if (btn) {
      const menu = btn.parentElement.querySelector('.menu'); const open = menu.hidden;
      closeAll(); menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); return;
    }
    const sw = e.target.closest('[data-switch-profile]');
    if (sw) { const t = app.user.profiles.find((x) => x.id === sw.dataset.switchProfile); mayLeaveKids(app.user, t).then((ok) => ok && app.user.selectProfile(t.id)).then((r) => r !== false && location.reload()); return; }
    if (e.target.closest('[data-signout]')) {
      closeAll();
      // Signing out ends the viewer's session — ask first, in the app's confirmation popup.
      confirmSignOut().then((ok) => {
        if (!ok) return;
        app.user.signOut().catch(() => {}).then(() => { toast('Signed Out'); go('/'); });
      });
      return;
    }
    if (!e.target.closest('.menu') || e.target.closest('a.menu-item, a')) closeAll();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}

// Highlight the current section in the nav after each navigation.
function markTabs(path) { const sec = tabSection(path); $$('#tabbar a').forEach((a) => a.classList.toggle('active', tabSection(a.dataset.tab) === sec)); }
export function markActive({ path }) {
  lastPath = path;
  syncBrandPremium();
  const sec = section(path);
  $$('#topbar [data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === sec));
  markTabs(path);
  document.body.dataset.route = path.split('/')[1] || 'home';
}
