import { storage, store } from '../util.js';

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

/** Thin fetch wrapper for the ADDABAAZ REST API (docs/openapi.yaml). */
export class ApiClient {
  constructor(base) { this.base = base; this.token = storage('ab.token', null); }
  setToken(t) { this.token = t; if (t) store('ab.token', t); else localStorage.removeItem('ab.token'); }
  async req(method, path, body, { signal } = {}) {
    let res;
    try {
      res = await fetch(`${this.base}/api/v1${path}`, {
        method, signal,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new ApiError(0, 'You appear to be offline.', 'network'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && this.token) { this.setToken(null); window.dispatchEvent(new CustomEvent('ab:unauthorized')); }
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
  post(p, b) { return this.req('POST', p, b ?? {}); }
  put(p, b) { return this.req('PUT', p, b ?? {}); }
  patch(p, b) { return this.req('PATCH', p, b ?? {}); }
  del(p) { return this.req('DELETE', p); }
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
