import { app } from './app.js';
import { html } from './util.js';
import { icon } from './icons.js';

const ROUTES = [
  ['/', 'home'], ['/shows', 'browse'], ['/show/:id', 'show'], ['/watch/:id', 'watch'],
  ['/reels', 'reels'], ['/reels/:id', 'reels'], ['/upcoming', 'upcoming'], ['/soon/:id', 'soon'],
  ['/gallery', 'gallery'], ['/search', 'search'], ['/list', 'mylist'], ['/account', 'account'],
  ['/profiles', 'profiles'], ['/signin', 'auth'], ['/signup', 'auth'], ['/plans', 'plans'],
  ['/about', 'studio'], ['/services', 'studio'], ['/contact', 'studio'],
].map(([pattern, view]) => ({
  view,
  keys: [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]),
  re: new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '/?$'),
}));

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}
let replaceNext = false;
export function go(path, { replace = false } = {}) {
  if (replace) { replaceNext = true; history.replaceState(null, '', '#' + path); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else location.hash = path;
}
export function back(fallback = '/') { if (history.length > 1 && window.__navDepth > 0) history.back(); else go(fallback, { replace: true }); }

export class Router {
  #cleanups = []; #token = 0; #scroll = new Map(); #lastKey = null; #fresh = true; #depth = 0;
  constructor(root, { onRoute } = {}) {
    this.root = root; this.onRoute = onRoute;
    window.addEventListener('hashchange', () => this.resolve());
    document.addEventListener('click', (e) => { if (e.target.closest?.('a[href^="#/"]')) this.#fresh = true; }, true);
  }
  start() { this.resolve(); }
  async resolve() {
    const { path, query } = parseHash();
    const key = location.hash || '#/';
    if (this.#lastKey !== null) this.#scroll.set(this.#lastKey, window.scrollY);
    let restore = !this.#fresh;
    if (replaceNext) { restore = false; replaceNext = false; }
    else this.#depth = this.#fresh ? this.#depth + 1 : Math.max(0, this.#depth - 1);
    window.__navDepth = this.#depth;
    this.#fresh = false; this.#lastKey = key;
    const token = ++this.#token;
    this.#cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

    let match = null, params = {};
    for (const r of ROUTES) { const m = path.match(r.re); if (m) { match = r; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); break; } }

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
    document.title = ctx.title ? `${ctx.title} — ADDABAAZ` : 'ADDABAAZ — Bengali Originals, Comedy & Web Series';
    window.scrollTo({ top: restore ? this.#scroll.get(key) || 0 : 0, behavior: 'auto' });
    this.onRoute?.({ path, query, params, view: match?.view });
    document.getElementById('announcer').textContent = ctx.title || 'ADDABAAZ';
  }
}

const notFound = () => html`<div class="empty">${icon('film', { size: 44 })}<h2>Scene not found</h2><p>The page you're looking for doesn't exist.</p><a class="btn btn-primary" href="#/">Back to home</a></div>`.s;
const errorView = (err) => html`<div class="empty">${icon('wifioff', { size: 44 })}<h2>Something went wrong</h2><p>${err?.message || 'Please check your connection and try again.'}</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div>`.s;
