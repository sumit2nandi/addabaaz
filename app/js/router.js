import { app } from './app.js';
import { html } from './util.js';
import { icon } from './icons.js';
import { HISTORY } from './mode.js';
import { matchRoute } from './routes.js';
import { applyHead } from './seo/head.js';
import { pageMeta } from './seo/meta.js';
import { friendly } from './errors.js';

/** Current in-app location as { path, query } — from the URL path on the website, from the #fragment in static/native builds. */
// `query` is the parsed ?a=b part as a plain object.
export function parseLocation() {
  const raw = HISTORY ? location.pathname + location.search : location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}
// Old name kept for older imports.
export const parseHash = parseLocation;
/** '/show/x?y=1' for the current page (what you'd pass to go()). */
export const currentPath = () => (HISTORY ? location.pathname + location.search : location.hash.replace(/^#/, '') || '/');
// Builds the address for the current URL style.
const urlFor = (path) => (HISTORY ? path : '#' + path);

// `go(path)` navigates; with `replace` it swaps the current history entry instead of adding one.
let replaceNext = false;
export function go(path, { replace = false } = {}) {
  if (HISTORY) {
    if (replace) { replaceNext = true; history.replaceState(null, '', path); } else history.pushState(null, '', path);
    window.dispatchEvent(new CustomEvent('ab:navigate', { detail: { replace } }));
  } else if (replace) { replaceNext = true; history.replaceState(null, '', '#' + path); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else location.hash = path;
}
/** Change the address bar without navigating (filters, search text). */
// Used for filters and search text.
export function replaceUrl(path) { history.replaceState(history.state, '', urlFor(path)); }
// Go back if the app has history of its own, otherwise to a fallback page (so Back never leaves the site).
export function back(fallback = '/') { if (history.length > 1 && window.__navDepth > 0) history.back(); else go(fallback, { replace: true }); }

/* On the website, links written as href="#/show/x" become real hrefs (/show/x) so crawlers, "open in new tab" and
 * copy-link all see proper URLs. Runs on everything the app renders. */
// Also runs on content added later, via the observer below.
function rewriteLinks(root) {
  if (root.nodeType !== 1) return;
  const fix = (a) => { const h = a.getAttribute('href'); if (h && h.startsWith('#/')) a.setAttribute('href', h.slice(1)); };
  if (root.matches?.('a[href^="#/"]')) fix(root);
  root.querySelectorAll?.('a[href^="#/"]').forEach(fix);
}

// Warm the lazy page module and YouTube API as soon as a viewer points at or focuses a video link.
// On touch devices this begins at touchstart, before the click changes routes.
const warmedVideoAnchors = new WeakSet();
function prewarmVideoAnchor(event) {
  const a = event.target?.closest?.('a[href]');
  if (!a || warmedVideoAnchors.has(a) || a.target || a.hasAttribute('download')) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = a.getAttribute('href') || '';
  const path = (href.startsWith('#/') ? href.slice(1) : href).split(/[?#]/)[0];
  if (!path.startsWith('/') || path.startsWith('//')) return;
  const route = matchRoute(path);
  if (!route || (route.view !== 'watch' && route.view !== 'reels')) return;
  warmedVideoAnchors.add(a);
  if (route.view === 'watch') import('./views/watch.js').catch(() => {});
  else import('./views/reels.js').catch(() => {});

  const cat = app.catalog, user = app.user;
  if (!cat) return;
  const allowed = (v) => v && (!user?.gateFor || user.gateFor(v, cat) === 'ok');
  const mayNeedYouTube = route.view === 'watch'
    ? (() => { const v = cat.video?.(route.params.id); return allowed(v) && v.source?.type === 'youtube'; })()
    : (() => { const v = route.params.id ? cat.video?.(route.params.id) : cat.reels?.()[0]; return allowed(v) && v.source?.type === 'youtube'; })();
  const targetVideo = route.view === 'watch' ? cat.video?.(route.params.id) : null;
  if (allowed(targetVideo) && ['r2', 'hls'].includes(targetVideo.source?.type)) {
    import('./players/html5.js').then(({ prepareHtml5Player }) => prepareHtml5Player(targetVideo.source)).catch(() => {});
  }
  if (mayNeedYouTube) import('./players/index.js').then(({ loadYouTube }) => loadYouTube()).catch(() => {});
}

// Makes normal link clicks navigate inside the app (no page reload); modified clicks (ctrl/cmd/shift, middle button) keep their default browser behaviour.
function installHistoryLinks() {
  rewriteLinks(document.body);
  new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(rewriteLinks); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]'); if (!a || a.target || a.hasAttribute('download')) return;
    if (e.target.closest('button, [role="button"]') && a.contains(e.target.closest('button, [role="button"]'))) return;   // a bookmark/remind button inside a card
    const href = a.getAttribute('href');
    if (href.startsWith('#') && !href.startsWith('#/')) {                       // skip-link etc. (never let <base> turn it into a page load)
      e.preventDefault(); const t = document.getElementById(href.slice(1)); if (t) { t.focus({ preventScroll: false }); t.scrollIntoView(); } return;
    }
    let path = null;
    if (href.startsWith('#/')) path = href.slice(1);
    else if (href.startsWith('/') && !href.startsWith('//') && matchRoute(href.split(/[?#]/)[0])) path = href;
    if (path === null) return;
    e.preventDefault(); go(path);
  });
}

/* Navigation must land on the new page at the top (or back at a saved offset) INSTANTLY. The site
 * sets `html { scroll-behavior: smooth }` for in-page anchors, and a plain
 * `scrollTo({ behavior: 'auto' })` resolves `auto` to that CSS value - so tapping a tab after
 * scrolling deep into a long page played a slow, visible scroll-up on the freshly drawn page. The
 * inline override forces `auto` for this one jump (inline beats the stylesheet), and `instant` says
 * it outright for engines that support it; the inline value is put back right after. */
export function jumpScroll(top) {
  const root = document.documentElement;
  const prev = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  try {
    window.scrollTo({ top, behavior: 'instant' });
  } catch {
    // An engine that does not know 'instant' throws on the enum: plain (now non-smooth) jump instead.
    try { window.scrollTo({ top, behavior: 'auto' }); } catch { window.scrollTo(0, top); }
  } finally {
    root.style.scrollBehavior = prev;
  }
}

// Draws pages. Each navigation: save scroll position, run the old page's cleanups, load the view module for the route, insert its DOM, update the <head> (SEO) and restore scroll.
// A counter (`#token`) makes sure a slow page never overwrites a newer one.
export class Router {
  #cleanups = []; #token = 0; #scroll = new Map(); #lastKey = null; #fresh = true; #depth = 0;
  constructor(root, { onRoute } = {}) {
    this.root = root; this.onRoute = onRoute;
    // The router restores scroll positions itself (the #scroll map below): the browser's own
    // restoration would fight it and re-scroll the freshly drawn page.
    try { history.scrollRestoration = 'manual'; } catch { /* older engine: the jumps still work */ }
    document.addEventListener('pointerover', prewarmVideoAnchor, { passive: true });
    document.addEventListener('touchstart', prewarmVideoAnchor, { passive: true, capture: true });
    document.addEventListener('focusin', prewarmVideoAnchor);
    if (HISTORY) {
      window.addEventListener('popstate', () => { if (this.#keyNow() !== this.#lastKey) this.resolve(); });      // (lightbox pushes same-URL states)
      window.addEventListener('ab:navigate', (e) => { if (!e.detail?.replace) this.#fresh = true; this.resolve(); });
      installHistoryLinks();
    } else {
      window.addEventListener('hashchange', () => this.resolve());
      document.addEventListener('click', (e) => { if (e.target.closest?.('a[href^="#/"]')) this.#fresh = true; }, true);
    }
  }
  #keyNow() { return HISTORY ? location.pathname + location.search : location.hash || '#/'; }
  start() { this.resolve(); }
  /** Redraw the page that is on screen from fresh data — pull-to-refresh (main.js `softRefresh`).
   *  It is NOT a navigation: same URL, same history entry, same back-button depth, same scroll
   *  position. Nothing is reloaded, so the app never replays its launch screen for a refresh. */
  refresh() { return this.resolve({ refresh: true }); }
  // Handle the current URL and restore the saved position for browser-history navigation.
  async resolve({ refresh = false } = {}) {
    const { path, query } = parseLocation();
    const key = this.#keyNow();
    let restore = !this.#fresh;
    // Where the viewer is standing, captured before the page is replaced: a refresh puts them back
    // exactly there, and everything that tracks history is left untouched.
    const holdScroll = refresh ? window.scrollY : null;
    if (refresh) restore = false;
    else {
      if (this.#lastKey !== null) this.#scroll.set(this.#lastKey, window.scrollY);
      if (replaceNext) { restore = false; replaceNext = false; }
      else this.#depth = this.#fresh ? this.#depth + 1 : Math.max(0, this.#depth - 1);
      window.__navDepth = this.#depth;
      this.#fresh = false; this.#lastKey = key;
    }
    const token = ++this.#token;
    this.#cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

    const found = matchRoute(path);
    const match = found ? { view: found.view } : null, params = found?.params || {};

    // Show the centred loader only if the page takes longer than a moment. It is laid OVER the page you
    // are leaving (styles.css keeps it fixed, pointer-transparent and centred in the screen), so a slow
    // page never blanks the screen and the floating menu stays usable while it loads.
    const skeleton = setTimeout(() => { if (token === this.#token) this.root.insertAdjacentHTML('beforeend', PAGE_LOADER); }, 140);
    const div = document.createElement('div');
    div.className = 'view';
    // The context object passed to every view: its root element, URL params/query, a title setter, an
    // `onCleanup` hook and `stale()` — true once a newer navigation has started, so a view that awaited
    // something can stop instead of drawing into a page that is already being replaced.
    const ctx = {
      root: div, params, query, path, title: '',
      setTitle: (t) => { ctx.title = t; },
      onCleanup: (fn) => this.#cleanups.push(fn),
      stale: () => token !== this.#token,
    };
    try {
      if (!match) { div.innerHTML = notFound(); }
      else {
        // Views are loaded on demand from ./views/<name>.js (each exports a default function).
        const mod = await import(`./views/${match.view}.js`);
        await mod.default(ctx);
      }
    } catch (err) {
      console.error('[router]', err); import('./errors.js').then((m) => m.reportClientError(err, { where: 'router' })).catch(() => {});
      div.innerHTML = errorView(err);
    }
    clearTimeout(skeleton);
    // A newer navigation started while this page loaded: drop this result.
    if (token !== this.#token) return;          // superseded by a newer navigation
    this.root.replaceChildren(div);
    const meta = app.catalog ? pageMeta({ path, query, cat: app.catalog, studio: app.studio, origin: siteOrigin() }) : null;
    if (meta && match) applyHead(meta, { canonical: HISTORY });
    else document.title = ctx.title ? `${ctx.title} — ADDABAAZ` : 'ADDABAAZ — Bengali Originals, Comedy & Web Series';
    jumpScroll(refresh ? holdScroll : restore ? this.#scroll.get(key) || 0 : 0);
    this.onRoute?.({ path, query, params, view: match?.view });
    document.getElementById('announcer').textContent = ctx.title || meta?.title || 'ADDABAAZ';
  }
}

/* The page loader: a small Material-style indeterminate arc (brand red) centred in the screen while the
 * next page is fetched. The SVG carries the markup, styles.css the animation (.page-loader). */
const PAGE_LOADER = '<div class="page-loader" role="status" aria-label="Loading" aria-busy="true"><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="tr" cx="20" cy="20" r="15.9155"></circle><circle class="arc" cx="20" cy="20" r="15.9155"></circle></svg></div>';

/** The public origin the server declared in <link rel=canonical> (PUBLIC_SITE_URL) — falls back to where we are. */
const siteOrigin = () => { try { return new URL(document.querySelector('link[rel="canonical"]')?.href || location.href).origin; } catch { return location.origin; } };

const notFound = () => html`<div class="empty">${icon('film', { size: 44 })}<h2>Scene not found</h2><p>The page you're looking for doesn't exist.</p><a class="btn btn-primary" href="#/">Back to home</a></div>`.s;
// A view module that cannot be fetched (deploy in progress, stale page after an update…) is almost always
// cured by a reload — say so instead of showing the browser's cryptic "Failed to fetch dynamically imported module".
const errorView = (err) => {
  const moduleLoad = /dynamically imported|module script failed|error loading dynamically/i.test(String(err?.message || ''));
  const msg = moduleLoad ? 'This page did not load completely — a reload usually fixes it (the app may have just been updated).' : friendly(err, 'Please check your connection and try again.');
  return html`<div class="empty">${icon('wifioff', { size: 44 })}<h2>Something went wrong</h2><p>${msg}</p><button class="btn btn-primary" data-reload>Reload</button></div>`.s;
};
