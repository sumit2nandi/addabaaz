import { storage, store } from '../util.js';

/** A random id for this browser/app install: lets the server count how many screens are watching and list "your devices". */
// Identifies this browser/app install to the server (used for the "screens at once" limit and the device list).
export const deviceId = () => { try { let d = localStorage.getItem('ab.device'); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('ab.device', d); } return d; } catch { return 'anon'; } };
export const deviceLabel = () => {
  const ua = navigator.userAgent, os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const app = window.Capacitor?.isNativePlatform?.() ? 'app' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${app}`;
};

// Error thrown for failed API calls: `status` (0 = offline), user-readable `message`, and the API's `code`.
export class ApiError extends Error {
  constructor(status, message, code, options = {}) { super(message); this.name = new.target.name; if (options.cause !== undefined) this.cause = options.cause; this.status = status; this.code = code; }
}

function reportApiFailure(error, { where = 'api-response', force = false } = {}) {
  if (!error || error.code === 'maintenance' || (!force && error.status > 0 && error.status < 500)) return;
  import('../errors.js').then(({ reportClientError }) => reportClientError(error, {
    where, status: error.status, code: error.code || null,
  })).catch(() => {});
}

// Plain-language text for an HTTP status when the server sent no message of its own (proxy error
// pages, stripped responses…): users never see a bare status code.
export const httpMessage = (status) => (status === 401 ? 'Please sign in to continue.'
  : status === 403 ? 'You don’t have permission to do that.'
  : status === 404 ? 'We couldn’t find that.'
  : status === 409 ? 'Something changed — please refresh and try again.'
  : status === 413 ? 'That’s too large — please try something smaller.'
  : status === 415 ? 'That file type isn’t supported.'
  : status === 429 ? 'Too many attempts — please wait a moment and try again.'
  : status >= 500 ? 'Something went wrong on our side — please try again.'
  : 'That request couldn’t be completed.');

/** Thin fetch wrapper for the ADDABAAZ REST API (docs/openapi.yaml). */
// Every API call goes through `req()`: it adds the sign-in token and device headers, parses JSON, and turns errors into ApiError.
// A 401 clears the token and fires an `ab:unauthorized` event so the app signs the user out.
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
    } catch (e) {
      const error = new ApiError(0, 'You appear to be offline.', 'network', { cause: e });
      if (e?.name !== 'AbortError') reportApiFailure(error);
      throw error;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && this.token && !quiet401) { this.setToken(null); window.dispatchEvent(new CustomEvent('ab:unauthorized')); }
      // Maintenance mode (docs/MAINTENANCE.md): tell the shell so it can show the maintenance screen instead
      // of a scatter of failed calls. app/js/maintenance.js listens for this.
      if (res.status === 503 && data.error?.code === 'maintenance') window.dispatchEvent(new CustomEvent('ab:maintenance', { detail: { message: data.error.message, until: data.error.until || null, base: this.base } }));
      const error = new ApiError(res.status, data.error?.message || data.message || httpMessage(res.status), data.error?.code);
      reportApiFailure(error);
      throw error;
    }
    return data;
  }
  /** Authenticated download (e.g. invoice PDFs) → Blob. */
  // Download helper for files such as invoice PDFs.
  async blob(path) {
    let res;
    try { res = await fetch(`${this.base}/api/v1${path}`, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} }); }
    catch (cause) {
      const error = new ApiError(0, 'You appear to be offline.', 'network', { cause });
      if (cause?.name !== 'AbortError') reportApiFailure(error);
      throw error;
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (res.status === 503 && d.error?.code === 'maintenance') window.dispatchEvent(new CustomEvent('ab:maintenance', { detail: { message: d.error.message, until: d.error.until || null, base: this.base } }));
      const error = new ApiError(res.status, d.error?.message || httpMessage(res.status), d.error?.code);
      reportApiFailure(error);
      throw error;
    }
    return res.blob();
  }
  // Shorthand methods for each HTTP verb.
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
// Probe /api/v1/health (2.5 s timeout): is an ADDABAAZ API available here? If not, the app runs in local-only mode.
export async function detectApi(base) {
  if (base === 'off') return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(`${base}/api/v1/health`, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) {
      reportApiFailure(new ApiError(r.status, 'The application API health check failed.', 'api_health'), { where: 'api-health-check', force: true });
      return false;
    }
    let j;
    try { j = await r.json(); }
    catch (cause) {
      reportApiFailure(new ApiError(r.status, 'The application API returned an invalid health response.', 'api_health', { cause }), { where: 'api-health-check', force: true });
      return false;
    }
    if (j?.service !== 'addabaaz') {
      reportApiFailure(new ApiError(r.status, 'The application API returned an incompatible health response.', 'incompatible_api'), { where: 'api-health-check', force: true });
      return false;
    }
    return true;
  } catch (cause) {
    const error = new ApiError(0, ctl.signal.aborted ? 'The application API health check timed out.' : 'The application API health check failed.', 'api_health', { cause });
    reportApiFailure(error, { where: 'api-health-check', force: true });
    return false;
  } finally { clearTimeout(t); }
}
