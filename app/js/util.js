/* Tiny safe-HTML templating + helpers (no framework, no build step). */
// SAFE HTML: strings built with html`...` are wrapped in `Safe`. Anything interpolated into html`...` is escaped automatically
// unless it is itself Safe (or passed through raw()). This is how the app avoids cross-site-scripting bugs without a framework.
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Safe(String(s));
// Turns one interpolated value into text: null/false disappear, arrays are joined, Safe values pass through, everything else is escaped.
const val = (v) => (v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v));
/** Tagged template: interpolated values are escaped unless produced by html``/raw(). */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
  return new Safe(out);
}
/** Render safe html into a new element. */
// Creates a DOM element from safe HTML.
export function el(safe, tag = 'div', cls = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.innerHTML = safe.s;
  return e;
}
// Short query helpers: `$('#id')` = first match, `$$('.x')` = array of all matches.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** True on iPhone/iPad, including iPadOS desktop-mode Safari (whose UA says Mac but whose touch-point
 *  count identifies an iPad). WebKit's autoplay rules differ from every other engine, so playback code
 *  branches on this. Returns false when `navigator` is missing (server-side render, tests). */
export function isIOSBrowser() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav) return false;
  return nav.userAgentData?.platform === 'iOS'
    || /iPad|iPhone|iPod/i.test(nav.userAgent || '')
    || (nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1);
}

// Delays a function until calls stop for `ms` milliseconds (used for search-as-you-type).
export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
// Date helpers and other user-facing formatters. Player controls format their live time locally.
export function fmtViews(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
export function fmtDate(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return '';
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [n, name] of units) if (s >= n) { const v = Math.floor(s / n); return `${v} ${name}${v > 1 ? 's' : ''} ago`; }
  return 'just now';
}
// Random id for locally stored profiles (falls back if crypto.randomUUID is unavailable).
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
// Normalises text for search: Unicode NFC + lower case, so Bengali and English match reliably.
export const norm = (s) => String(s || '').normalize('NFC').toLowerCase();

// Safe localStorage wrappers: they never throw (private mode / quota) and store JSON.
export function storage(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

/** Minimal event emitter */
// A minimal event emitter (on / off / emit); a failing listener never breaks the others.
export class Emitter {
  #h = new Map();
  on(evt, fn) { (this.#h.get(evt) || this.#h.set(evt, new Set()).get(evt)).add(fn); return () => this.off(evt, fn); }
  off(evt, fn) { this.#h.get(evt)?.delete(fn); }
  emit(evt, payload) { this.#h.get(evt)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); }
}

// Share sheet: native app plugin, then the browser's Web Share API, then copy the link to the clipboard.
export function shareOrCopy({ title, text, url }) {
  const u = url || location.href;
  const native = window.Capacitor?.Plugins?.Share;
  if (native?.share) return native.share({ title, text, url: u });
  if (navigator.share) return navigator.share({ title, text, url: u }).catch(() => {});
  return navigator.clipboard?.writeText(u).then(() => 'copied');
}
