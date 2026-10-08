import { storage, store } from '../util.js';

/** A random id for this browser/app install: lets the server count how many screens are watching and list "your devices". */
// Identifies this browser/app install to the server (used for the "screens at once" limit and the device list).
export const deviceId = () => { try { let d = localStorage.getItem('ab.device'); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('ab.device', d); } return d; } catch { return 'anon'; } };
/**
 * Native apps adopt the OS-provided device identifier when the Device plugin is in the build
 * (ANDROID_ID on Android, identifierForVendor on iOS): unlike the random install id it survives a
 * reinstall and cleared storage, so the same phone keeps ONE row in "Your Devices". That is the
 * strongest identity apps are allowed: IMEI is off-limits (iOS never exposes it; Android reserves
 * it for system apps since Android 10, and the stores forbid asking), and browsers offer nothing
 * durable at all by design — the web keeps the stored random id, like every other streaming site.
 */
export async function resolveDeviceId() {
  if (!window.Capacitor?.isNativePlatform?.()) return;
  try {
    const { identifier } = await window.Capacitor?.Plugins?.Device?.getId?.() || {};
    const id = String(identifier || '').replace(/[^\w.-]/g, '').slice(0, 64);
    if (id) localStorage.setItem('ab.device', id);
  } catch { /* plugin missing in this build — the stored random id keeps working */ }
}
// Best-effort device model ("OnePlus LE2121", "Pixel 7") for the "Your devices" list: the Capacitor
// Device plugin when the native shell includes it, else the Chromium UA-CH model. Cached, so the
// stored label upgrades on the next heartbeat after first resolve.
const MODEL_KEY = 'ab.deviceModel';
export const deviceModel = () => { try { return localStorage.getItem(MODEL_KEY) || ''; } catch { return ''; } };
const rememberModel = (m) => { try { if (m) localStorage.setItem(MODEL_KEY, String(m).slice(0, 60)); } catch { /* private mode */ } };
// Many Androids report only a bare model code ("EB2101", "RMX3081", "SM-M326B"): the app shell has
// no Device plugin and Chromium's UA-CH `model` carries no manufacturer. Recognisable code prefixes
// get their brand back, so the device list reads "OnePlus EB2101" instead of a code nobody knows.
const MODEL_BRANDS = [
  [/^SM-[A-Z]\d/i, 'Samsung'],
  [/^RMX\d{4}/i, 'Realme'],
  [/^CPH\d{4}/i, 'OPPO'],                                             // BBK code — OPPO and recent global OnePlus units
  [/^(AC|BE|DE|DN|EB|GM|HD|IN|IV|KB|LE|MT|NE)\d{4}$/i, 'OnePlus'],    // EB2101 (Nord CE), LE2121 (9 Pro) …
  [/^P[HJ][A-Z]\d{3}$/i, 'OnePlus'],                                  // PHB110 (11 5G), PJD110 (12) …
  [/^[VI]2\d{3}[A-Z]*$/i, 'Vivo'],                                    // V2xxx vivo, I2xxx iQOO
  [/^XT\d{4}/i, 'Motorola'],
  [/^(M2\d{3}|2\d{3}[0-9A-Z]{4,})/i, 'Xiaomi'],                       // M2101K6G, 2201117TI …
  [/^A0\d{2}$/i, 'Nothing'],
];
export const brandedModel = (raw) => {
  const m = String(raw || '').trim();
  if (!m || m.includes(' ')) return m;             // "OnePlus LE2121", "Pixel 7" already read fine
  const hit = MODEL_BRANDS.find(([re]) => re.test(m));
  return hit ? `${hit[1]} ${m}` : m;
};
export async function resolveDeviceModel() {
  if (deviceModel()) return deviceModel();
  try {
    const info = await window.Capacitor?.Plugins?.Device?.getInfo?.();
    const named = info && brandedModel(`${info.manufacturer || ''} ${info.model || ''}`.trim());
    if (named) { rememberModel(named); return named; }
  } catch { /* plugin missing — fall through to UA-CH */ }
  try {
    const model = brandedModel((await navigator.userAgentData?.getHighEntropyValues?.(['model']))?.model);
    if (model) { rememberModel(model); return model; }
  } catch { /* browsers without client hints */ }
  return '';
}
export const deviceLabel = () => {
  const ua = navigator.userAgent;
  // brandedModel also upgrades a bare code cached by an older build the moment this one runs.
  if (window.Capacitor?.isNativePlatform?.()) { const m = brandedModel(deviceModel()); if (m) return `${m} · app`; }
  // Android browsers use the resolved model when there is one ("OnePlus EB2101 · Chrome").
  const os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? (brandedModel(deviceModel()) || 'Android') : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
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
