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

initPlatform();

async function boot() {
  // Old shared links (/#/show/shahid) → the real URL (/show/shahid) on the website.
  if (HISTORY && location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));
  const base = CONFIG.apiBase;
  const useApi = await detectApi(base);
  app.api = useApi ? new ApiClient(base === 'off' ? '' : base) : null;
  const catalogUrl = useApi ? `${base}/api/v1/catalog` : 'data/catalog.json';

  const [catalog] = await Promise.all([loadCatalog(catalogUrl, undefined, { mediaBase: useApi ? base : '' })]);
  app.catalog = catalog;
  app.user = new User(new LocalAdapter(), useApi ? new RemoteAdapter(app.api) : null);
  await app.user.init();

  renderShell();
  const router = app.router = new Router($('#view'), { onRoute: (r) => { markActive(r); syncButtons(document); window.dispatchEvent(new Event('ab:ready')); $('#boot')?.remove(); } });
  wireGlobalActions();

  app.user.on('library', () => syncButtons(document));
  app.user.on('profile', renderProfileMenu);
  app.user.on('account', renderProfileMenu);
  window.addEventListener('ab:unauthorized', () => { app.user.signOut().then(() => toast('Your session expired. Please sign in again.')); });

  if (app.user.needsProfileChoice() && parseLocation().path !== '/profiles') {
    replaceUrl('/profiles?next=' + encodeURIComponent(currentPath()));
  }
  router.start();
  networkStatus();
  installPrompt();
  registerServiceWorker();
}

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

function networkStatus() {
  const bar = $('#offlineBar');
  const upd = () => { bar.hidden = navigator.onLine; };
  window.addEventListener('online', upd); window.addEventListener('offline', upd); upd();
}

function installPrompt() {
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $$('#installBtn, [data-install]').forEach((b) => (b.hidden = false)); });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#installBtn, [data-install]') || !deferred) return;
    deferred.prompt(); await deferred.userChoice; deferred = null; $$('#installBtn, [data-install]').forEach((b) => (b.hidden = true));
  });
  window.addEventListener('appinstalled', () => toast('ADDABAAZ installed 🎉'));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || window.Capacitor || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e));
}

boot().catch((err) => {
  console.error(err);
  $('#boot').innerHTML = `<div class="empty"><h2>ADDABAAZ couldn’t start</h2><p>${String(err.message || err)}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
});
