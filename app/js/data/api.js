import { storage, store } from '../util.js';

/** A random id for this browser/app install: lets the server count how many screens are watching and list "your devices". */
export const deviceId = () => { try { let d = localStorage.getItem('ab.device'); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('ab.device', d); } return d; } catch { return 'anon'; } };
export const deviceLabel = () => {
  const ua = navigator.userAgent, os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const app = window.Capacitor?.isNativePlatform?.() ? 'app' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${app}`;
};

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

/** Thin fetch wrapper for the ADDABAAZ REST API (docs/openapi.yaml). */
export class ApiClient {
  constructor(base) { this.base = base; this.token = storage('ab.token', null); }
  setToken(t) { this.token = t; if (t) store('ab.token', t); else localStorage.removeItem('ab.token'); }
  async req(method, path, body, { signal, headers = {}, quiet401 = false } = {}) {
    let res;
    try {
      res = await fetch(`${this.base}/api/v1${path}`, {
        method, signal,
        headers: { 'X-Device-Id': deviceId(), 'X-Device-Label': deviceLabel(), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new ApiError(0, 'You appear to be offline.', 'network'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && this.token && !quiet401) { this.setToken(null); window.dispatchEvent(new CustomEvent('ab:unauthorized')); }
      throw new ApiError(res.status, data.error?.message || data.message || `Request failed (${res.status})`, data.error?.code);
    }
    return data;
  }
  /** Authenticated download (e.g. invoice PDFs) → Blob. */
  async blob(path) {
    let res;
    try { res = await fetch(`${this.base}/api/v1${path}`, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} }); }
    catch { throw new ApiError(0, 'You appear to be offline.', 'network'); }
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d.error?.message || `Download failed (${res.status})`, d.error?.code); }
    return res.blob();
  }
  get(p, o) { return this.req('GET', p, null, o); }
  post(p, b, o) { return this.req('POST', p, b ?? {}, o); }
  put(p, b, o) { return this.req('PUT', p, b ?? {}, o); }
  patch(p, b, o) { return this.req('PATCH', p, b ?? {}, o); }
  del(p, b, o) { return this.req('DELETE', p, b, o); }
  /** Fire-and-forget POST that survives page unloads (analytics, error reports, "stopped watching"). */
  beacon(path, body) {
    try { fetch(`${this.base}/api/v1${path}`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId(), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: JSON.stringify(body ?? {}) }).catch(() => {}); } catch { /* ignore */ }
  }
}

/** Returns true when a compatible ADDABAAZ API answers at `base` ('' = same origin). */
export async function detectApi(base) {
  if (base === 'off') return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(`${base}/api/v1/health`, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    return j && j.service === 'addabaaz';
  } catch { return false; } finally { clearTimeout(t); }
}
