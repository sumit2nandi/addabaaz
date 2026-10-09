// Front-end entry point (loaded by index.html). Boots the app in this order:
//   1. detect whether an API is available (else run in local-only mode)
//   2. load the catalog and the user's data
//   3. draw the page shell and start the router
//   4. install global click handlers, offline banner, install prompt, service worker.
import { app } from './app.js';
import { CONFIG } from './config.js';
import { $, $$ } from './util.js';
import { loadCatalog } from './data/catalog.js';
import { ApiClient, detectApi, resolveDeviceModel, resolveDeviceId } from './data/api.js';
import { LocalAdapter, RemoteAdapter } from './data/adapters.js';
import { User } from './data/user.js';
import { Router, parseLocation, currentPath, replaceUrl, go } from './router.js';
import { HISTORY } from './mode.js';
import { renderShell, renderProfileMenu, markActive } from './ui/shell.js';
import { syncButtons, scrollRail, toast } from './ui/components.js';
import { initPlatform } from './platform.js';
import { initConsent, trackPage } from './consent.js';
import { initErrorReporting, reportClientError, friendly } from './errors.js';
import { initPush } from './push.js';
import { initClientVersionWatch } from './client-version.js';
import { initMaintenanceWatch } from './maintenance.js';
import { initNotifyPrompt } from './notify-prompt.js';
import { initPullToRefresh } from './ui/ptr.js';
import { initFullscreenRotation } from './orientation.js';

// Where the catalog was read from at start-up (API vs bundled JSON), kept so a pull-to-refresh can
// re-read the same source without a page reload. Filled in by boot().
let catalogSource = null;

// Native-shell hooks and diagnostics must run before boot: initial API/catalog/session failures are still reports.
initPlatform();
initErrorReporting();
// Best-effort device name for the "Your devices" list (cached; heartbeat reads stay synchronous).
resolveDeviceModel();
// Native apps swap the random install id for the OS device identifier (one row per phone in "Your Devices").
resolveDeviceId();

// Start-up sequence. Any failure ends in the friendly error box at the bottom of this file.
async function boot() {
  // Old shared links (/#/show/shahid) → the real URL (/show/shahid) on the website.
  if (HISTORY && location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));
  // Choose the data source: the API (`/api/v1/catalog`) when available, otherwise the static data/catalog.json.
  const base = CONFIG.apiBase;
  const useApi = await detectApi(base);
  app.api = useApi ? new ApiClient(base === 'off' ? '' : base) : null;
  const catalogUrl = useApi ? `${base}/api/v1/catalog` : 'data/catalog.json';
  catalogSource = { url: catalogUrl, mediaBase: useApi ? base : '' };

  const [catalog] = await Promise.all([loadCatalog(catalogUrl, undefined, { mediaBase: useApi ? base : '' })]);
  app.fullCatalog = catalog; app.catalog = catalog;
  // The User object stores data locally and, when an API exists, syncs it to the server (RemoteAdapter).
  app.user = new User(new LocalAdapter(), useApi ? new RemoteAdapter(app.api) : null);
  await app.user.init();
  applyKids();

  renderShell();
  // Create the router, which draws each page into #view.
  const router = app.router = new Router($('#view'), { onRoute: (r) => { markActive(r); syncButtons(document); window.dispatchEvent(new Event('ab:ready')); $('#boot')?.remove(); document.body.classList.add('booted'); } });
  // Pull-to-refresh refreshes through this: see softRefresh() below and app/js/ui/ptr.js.
  app.softRefresh = softRefresh;
  wireGlobalActions();

  app.user.on('library', () => syncButtons(document));
  app.user.on('profile', () => { applyKids(); renderProfileMenu(); });
  app.user.on('account', renderProfileMenu);
  app.user.on('subscription', renderProfileMenu);
  // The API said our token is no longer valid: sign out locally and tell the user.
  window.addEventListener('ab:unauthorized', () => { app.user.signOut().then(() => toast('Your session expired. Please sign in again.')); });

  // Signed-in users with several profiles must pick one first ("Who's watching?").
  if (app.user.needsProfileChoice() && parseLocation().path !== '/profiles') {
    replaceUrl('/profiles?next=' + encodeURIComponent(currentPath()));
  }
  router.start();
  networkStatus();
  initPullToRefresh();   // the custom pull gesture refreshes the current page in place — see softRefresh()
  initFullscreenRotation();   // the app is portrait-only; the screen turns only in video fullscreen
  initConsent(); initPush();
  // Maintenance mode: an open tab or a resumed app shows the maintenance screen the moment the API says so.
  initMaintenanceWatch({ apiBase: base === 'off' ? '' : base });
  // The admin console can invalidate every client's cache; when that reaches us, offer a restart.
  initClientVersionWatch({ apiBase: base === 'off' ? '' : base, onPurge: () => toast('ADDABAAZ was updated — restart the app to load the latest version.', { action: 'Restart', onAction: () => location.reload() }) });
  setNotifyPrompt();
  window.addEventListener('ab:ready', trackPage);
  installPrompt();
  wireImageFallbacks();
  lockMedia();
  registerServiceWorker();
}

/** Pull-to-refresh, done in place (app/js/ui/ptr.js calls this through `app.softRefresh`).
 *
 *  It does the two things a refresh is for — read the catalog again (cache-busting, so anything edited
 *  in Admin appears straight away) and draw the page that is on screen from that fresh data — but
 *  WITHOUT reloading the document. That is the whole point: a reload re-runs start-up from the top, so
 *  the viewer was thrown back to the launch screen, and the page they were looking at vanished while
 *  the catalog came down. Here nothing disappears: the app keeps the same history entry, the same
 *  back-button depth and the same reading position, and only the content is redrawn.
 *
 *  Resolves with what happened, so the gesture knows whether to fall back to a reload:
 *    'refreshed' — the page was redrawn from the freshly read catalog
 *    'stale'     — nothing could be read (offline, server down): the page is untouched and a toast
 *                  explains why, so a failed pull is never worse than not pulling at all
 *    'restart'   — this app is not on the live catalog: only a fresh start can help (see below) */
export async function softRefresh() {
  if (!app.router || !catalogSource) return 'stale';
  // Nothing could be read. The page is left exactly as it was and the viewer is told — this is the
  // "a failed pull is never worse than not pulling" path.
  const stale = (message) => { toast(message); return 'stale'; };
  // No API: the catalog being re-read here is the copy bundled with the app (data/catalog.json), so a
  // title published since the app was built can never appear through it. A fresh start is what helps —
  // boot() re-probes the API (detectApi) and comes up on the live catalog. But a restart must only
  // happen when it would actually get somewhere: this is exactly the state an app is in when its
  // launch happened while the server was unreachable (a cold start, a flaky connection), so the API is
  // re-probed first. Reachable → restart onto the live catalog; still unreachable → keep the page and
  // say so. Offline there is nothing to probe at all.
  if (!app.api) {
    if (navigator.onLine === false) return stale('You’re offline — connect and pull again.');
    const reachable = await detectApi(CONFIG.apiBase);
    return reachable ? 'restart' : stale('Couldn’t reach ADDABAAZ — try again in a moment.');
  }
  let catalog;
  try {
    catalog = await loadCatalog(catalogSource.url, undefined, { mediaBase: catalogSource.mediaBase });
  } catch (err) {
    console.warn('[refresh]', err);
    return stale(friendly(err, 'Couldn’t refresh — check your connection and try again.'));
  }
  // The same hand-off as start-up: the fresh catalog becomes the full one, and a Kids profile
  // re-derives its filtered view from it (applyKids reads app.catalog, so it cannot be left stale).
  app.fullCatalog = catalog;
  app.catalog = catalog;
  applyKids();
  // The studio profile (About / Services / Contact, and the legal pages) is cached in memory by
  // views/studio.js; dropping it makes the pages re-read it while they are redrawn, exactly as a
  // reload would — while a page that does not use it is unaffected.
  app.studio = null;
  // The sign-in and sign-up pages show no catalog data. Redrawing them rebuilds the Google button, which
  // Google draws in only after its script loads, so the viewer saw it jump on every pull. Leave them as they are.
  if (/^\/(signin|signup)\/?$/.test(parseLocation().path)) return 'refreshed';
  await app.router.refresh();                   // redraw the current page from the new catalog
  return 'refreshed';
}

// The first-run "turn on notifications" prompt: once per installation, a few seconds after opening the
// app, and only after routing has settled. `initNotifyPrompt` runs its own guards, so calling it on every
// route change is safe — it waits for a screen the prompt is welcome on. See app/js/notify-prompt.js.
function setNotifyPrompt() {
  const ask = () => { initNotifyPrompt({ path: currentPath() }).catch(() => {}); };
  ask();
  window.addEventListener('ab:ready', ask);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ask(); });
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
    if (e.target.closest('[data-reload]')) { location.reload(); return; }

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
      toast(on ? "We'll remind you when it launches." : 'Reminder Removed');
    }
  }, true);
}

// Shows the "You're offline" banner while the browser has no connection.
function networkStatus() {
  const bar = $('#offlineBar');
  const upd = () => { bar.hidden = navigator.onLine; };
  window.addEventListener('online', upd); window.addEventListener('offline', upd); upd();
}

// Image failure fallbacks (data-fb): used to be inline onerror= handlers, which a strict CSP blocks.
function wireImageFallbacks() {
  window.addEventListener('error', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLImageElement) || t.dataset.fbTried) return;
    t.dataset.fbTried = '1';
    const fb = t.dataset.fb;
    if (fb) t.src = fb; else t.classList.add('img-failed');
  }, true);
}

// Keep images from being saved: right-click/long-press menus and drag-and-drop are blocked everywhere
// except form fields (where people need paste/cut). The CSS also disables text-drag and iOS callouts on <img>.
function lockMedia() {
  const editable = (t) => t?.closest?.('input, textarea, [contenteditable="true"]');
  document.addEventListener('contextmenu', (e) => { if (editable(e.target)) return; e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (editable(e.target)) return; e.preventDefault(); });
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
  // updateViaCache: 'none' — update checks always go straight to the network, so a version bump
  // (sw.js VERSION) reaches users behind proxies/CDNs that ignore Cache-Control.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch((e) => {
    console.warn('[sw]', e);
    reportClientError(e, { where: 'service-worker-register' });
  });
}

// Last resort: show a message instead of a blank page (details stay in the console; the panel gets plain text).
boot().catch((err) => {
  console.error(err);
  reportClientError(err, { where: 'boot' });
  const boot = $('#boot');
  if (boot) boot.innerHTML = `<div class="empty" role="alert"><h2>ADDABAAZ couldn’t start</h2><p>${friendly(err, 'Check your connection and try again.')}</p><button class="btn btn-primary" data-reload>Try Again</button></div>`;
});
