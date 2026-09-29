import { app } from './app.js';
import { html } from './util.js';
import { icon } from './icons.js';
import { HISTORY } from './mode.js';
import { matchRoute } from './routes.js';
import { applyHead } from './seo/head.js';
import { pageMeta } from './seo/meta.js';

/** Current in-app location as { path, query } — from the URL path on the website, from the #fragment in static/native builds. */
export function parseLocation() {
  const raw = HISTORY ? location.pathname + location.search : location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}
export const parseHash = parseLocation;
/** '/show/x?y=1' for the current page (what you'd pass to go()). */
export const currentPath = () => (HISTORY ? location.pathname + location.search : location.hash.replace(/^#/, '') || '/');
const urlFor = (path) => (HISTORY ? path : '#' + path);

let replaceNext = false;
export function go(path, { replace = false } = {}) {
  if (HISTORY) {
    if (replace) { replaceNext = true; history.replaceState(null, '', path); } else history.pushState(null, '', path);
    window.dispatchEvent(new CustomEvent('ab:navigate', { detail: { replace } }));
  } else if (replace) { replaceNext = true; history.replaceState(null, '', '#' + path); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else location.hash = path;
}
/** Change the address bar without navigating (filters, search text). */
export function replaceUrl(path) { history.replaceState(history.state, '', urlFor(path)); }
export function back(fallback = '/') { if (history.length > 1 && window.__navDepth > 0) history.back(); else go(fallback, { replace: true }); }

/* On the website, links written as href="#/show/x" become real hrefs (/show/x) so crawlers, "open in new tab" and
 * copy-link all see proper URLs. Runs on everything the app renders. */
function rewriteLinks(root) {
  if (root.nodeType !== 1) return;
  const fix = (a) => { const h = a.getAttribute('href'); if (h && h.startsWith('#/')) a.setAttribute('href', h.slice(1)); };
  if (root.matches?.('a[href^="#/"]')) fix(root);
  root.querySelectorAll?.('a[href^="#/"]').forEach(fix);
}
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

export class Router {
  #cleanups = []; #token = 0; #scroll = new Map(); #lastKey = null; #fresh = true; #depth = 0;
  constructor(root, { onRoute } = {}) {
    this.root = root; this.onRoute = onRoute;
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
  async resolve() {
    const { path, query } = parseLocation();
    const key = this.#keyNow();
    if (this.#lastKey !== null) this.#scroll.set(this.#lastKey, window.scrollY);
    let restore = !this.#fresh;
    if (replaceNext) { restore = false; replaceNext = false; }
    else this.#depth = this.#fresh ? this.#depth + 1 : Math.max(0, this.#depth - 1);
    window.__navDepth = this.#depth;
    this.#fresh = false; this.#lastKey = key;
    const token = ++this.#token;
    this.#cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

    const found = matchRoute(path);
    const match = found ? { view: found.view } : null, params = found?.params || {};

    const skeleton = setTimeout(() => { if (token === this.#token) this.root.innerHTML = '<div class="page-loading" aria-busy="true"><div class="spinner"></div></div>'; }, 180);
    const div = document.createElement('div');
    div.className = 'view';
    const ctx = {
      root: div, params, query, path, title: '',
      setTitle: (t) => { ctx.title = t; },
      onCleanup: (fn) => this.#cleanups.push(fn),
    };
    try {
      if (!match) { div.innerHTML = notFound(); }
      else {
        const mod = await import(`./views/${match.view}.js`);
        await mod.default(ctx);
      }
    } catch (err) {
      console.error('[router]', err);
      div.innerHTML = errorView(err);
    }
    clearTimeout(skeleton);
    if (token !== this.#token) return;          // superseded by a newer navigation
    this.root.replaceChildren(div);
    const meta = app.catalog ? pageMeta({ path, query, cat: app.catalog, studio: app.studio, origin: siteOrigin() }) : null;
    if (meta && match) applyHead(meta, { canonical: HISTORY });
    else document.title = ctx.title ? `${ctx.title} — ADDABAAZ` : 'ADDABAAZ — Bengali Originals, Comedy & Web Series';
    window.scrollTo({ top: restore ? this.#scroll.get(key) || 0 : 0, behavior: 'auto' });
    this.onRoute?.({ path, query, params, view: match?.view });
    document.getElementById('announcer').textContent = ctx.title || meta?.title || 'ADDABAAZ';
  }
}

/** The public origin the server declared in <link rel=canonical> (PUBLIC_SITE_URL) — falls back to where we are. */
const siteOrigin = () => { try { return new URL(document.querySelector('link[rel="canonical"]')?.href || location.href).origin; } catch { return location.origin; } };

const notFound = () => html`<div class="empty">${icon('film', { size: 44 })}<h2>Scene not found</h2><p>The page you're looking for doesn't exist.</p><a class="btn btn-primary" href="#/">Back to home</a></div>`.s;
const errorView = (err) => html`<div class="empty">${icon('wifioff', { size: 44 })}<h2>Something went wrong</h2><p>${err?.message || 'Please check your connection and try again.'}</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div>`.s;
