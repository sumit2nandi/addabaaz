// Front-end entry point (loaded by index.html). Boots the app in this order:
//   1. detect whether an API is available (else run in local-only mode)
//   2. load the catalog and the user's data
//   3. draw the page shell and start the router
//   4. install global click handlers, offline banner, install prompt, service worker.
import { app } from './app.js';
import { CONFIG } from './config.js';
import { $, $$ } from './util.js';
import { loadCatalog } from './data/catalog.js';
import { ApiClient, detectApi } from './data/api.js';
import { LocalAdapter, RemoteAdapter } from './data/adapters.js';
import { User } from './data/user.js';
import { Router, parseLocation, currentPath, replaceUrl, go } from './router.js';
import { HISTORY } from './mode.js';
import { renderShell, renderProfileMenu, markActive } from './ui/shell.js';
import { syncButtons, scrollRail, toast } from './ui/components.js';
import { initPlatform } from './platform.js';
import { initConsent, trackPage } from './consent.js';
import { initErrorReporting } from './errors.js';
import { initPush } from './push.js';

// Native-shell hooks must run before anything else.
initPlatform();

// Start-up sequence. Any failure ends in the friendly error box at the bottom of this file.
async function boot() {
  // Old shared links (/#/show/shahid) → the real URL (/show/shahid) on the website.
  if (HISTORY && location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));
  // Choose the data source: the API (`/api/v1/catalog`) when available, otherwise the static data/catalog.json.
  const base = CONFIG.apiBase;
  const useApi = await detectApi(base);
  app.api = useApi ? new ApiClient(base === 'off' ? '' : base) : null;
  const catalogUrl = useApi ? `${base}/api/v1/catalog` : 'data/catalog.json';

  const [catalog] = await Promise.all([loadCatalog(catalogUrl, undefined, { mediaBase: useApi ? base : '' })]);
  app.fullCatalog = catalog; app.catalog = catalog;
  // The User object stores data locally and, when an API exists, syncs it to the server (RemoteAdapter).
  app.user = new User(new LocalAdapter(), useApi ? new RemoteAdapter(app.api) : null);
  await app.user.init();
  applyKids();

  renderShell();
  // Create the router, which draws each page into #view.
  const router = app.router = new Router($('#view'), { onRoute: (r) => { markActive(r); syncButtons(document); window.dispatchEvent(new Event('ab:ready')); $('#boot')?.remove(); } });
  wireGlobalActions();

  app.user.on('library', () => syncButtons(document));
  app.user.on('profile', () => { applyKids(); renderProfileMenu(); });
  app.user.on('account', renderProfileMenu);
  // The API said our token is no longer valid: sign out locally and tell the user.
  window.addEventListener('ab:unauthorized', () => { app.user.signOut().then(() => toast('Your session expired. Please sign in again.')); });

  // Signed-in users with several profiles must pick one first ("Who's watching?").
  if (app.user.needsProfileChoice() && parseLocation().path !== '/profiles') {
    replaceUrl('/profiles?next=' + encodeURIComponent(currentPath()));
  }
  router.start();
  networkStatus();
  initConsent(); initErrorReporting(); initPush();
  window.addEventListener('ab:ready', trackPage);
  installPrompt();
  registerServiceWorker();
}

/** A Kids profile browses a filtered catalog (only titles rated U or 7+). */
// Kids profiles see a filtered copy of the catalog and get a `kids` CSS class on <body>.
function applyKids() {
  const kids = app.user.isKids;
  if (kids && !app.catalog.kids) app.catalog = app.fullCatalog.kidsView();
  else if (!kids && app.catalog.kids) app.catalog = app.fullCatalog;
  document.body.classList.toggle('kids', kids);
}

// One delegated click handler for buttons that exist on many pages: carousel arrows, "+ My List" and "Remind me".
function wireGlobalActions() {
  document.addEventListener('click', async (e) => {
    const rb = e.target.closest('[data-rail-dir]');
    if (rb) { scrollRail(rb); return; }

    const lb = e.target.closest('[data-list]');
    if (lb) {
      e.preventDefault(); e.stopPropagation();
      const [type, ...rest] = lb.dataset.list.split(':'); const id = rest.join(':');
      if (!app.user.profile) { toast('Choose a profile first.'); go('/profiles'); return; }
      const added = await app.user.toggleList(type, id);
      toast(added ? 'Added to My List' : 'Removed from My List', { action: 'Undo', onAction: () => app.user.toggleList(type, id) });
      return;
    }
    const rm = e.target.closest('[data-remind]');
    if (rm) {
      e.preventDefault(); e.stopPropagation();
      const on = await app.user.toggleReminder(rm.dataset.remind);
      toast(on ? "We'll remind you when it launches." : 'Reminder removed');
    }
  }, true);
}

// Shows the "You're offline" banner while the browser has no connection.
function networkStatus() {
  const bar = $('#offlineBar');
  const upd = () => { bar.hidden = navigator.onLine; };
  window.addEventListener('online', upd); window.addEventListener('offline', upd); upd();
}

// "Install app" button: capture the browser's install prompt and show it on demand.
function installPrompt() {
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $$('#installBtn, [data-install]').forEach((b) => (b.hidden = false)); });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#installBtn, [data-install]') || !deferred) return;
    deferred.prompt(); await deferred.userChoice; deferred = null; $$('#installBtn, [data-install]').forEach((b) => (b.hidden = true));
  });
  window.addEventListener('appinstalled', () => toast('ADDABAAZ installed 🎉'));
}

// Offline support. Skipped inside native apps and on non-http(s) pages.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || window.Capacitor || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e));
}

// Last resort: show a message instead of a blank page.
boot().catch((err) => {
  console.error(err);
  $('#boot').innerHTML = `<div class="empty"><h2>ADDABAAZ couldn’t start</h2><p>${String(err.message || err)}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
});
