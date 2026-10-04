/* Client cache invalidation.
 *
 * The admin console has a "Clear client caches" button (POST /api/v1/admin/cache/purge). It bumps a version
 * counter on the server; every open client checks GET /api/v1/client-version and, when the number it sees is
 * newer than the one it stored, throws away what it cached: the service-worker caches, the offline app shell
 * and the cached catalog JSON. "Scope" lets an admin refresh assets only, or wipe everything a client holds.
 *
 * This module is dependency-free on purpose: the public site (app/js/main.js) and the admin console
 * (admin/js/main.js) both import it, and so does the service worker — see sw.js, which runs the same check
 * on every activation and on request, so a client learns about a purge even before its page reloads.
 */
const VER_KEY = 'ab.clientCacheVersion';     // the version number the last purge was applied for
const SCOPE_KEY = 'ab.clientCacheScope';     // 'assets' (app files) | 'all' (everything this origin cached)

const read = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const write = (key, value) => { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* private mode */ } };

/** Deletes this origin's caches for the given scope. `all` includes the service-worker app shell. */
export async function purgeClientCaches(scope = 'assets') {
  if (!('caches' in window)) return false;
  let names = [];
  try { names = await caches.keys(); } catch { return false; }
  // 'assets': the app's own `ab-*` caches. 'all': every cache this origin owns, including third-party ones.
  const doomed = scope === 'all' ? names : names.filter((n) => n.startsWith('ab-'));
  const gone = await Promise.all(doomed.map((n) => caches.delete(n).catch(() => false)));
  return gone.some(Boolean);
}

/** Asks the server for the current version; on a change, clears what was cached and reports it.
 *  Returns { checked, version, purged, scope } — never throws. */
export async function checkClientVersion({ apiBase = '' } = {}) {
  const out = { checked: false, version: '', purged: false, scope: '' };
  let data;
  try {
    const res = await fetch(`${apiBase}/api/v1/client-version`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return out;
    data = await res.json();
  } catch { return out; }                                    // offline / no API: keep whatever we have
  const version = String(data?.version ?? '').trim();
  if (!version) return out;
  out.checked = true; out.version = version;
  const scope = data.scope === 'all' ? 'all' : 'assets';
  const known = read(VER_KEY);
  if (known === version) { write(SCOPE_KEY, scope); return out; }   // nothing to do — the same generation
  // First ever run has nothing cached from an older generation, so it only records the number.
  if (known) {
    const effective = scope === 'all' || read(SCOPE_KEY) === 'all' ? 'all' : 'assets';
    out.purged = await purgeClientCaches(effective);
    out.scope = effective;
    // Tell the service worker too: an installed PWA has its own caches and its own lifetime.
    try { const reg = await navigator.serviceWorker?.getRegistration?.(); reg?.active?.postMessage({ type: 'ab:purge', scope: effective }); } catch { /* no SW */ }
  } else {
    out.scope = scope;
  }
  write(VER_KEY, version); write(SCOPE_KEY, scope);
  return out;
}

/** Boot-time hook: check once, then again whenever the tab/app comes back to the foreground. */
export function initClientVersionWatch({ apiBase = '', onPurge } = {}) {
  let busy = false;
  const run = async () => {
    if (busy) return; busy = true;
    try {
      // Ask the service worker to re-check too: an installed PWA keeps its own caches and may outlive a purge.
      try { const reg = await navigator.serviceWorker?.getRegistration?.(); reg?.active?.postMessage({ type: 'ab:check-version' }); } catch { /* no SW */ }
      const r = await checkClientVersion({ apiBase });
      if (r.purged) onPurge?.(r);
    } finally { busy = false; }
  };
  run();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  // The service worker can purge on its own (it checks when it activates); it tells us so we can refresh the page.
  navigator.serviceWorker?.addEventListener?.('message', (e) => { if (e.data?.type === 'ab:purged') onPurge?.(e.data); });
}
