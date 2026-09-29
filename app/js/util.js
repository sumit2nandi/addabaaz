/* Tiny safe-HTML templating + helpers (no framework, no build step). */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Safe(String(s));
const val = (v) => (v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v));
/** Tagged template: interpolated values are escaped unless produced by html``/raw(). */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
  return new Safe(out);
}
/** Render safe html into a new element. */
export function el(safe, tag = 'div', cls = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.innerHTML = safe.s;
  return e;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtRuntime(sec) {
  const m = Math.round((sec || 0) / 60);
  if (m < 1) return `${Math.max(1, Math.round(sec || 0))}s`;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
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
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const norm = (s) => String(s || '').normalize('NFC').toLowerCase();

export function storage(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

/** Minimal event emitter */
export class Emitter {
  #h = new Map();
  on(evt, fn) { (this.#h.get(evt) || this.#h.set(evt, new Set()).get(evt)).add(fn); return () => this.off(evt, fn); }
  off(evt, fn) { this.#h.get(evt)?.delete(fn); }
  emit(evt, payload) { this.#h.get(evt)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); }
}

export function shareOrCopy({ title, text, url }) {
  const u = url || location.href;
  const native = window.Capacitor?.Plugins?.Share;
  if (native?.share) return native.share({ title, text, url: u });
  if (navigator.share) return navigator.share({ title, text, url: u }).catch(() => {});
  return navigator.clipboard?.writeText(u).then(() => 'copied');
}
