/* The page table, shared by the browser router and the server (which needs it to answer with the right status code and
 * page metadata). Pure data + a matcher — no DOM. */
export const ROUTES = [
  ['/', 'home'], ['/shows', 'browse'], ['/show/:id', 'show'], ['/watch/:id', 'watch'],
  ['/reels', 'reels'], ['/reels/:id', 'reels'], ['/upcoming', 'upcoming'], ['/soon/:id', 'soon'],
  ['/gallery', 'gallery'], ['/search', 'search'], ['/list', 'mylist'], ['/account', 'account'],
  ['/profiles', 'profiles'], ['/signin', 'auth'], ['/signup', 'auth'], ['/plans', 'plans'], ['/billing', 'billing'],
  ['/forgot', 'recover'], ['/reset', 'recover'], ['/verify', 'recover'], ['/privacy', 'legal'], ['/terms', 'legal'], ['/refunds', 'legal'],
  ['/about', 'studio'], ['/services', 'studio'], ['/contact', 'studio'],
].map(([pattern, view]) => ({
  pattern, view,
  keys: [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]),
  re: new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '/?$'),
}));

/** '/show/shahid' → { view: 'show', params: { id: 'shahid' }, pattern } or null. */
export function matchRoute(path) {
  for (const r of ROUTES) {
    const m = path.match(r.re); if (!m) continue;
    const params = {};
    try { r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); } catch { return null; }
    return { view: r.view, params, pattern: r.pattern };
  }
  return null;
}
