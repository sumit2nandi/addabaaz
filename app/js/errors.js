/* Client diagnostics for the shared browser/PWA/Capacitor app. Reports are anonymous unless the server
 * verifies the saved session token and contain only redacted error/runtime context, never request bodies,
 * search/hash strings, device IDs or passwords. The network queue is bounded, reporting is capped at 100
 * events per page, and 429/5xx/offline failures retry so transient outages do not drop the queue. Also owns `friendly()`. */
import { app } from './app.js';

const MAX_QUEUE = 100;
const MAX_REPORTS_PER_PAGE = 100;
const queued = [];
const recentlyReported = new WeakMap();
let reportsCreated = 0, flushTask = null, retryTimer = null, retryDelayMs = 5_000, initialized = false, nativeAppState = 'unknown';
// Ignore known browser/extension noise unless a caller explicitly marks it as diagnostic.
const NOISE = /^Script error\.?$|ResizeObserver loop|Non-Error promise rejection|chrome-extension:|moz-extension:|safari-web-extension:/i;

/**
 * Turns any caught error into a message that is safe to show in the UI.
 * - Messages the server authored (ApiError) or errors flagged `friendly: true` are shown as-is.
 * - Anything that reads like a browser/JS fault (TypeError text, "Failed to fetch", …) is replaced
 *   with a plain fallback. Details still go to the console and the error report.
 */
export function friendly(e, fallback = 'Something went wrong. Please try again.') {
  try {
    if (e == null || e === '') return fallback;
    if (e.friendly === true || e.status !== undefined) return String(e.message || fallback).slice(0, 200);
    const m = String(e.message || '');
    if (!m || m.length > 200) return fallback;
    if (/^(typeerror|referenceerror|syntaxerror|domexception|rangeerror|evalerror)\b/i.test(m)) return fallback;
    if (/\bcannot read\b|is not a function|is not a constructor|is not defined|unexpected (token|keyword|end)|invalid json|non-error|failed to fetch|load failed|networkerror|script error|undefined is not|null is not|object is not|array is not|no method/i.test(m)) return fallback;
    return m;
  } catch { return fallback; }
}

function text(value, max = 300) {
  try {
    return String(value ?? '')
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted token]')
      .replace(/\b(?:AKIA[0-9A-Z]{16}|(?:gh[pousr]_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|ya29\.[A-Za-z0-9._-]{20,}|AIza[0-9A-Za-z_-]{35}|EA[A-Z0-9]{40,})|[A-Za-z0-9_-]{96,})\b/gi, '[redacted token]')
      .replace(/([?&](?:access_?token|refresh_?token|token|password|secret|signature|key|email|phone|mobile|otp|x-amz-[\w-]+|awsaccesskeyid|key-pair-id|policy)=)[^&#\s]*/gi, '$1[redacted]')
      .replace(/((?:password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|email|phone|mobile|otp)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
      .replace(/\b\+?\d(?:[\d\s().-]{8,}\d)\b/g, '[redacted number]')
      .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  } catch { return ''; }
}

function safeDetails(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, 4_000);
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) < 1_000_000_000 ? value : text(value, 64);
  if (typeof value !== 'object') return text(value, 200);
  if (value instanceof Error) return errorParts(value);
  if (depth >= 5 || seen.has(value)) return '[details omitted]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeDetails(item, depth + 1, seen));
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 60)) {
    const safeKey = text(key, 80);
    if (!safeKey) continue;
    out[safeKey] = /authorization|cookie|password|secret|token|api.?key|credential|signature|session|email|phone|mobile|otp|user.?id|account.?id|device.?id/i.test(key)
      ? '[redacted]' : safeDetails(item, depth + 1, seen);
  }
  return out;
}

function errorParts(input) {
  if (input instanceof Error) return {
    message: text(input.message || input.name || 'Unknown client error', 500),
    errorName: text(input.name || 'Error', 100).replace(/[^\w.$-]/g, '') || 'Error',
    errorCode: text(input.code || '', 100),
    status: Number.isInteger(input.status) && input.status >= 0 && input.status <= 599 ? input.status : null,
    stack: text(input.stack || '', 12_000),
  };
  if (input && typeof input === 'object') return {
    message: text(input.message || input.reason || input.name || 'Unknown client error', 500),
    errorName: text(input.name || 'Error', 100).replace(/[^\w.$-]/g, '') || 'Error',
    errorCode: text(input.code || '', 100),
    status: Number.isInteger(input.status) && input.status >= 0 && input.status <= 599 ? input.status : null,
    stack: text(input.stack || '', 12_000),
  };
  return { message: text(input || 'Unknown client error', 500), errorName: 'Error', errorCode: '', status: null, stack: '' };
}

function routePath() {
  try {
    const hashRoute = String(location.hash || '').replace(/^#/, '');
    const route = hashRoute.startsWith('/') ? hashRoute : String(location.pathname || '/');
    return text(route.split(/[?#]/, 1)[0].replace(/(\/api\/v1\/media\/)[^/]+/i, '$1[redacted]'), 300) || '/';
  } catch { return '/'; }
}

function clientRuntime() {
  const nav = globalThis.navigator || {};
  const cap = globalThis.window?.Capacitor;
  let native = false, platform = 'web', timezone = null, colorScheme = null;
  try { native = !!cap?.isNativePlatform?.(); if (native) platform = text(cap?.getPlatform?.() || 'native', 24); } catch { /* optional native bridge */ }
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection || null;
  const size = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(20_000, Number(value))) : null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* optional browser capability */ }
  try { colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { /* optional browser capability */ }
  return {
    client: 'addabaaz', version: app.config?.version || null,
    runtime: native ? 'capacitor' : 'browser', platform,
    appState: native ? nativeAppState : null,
    userAgent: text(nav.userAgent || '', 512), language: text(nav.language || '', 32) || null,
    timezone: text(timezone || '', 80) || null, online: typeof nav.onLine === 'boolean' ? nav.onLine : null,
    visibility: text(document.visibilityState || '', 24) || null, colorScheme,
    viewport: { width: size(window.innerWidth), height: size(window.innerHeight), pixelRatio: size(window.devicePixelRatio) },
    screen: { width: size(window.screen?.width), height: size(window.screen?.height), orientation: text(window.screen?.orientation?.type || '', 32) || null },
    hardwareConcurrency: size(nav.hardwareConcurrency), deviceMemoryGiB: size(nav.deviceMemory),
    network: connection ? {
      type: text(connection.type || '', 24) || null, effectiveType: text(connection.effectiveType || '', 12) || null,
      downlinkMbps: size(connection.downlink), rttMs: size(connection.rtt), saveData: typeof connection.saveData === 'boolean' ? connection.saveData : null,
    } : null,
  };
}

function endpoint() {
  const base = typeof app.api?.base === 'string' ? app.api.base : String(app.config?.apiBase || '');
  if (base === 'off') return null;
  return `${base.replace(/\/+$/, '')}/api/v1/client-errors`;
}

function sessionToken() {
  if (typeof app.api?.token === 'string' && app.api.token) return app.api.token;
  try { return localStorage.getItem('ab.token') || ''; } catch { return ''; }
}

function scheduleRetry(delay = retryDelayMs) {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; void flushReports(); }, Math.max(1_000, Math.min(Number(delay) || 5_000, 60_000)));
  // A pending retry must not hold the host open. node's test runner imports these browser modules, and the
  // retry reschedules itself for as long as the endpoint is unreachable, so an ordinary timer here keeps the
  // event loop alive forever and `npm test` never returns. In a browser setTimeout returns a number and has
  // no unref(), so this line changes nothing about how the page behaves.
  retryTimer.unref?.();
}

async function flushReports() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (flushTask || !queued.length) return flushTask;
  flushTask = (async () => {
    while (queued.length) {
      const report = queued[0];
      const url = endpoint();
      if (!url) { queued.length = 0; return; }
      const token = sessionToken();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 3_000) : null;
      try {
        const response = await fetch(url, {
          method: 'POST', keepalive: true, signal: controller?.signal,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(report),
        });
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            const retryAfter = Number(response.headers?.get?.('Retry-After'));
            const wait = retryAfter > 0 ? retryAfter * 1_000 : response.status === 429 ? 60_000 : retryDelayMs;
            retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
            scheduleRetry(wait);
            return; // preserve the report and retry after the server's rate window / outage
          }
          queued.shift(); // invalid/expired reports cannot be fixed by retrying the same body
          continue;
        }
        queued.shift();
        retryDelayMs = 5_000;
      } catch {
        retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
        scheduleRetry(retryDelayMs);
        return;
      } finally { if (timer) clearTimeout(timer); }
    }
  })().finally(() => { flushTask = null; });
  return flushTask;
}

function queueReport(report) {
  if (queued.length >= MAX_QUEUE) queued.shift();
  queued.push(report);
  void flushReports();
}

/** Reports client-side exceptions and diagnostics, including anonymous visitors and repeated occurrences. */
export function reportClientError(err, extra = {}) {
  try {
    // Explicit playback diagnostics may be expected network/media failures, but remain useful when a stream breaks.
    const options = extra && typeof extra === 'object' ? extra : {};
    const { force = false, severity = 'error', ...details } = options;
    const parts = errorParts(err);
    const message = parts.message || 'Unknown client error';
    if (!message || reportsCreated >= MAX_REPORTS_PER_PAGE || (!force && NOISE.test(message))) return false;
    const url = endpoint();
    if (!url) return false;
    // The same Error is often reported by both a local catch and the global rejection hook. Coalesce only
    // that immediate duplicate; a later occurrence, even with the same message, is recorded separately.
    if (err && (typeof err === 'object' || typeof err === 'function')) {
      const now = Date.now(), previous = recentlyReported.get(err);
      if (previous && now - previous < 1_000) return false;
      recentlyReported.set(err, now);
    }
    let context = safeDetails({ ...details, ...clientRuntime() });
    if (err && typeof err === 'object' && err.cause) {
      const causes = []; let current = err.cause; const chain = new Set([err]);
      while (current && causes.length < 4 && typeof current === 'object' && !chain.has(current)) {
        chain.add(current);
        causes.push(errorParts(current));
        current = current.cause;
      }
      if (causes.length) context.causes = causes;
    }
    try {
      const serialized = JSON.stringify(context);
      if (serialized.length > 16_000) context = { truncated: true, preview: serialized.slice(0, 15_000) };
    } catch { context = { omitted: 'Client diagnostics could not be serialized.' }; }
    const report = {
      ...parts,
      severity: ['warning', 'error', 'fatal'].includes(severity) ? severity : 'error',
      url: routePath(),
      details: context,
    };
    queueReport(report);
    reportsCreated++;
    return true;
  } catch { /* never throw from the reporter */ return false; }
}

// Preserve console diagnostics as well as uncaught browser events. This picks up errors that an app
// catch block handled after writing to the console, without replacing the user's console output.
let consoleHooksInstalled = false;
function installConsoleHooks() {
  if (consoleHooksInstalled || typeof console === 'undefined') return;
  consoleHooksInstalled = true;
  for (const method of ['error', 'warn']) {
    try {
      const original = console[method];
      if (typeof original !== 'function') continue;
      console[method] = function (...args) {
        try { original.apply(this, args); } catch { /* diagnostics must never break the app */ }
        try {
          const printable = args.map((value) => {
            if (value instanceof Error) return `${value.name || 'Error'}: ${value.message || ''}`;
            if (typeof value === 'string' || typeof value === 'number') return String(value);
            try { return JSON.stringify(value); } catch { return String(value); }
          }).join(' ').slice(0, 1_000);
          const err = args.find((value) => value instanceof Error)
            || Object.assign(new Error(text(printable || `console.${method} called`)), { name: method === 'warn' ? 'ConsoleWarning' : 'ConsoleError' });
          reportClientError(err, {
            where: `console.${method}`, loggerMessage: printable,
            severity: method === 'warn' ? 'warning' : 'error', force: true,
          });
        } catch { /* the browser's console remains best effort */ }
      };
    } catch { /* some embedded WebViews expose a read-only console */ }
  }
}

// A single plain toast so an uncaught error is never silent (throttled so a loop cannot spam).
let lastNotice = 0;
function notice() {
  const now = Date.now();
  if (now - lastNotice < 8000) return;
  lastNotice = now;
  import('./ui/components.js').then(({ toast }) => toast('Something went wrong. Please try again.')).catch(() => {});
}

function resourceFailure(target) {
  const tag = text(target?.tagName || '', 12).toLowerCase();
  if (!['script', 'link', 'img', 'audio', 'video', 'source', 'iframe', 'track'].includes(tag)) return;
  const url = target.src || target.href || '';
  let path = '';
  try { path = new URL(url, location.href).pathname.slice(0, 300); } catch { /* omit malformed URL */ }
  reportClientError(Object.assign(new Error(`Failed to load ${tag} resource.`), { name: 'ResourceLoadError' }), {
    where: 'resource-load', resourceType: tag, resourcePath: path,
  });
}

// Hooks browser and Capacitor lifecycle events. Called at the entry point before boot starts, so failures
// in API detection, catalog loading and initial session restore are captured too.
export function initErrorReporting() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  installConsoleHooks();
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) { resourceFailure(event.target); return; }
    const message = text(event.message || event.error?.message || '', 500);
    if (!event.error && !message) return;
    const reported = reportClientError(event.error || new Error(message), {
      where: 'window-error', line: Number(event.lineno) || null, column: Number(event.colno) || null,
    });
    if (reported && document.body?.classList?.contains('booted') && !NOISE.test(message)) notice();
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason || new Error('Unhandled promise rejection');
    const parts = errorParts(reason);
    const reported = reportClientError(reason, { where: 'unhandled-rejection' });
    if (reported && document.body?.classList?.contains('booted') && !NOISE.test(parts.message)) notice();
  });
  window.addEventListener('online', () => { void flushReports(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void flushReports(); });

  const appPlugin = window.Capacitor?.Plugins?.App;
  try {
    const listener = appPlugin?.addListener?.('appStateChange', ({ isActive } = {}) => {
      nativeAppState = isActive ? 'active' : 'background';
      if (isActive) void flushReports();
    });
    listener?.catch?.(() => {});
  } catch { /* App plugin is optional in browser and older native bundles. */ }
}
