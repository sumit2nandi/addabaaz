import { app } from '../app.js';
import { html, $, $$, el } from '../util.js';
import { icon } from '../icons.js';
import { avatar } from './components.js';
import { CONFIG } from '../config.js';

const NAV = [
  ['/', 'Home', 'home'], ['/shows', 'Shows', 'shows'], ['/reels', 'Reels', 'reels'],
  ['/upcoming', 'Coming Soon', 'upcoming'], ['/gallery', 'Behind the Scenes', 'gallery'], ['/list', 'My List', 'list'],
];
const STUDIO = [['/about', 'About'], ['/services', 'Services'], ['/contact', 'Contact']];
const TABS = [['/', 'Home', 'home'], ['/shows', 'Shows', 'tv'], ['/reels', 'Reels', 'reels'], ['/search', 'Search', 'search'], ['/account', 'Me', 'user']];

const section = (path) => {
  if (path === '/' ) return 'home';
  const seg = path.split('/')[1];
  return { shows: 'shows', show: 'shows', watch: 'shows', reels: 'reels', upcoming: 'upcoming', soon: 'upcoming', gallery: 'gallery', list: 'list',
    about: 'studio', services: 'studio', contact: 'studio', search: 'search', account: 'account', profiles: 'account', plans: 'account', signin: 'account', signup: 'account' }[seg] || '';
};

export function renderShell() {
  $('#topbar').innerHTML = html`
    <a class="brand" href="#/" aria-label="ADDABAAZ home"><img src="media/icons/logo-96.webp" alt="" width="36" height="36"><span class="brand-text"><b>ADDA</b><i>BAAZ</i></span></a>
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
  $('#tabbar').innerHTML = TABS.map(([p, l, ic]) => html`<a href="#${p}" data-tab="${p}">${icon(ic, { size: 24 })}<span>${l}</span></a>`).map(String).join('');
  renderProfileMenu();
  wireMenus();
  window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', window.scrollY > 24), { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { e.preventDefault(); location.hash = '#/search'; }
  });
}

export function renderProfileMenu() {
  const u = app.user; const wrap = $('#profileWrap'); if (!wrap) return;
  const p = u.profile;
  wrap.innerHTML = html`
    <button type="button" class="avatar-btn" id="profileBtn" aria-haspopup="true" aria-expanded="false" aria-label="Profile menu">${p ? avatar(p, { size: 34 }) : html`<span class="avatar" style="--av:#444;width:34px;height:34px">${icon('user', { size: 18 })}</span>`}</button>
    <div class="menu menu-right" id="profileMenu" hidden>
      ${u.profiles.map((x) => html`<button type="button" class="menu-item ${x.id === u.activeId ? 'current' : ''}" data-switch-profile="${x.id}">${avatar(x, { size: 26 })}<span>${x.name}</span>${x.id === u.activeId ? icon('check', { size: 16 }) : ''}</button>`)}
      <a class="menu-item" href="#/profiles?manage=1">${icon('edit', { size: 18 })}<span>Manage profiles</span></a>
      <hr>
      <a class="menu-item" href="#/list">${icon('list', { size: 18 })}<span>My List</span></a>
      <a class="menu-item" href="#/account">${icon('user', { size: 18 })}<span>Account &amp; settings</span></a>
      ${CONFIG.premiumEnabled ? html`<a class="menu-item" href="#/plans">${icon('crown', { size: 18 })}<span>Plans</span></a>` : ''}
      ${u.supportsAuth ? (u.account
        ? html`<button type="button" class="menu-item" data-signout>${icon('logout', { size: 18 })}<span>Sign out</span></button>`
        : html`<a class="menu-item" href="#/signin">${icon('user', { size: 18 })}<span>Sign in</span></a>`) : ''}
    </div>`.s;
}

function wireMenus() {
  const closeAll = () => $$('.menu').forEach((m) => { m.hidden = true; m.parentElement.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false'); });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#profileBtn, .nav-drop-btn');
    if (btn) {
      const menu = btn.parentElement.querySelector('.menu'); const open = menu.hidden;
      closeAll(); menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); return;
    }
    const sw = e.target.closest('[data-switch-profile]');
    if (sw) { app.user.selectProfile(sw.dataset.switchProfile).then(() => location.reload()); return; }
    if (e.target.closest('[data-signout]')) { app.user.signOut().then(() => { location.hash = '#/'; }); }
    if (!e.target.closest('.menu') || e.target.closest('a.menu-item, a')) closeAll();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}

export function markActive({ path }) {
  const sec = section(path);
  $$('#topbar [data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === sec));
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', section(a.dataset.tab) === sec));
  document.body.dataset.route = path.split('/')[1] || 'home';
}
