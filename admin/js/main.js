// Admin console entry point: sign-in, page frame (sidebar + content), and a tiny hash router (#/users, #/payments, …).
// Pages live in ./views/*.js and are loaded on demand. Only accounts with the admin role get past `start()`.
import { api, getToken, setToken } from './api.js';
import { html, $, $$, icon, toast, errMsg, guard } from './ui.js';
import { mountSocialButtons } from '/app/js/social.js';

// Sidebar menu.
const NAV = [
  ['Overview', [['dashboard', 'Dashboard', 'dashboard']]],
  ['Content', [['shows', 'Shows', 'film'], ['videos', 'Videos & reels', 'tv'], ['upcoming', 'Coming soon', 'clock'], ['gallery', 'Gallery', 'image'], ['studio', 'Studio & team', 'building']]],
  ['Customers', [['users', 'Users', 'users'], ['payments', 'Payments & refunds', 'card'], ['refunds', 'Refund requests', 'refund'], ['coupons', 'Coupons', 'ticket'], ['messages', 'Messages', 'inbox'], ['comments', 'Comments', 'chat']]],
  ['Growth', [['analytics', 'Analytics', 'chart'], ['notifications', 'Broadcast', 'bell']]],
  ['System', [['errors', 'Errors', 'bug'], ['audit', 'Audit log', 'log']]],
];
// URL pattern -> page module. Each module's default export is `render(root, params, ctx)`.
const ROUTES = [
  [/^dashboard$/, () => import('./views/dashboard.js')],
  [/^(shows|videos|upcoming|gallery)$/, () => import('./views/content.js')],
  [/^studio$/, () => import('./views/studio.js')],
  [/^users$/, () => import('./views/users.js')],
  [/^users\/([^/]+)$/, () => import('./views/user.js')],
  [/^payments$/, () => import('./views/payments.js')],
  [/^coupons$/, () => import('./views/coupons.js')],
  [/^messages$/, () => import('./views/messages.js')],
  [/^audit$/, () => import('./views/audit.js')],
  [/^analytics$/, () => import('./views/analytics.js')],
  [/^comments$/, () => import('./views/comments.js')],
  [/^refunds$/, () => import('./views/refunds.js')],
  [/^notifications$/, () => import('./views/notifications.js')],
  [/^errors$/, () => import('./views/errors.js')],
];
// `admin` = the signed-in admin; `navToken` lets a slow page load detect that the user already navigated elsewhere.
const app = $('#app');
let admin = null, navToken = 0;

/* ---------- sign-in ---------- */
function showLogin(message = '', { emailValue = '' } = {}) {
  admin = null;
  app.innerHTML = html`<main class="login"><form class="card login-card" novalidate>
    <img src="/media/icons/logo-96.webp" width="56" height="56" alt="" class="login-logo">
    <h1>ADDABAAZ <span>Admin</span></h1>
    <p class="muted">Sign in with an administrator account.</p>
    ${message ? html`<div class="form-err">${message}</div>` : ''}
    <div class="login-social" id="adminSocial" hidden></div>
    <div class="login-or" id="adminSocialOr" hidden><span>or use your email</span></div>
    <div class="form-err" id="adminSocialError" role="alert" hidden></div>
    <div class="field"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" value="${emailValue}" required></div>
    <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn primary block" type="submit">Sign in</button>
    <p class="small muted">Use a configured social provider or your email and password. This account must already have admin access; ask an existing administrator to grant it if needed.</p>
  </form></main>`.s;
  const form = $('form', app);
  form.email.focus();
  api.authProviders().then((providers) => {
    const box = $('#adminSocial', app);
    if (!box) return;
    const shown = mountSocialButtons(box, providers, {
      onError: (text) => { const status = $('#adminSocialError', app); if (status) { status.textContent = text; status.hidden = false; } },
      onCredential: async (provider, credential) => {
        const status = $('#adminSocialError', app);
        if (status) { status.textContent = ''; status.hidden = true; }
        try { await api.loginSocial(provider, credential); await start(); }
        catch (error) { if (status) { status.textContent = errMsg(error); status.hidden = false; } }
      },
    });
    if (shown) { box.hidden = false; $('#adminSocialOr', app).hidden = false; }
  }).catch((error) => console.warn('[admin] Could not load social providers:', error));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button[type="submit"]', form);
    await guard(btn, async () => {
      try { await api.login(form.email.value.trim(), form.password.value); } catch (x) { return showLogin(x.message, { emailValue: form.email.value }); }
      await start();
    });
  });
}

/* ---------- shell ---------- */
function shell() {
  app.innerHTML = html`<div class="layout">
    <aside class="side" id="side">
      <a class="brand" href="#/dashboard"><img src="/media/icons/logo-96.webp" width="34" height="34" alt=""><span>ADDA<b>BAAZ</b> <small>Admin</small></span></a>
      <nav>${NAV.map(([group, items]) => html`<div class="nav-group"><div class="nav-title">${group}</div>${items.map(([id, label, ic]) => html`<a href="#/${id}" data-nav="${id}">${icon(ic)}<span>${label}</span><i class="count" data-count="${id}" hidden></i></a>`)}</div>`)}</nav>
      <div class="side-foot">
        <div class="who"><span class="avatar">${(admin.name || admin.email)[0].toUpperCase()}</span><div><strong>${admin.name || admin.email}</strong><small>${admin.email}</small></div></div>
        <a class="btn sm block" href="/" target="_blank" rel="noopener">${icon('external', 16)} View site</a>
        <button class="btn sm block" id="logout">${icon('logout', 16)} Sign out</button>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="main-col">
      <header class="topbar"><button class="icon-btn" id="menu" aria-label="Menu">${icon('menu', 22)}</button><strong>ADDABAAZ Admin</strong></header>
      <main id="main" tabindex="-1"></main>
    </div>
  </div>`.s;
  $('#logout').onclick = () => { setToken(null); showLogin('You’re signed out.'); };
  const layout = $('.layout'), side = $('#side'), menu = $('#menu');
  const toggle = (open) => {
    layout.classList.toggle('nav-open', open);
    menu.setAttribute('aria-expanded', String(open));
  };
  menu.setAttribute('aria-controls', 'side'); menu.setAttribute('aria-expanded', 'false');
  menu.onclick = () => toggle(!layout.classList.contains('nav-open'));
  $('#scrim').onclick = () => toggle(false);
  side.addEventListener('click', (e) => { if (e.target.closest('a[data-nav]')) toggle(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
}
export async function refreshCounts() {
  try {
    const [m, inbox] = await Promise.all([api.get('/messages?status=open&limit=1'), api.get('/inbox')]);
    for (const [k, n] of [['messages', m.total], ['comments', inbox.comments], ['refunds', inbox.refunds], ['errors', inbox.errors]]) { const c = $(`[data-count="${k}"]`); if (c) { c.textContent = n; c.hidden = !n; } }
  } catch { /* the badge is a nicety */ }
}

/* ---------- routing ---------- */
// Show the page for the current #hash: highlight the menu, lazy-load the module, run it, and show an error card if it throws.
async function route() {
  if (!admin) return;
  const path = location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard', my = ++navToken;
  const main = $('#main');
  for (const a of $$('[data-nav]')) a.classList.toggle('active', a.dataset.nav === path.split('/')[0]);
  for (const [re, load] of ROUTES) {
    const m = re.exec(path); if (!m) continue;
    main.innerHTML = '<div class="loading"><span class="spin"></span> Loading…</div>';
    try {
      const mod = await load(); if (my !== navToken) return;
      const ctx = { stale: () => my !== navToken, admin, go: (p) => { location.hash = '#/' + p; }, refreshCounts, query: new URLSearchParams(location.hash.split('?')[1] || '') };
      main.innerHTML = ''; await mod.default(main, m.slice(1), ctx);
    } catch (e) {
      if (my !== navToken) return;
      console.error(e);
      main.innerHTML = html`<div class="card error-card"><h2>Something went wrong</h2><p>${errMsg(e)}</p><button class="btn" data-reload>Reload</button></div>`.s;
      main.querySelector('[data-reload]').onclick = () => location.reload();
    }
    main.focus({ preventScroll: true }); window.scrollTo(0, 0); return;
  }
  main.innerHTML = html`<div class="card"><h2>Page not found</h2><p><a href="#/dashboard">Back to the dashboard</a></p></div>`.s;
}

// Boot: no token -> sign-in form; otherwise check /session. 403 means not an admin, 401 means expired.
async function start() {
  if (!getToken()) return showLogin();
  try { admin = (await api.get('/session')).admin; }
  catch (e) {
    if (e.status === 403) { setToken(null); return showLogin(e.code === 'account_disabled' ? e.message : 'This account doesn’t have administrator access. Ask an existing administrator to grant it.', {}); }
    if (e.status === 401) { setToken(null); return showLogin(e.code === 'admin_session_expired' ? e.message : ''); }
    app.innerHTML = html`<main class="login"><div class="card login-card"><h1>Can’t load the console</h1><p class="muted">${errMsg(e)}</p><button class="btn primary" data-reload>Retry</button></div></main>`.s;
    app.querySelector('[data-reload]').onclick = () => location.reload(); return;
  }
  shell(); refreshCounts(); route();
}

// Wire up: navigation, session loss, and start.
window.addEventListener('hashchange', route);
window.addEventListener('admin:auth', (e) => { if (admin) { if (e.detail.status === 401) setToken(null); showLogin(e.detail.message); } });
start();
