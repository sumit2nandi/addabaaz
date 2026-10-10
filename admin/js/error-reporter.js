/* Admin/Content console diagnostics. Uses the public client-error ingestion route so reports share
 * the same privacy filters, database storage, and Admin → Errors view as the viewer app. */
const MAX_QUEUE = 100;
const MAX_REPORTS_PER_PAGE = 100;
const queue = [];
const recentlyReported = new WeakMap();
const initializedWindows = new WeakSet();
let reportsCreated = 0, flushing = null, retryTimer = null, retryDelayMs = 5_000;

function text(value, max = 500) {
  try {
    return String(value ?? '')
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted token]')
      .replace(/([?&](?:access_?token|refresh_?token|token|password|secret|signature|key|email|phone|mobile|otp)=)[^&#\s]*/gi, '$1[redacted]')
      .replace(/((?:password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|email|phone|mobile|otp)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
      .replace(/\b\+?\d(?:[\d\s().-]{8,}\d)\b/g, '[redacted number]')
      .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  } catch { return ''; }
}

function routePath() {
  try {
    const hash = String(location.hash || '').replace(/^#\/?/, '').split(/[?#]/, 1)[0];
    return text(hash ? `/${hash}` : location.pathname || '/admin/', 300)
      .replace(/(\/api\/v1\/media\/)[^/]+/i, '$1[redacted]') || '/admin/';
  } catch { return '/admin/'; }
}

function token() {
  try {
    const saved = localStorage.getItem('ab.token');
    if (!saved) return '';
    try { return String(JSON.parse(saved) || ''); } catch { return saved; }
  } catch { return ''; }
}

function runtime() {
  const nav = globalThis.navigator || {};
  const size = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(20_000, Number(value))) : null;
  let timezone = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* optional browser capability */ }
  return {
    client: 'addabaaz-admin', version: 'admin-console', runtime: 'admin-console', platform: 'web',
    userAgent: text(nav.userAgent || '', 512), language: text(nav.language || '', 32) || null,
    timezone: text(timezone || '', 80) || null, online: typeof nav.onLine === 'boolean' ? nav.onLine : null,
    visibility: text(document.visibilityState || '', 24) || null,
    viewport: { width: size(window.innerWidth), height: size(window.innerHeight), pixelRatio: size(window.devicePixelRatio) },
  };
}

function errorParts(input) {
  if (input instanceof Error) return {
    message: text(input.message || input.name || 'Unknown admin-console error', 500),
    errorName: text(input.name || 'Error', 100).replace(/[^\w.$-]/g, '') || 'Error',
    errorCode: text(input.code || '', 100),
    status: Number.isInteger(input.status) && input.status >= 0 && input.status <= 599 ? input.status : null,
    stack: text(input.stack || '', 12_000),
  };
  const message = input && typeof input === 'object'
    ? input.message || input.reason || input.name || (() => { try { return JSON.stringify(input); } catch { return String(input); } })()
    : input;
  return {
    message: text(message || 'Unknown admin-console error', 500),
    errorName: text(input?.name || 'Error', 100).replace(/[^\w.$-]/g, '') || 'Error',
    errorCode: text(input?.code || '', 100),
    status: Number.isInteger(input?.status) && input.status >= 0 && input.status <= 599 ? input.status : null,
    stack: text(input?.stack || '', 12_000),
  };
}

function scheduleRetry(delay = retryDelayMs) {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; void flush(); }, Math.max(1_000, Math.min(Number(delay) || 5_000, 60_000)));
  // A pending retry must not hold the host open. node's test runner imports these browser modules, and the
  // retry reschedules itself for as long as the endpoint is unreachable, so an ordinary timer here keeps the
  // event loop alive forever and `npm test` never returns. In a browser setTimeout returns a number and has
  // no unref(), so this line changes nothing about how the page behaves.
  retryTimer.unref?.();
}

async function flush() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (flushing || !queue.length || typeof fetch !== 'function') return flushing;
  flushing = (async () => {
    while (queue.length) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), 3_000) : null;
      try {
        const auth = token();
        const response = await fetch('/api/v1/client-errors', {
          method: 'POST', keepalive: true, signal: controller?.signal,
          headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
          body: JSON.stringify(queue[0]),
        });
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            const after = Number(response.headers?.get?.('Retry-After'));
            const wait = after > 0 ? after * 1_000 : response.status === 429 ? 60_000 : retryDelayMs;
            retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
            scheduleRetry(wait);
            return;
          }
          queue.shift();
          continue;
        }
        queue.shift();
        retryDelayMs = 5_000;
      } catch {
        retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
        scheduleRetry(retryDelayMs);
        return;
      } finally { if (timeout) clearTimeout(timeout); }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Report a client-side admin error without ever sending an auth token in the report body; capped at 100/page. */
export function reportAdminError(input, context = {}) {
  try {
    const parts = errorParts(input);
    if (!parts.message || reportsCreated >= MAX_REPORTS_PER_PAGE) return false;
    if (input && (typeof input === 'object' || typeof input === 'function')) {
      const now = Date.now(), previous = recentlyReported.get(input);
      if (previous && now - previous < 1_000) return false;
      recentlyReported.set(input, now);
    }
    const ctx = context && typeof context === 'object' ? context : {};
    const client = {
      ...runtime(),
      where: text(ctx.where || 'admin-console', 100),
      ...(ctx.method ? { method: text(ctx.method, 12).toUpperCase() } : {}),
      ...(Number.isInteger(ctx.status) ? { status: ctx.status } : {}),
      ...(Number.isInteger(ctx.line) ? { line: ctx.line } : {}),
      ...(Number.isInteger(ctx.column) ? { column: ctx.column } : {}),
      ...(ctx.requestId ? { failedRequestId: text(ctx.requestId, 64) } : {}),
      ...(ctx.route ? { route: text(ctx.route, 300) } : {}),
      ...(ctx.resourceType ? { resourceType: text(ctx.resourceType, 20) } : {}),
      ...(ctx.resourcePath ? { resourcePath: text(String(ctx.resourcePath).split(/[?#]/, 1)[0], 300) } : {}),
    };
    if (input && typeof input === 'object' && input.cause) client.cause = errorParts(input.cause);
    const report = {
      ...parts,
      severity: ['warning', 'error', 'fatal'].includes(ctx.severity) ? ctx.severity : 'error',
      url: routePath(),
      details: client,
    };
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push(report);
    reportsCreated++;
    void flush();
    return true;
  } catch { return false; }
}

function resourceFailure(target) {
  const tag = text(target?.tagName || '', 12).toLowerCase();
  if (!['script', 'link'].includes(tag)) return;
  let path = '';
  try { path = new URL(target.src || target.href || '', location.href).pathname.slice(0, 300); } catch { /* omit malformed URL */ }
  reportAdminError(Object.assign(new Error(`Admin console failed to load a ${tag} resource.`), { name: 'ResourceLoadError' }), {
    where: 'resource-load', resourceType: tag, resourcePath: path,
  });
}

/** Install once from the shared console shell, before any page module is loaded. */
export function initAdminErrorReporting() {
  if (typeof window === 'undefined' || !window || initializedWindows.has(window)) return;
  initializedWindows.add(window);
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) { resourceFailure(event.target); return; }
    const message = text(event.message || event.error?.message || '', 500);
    if (!event.error && !message) return;
    reportAdminError(event.error || new Error(message), {
      where: 'window-error', line: Number(event.lineno) || null, column: Number(event.colno) || null,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportAdminError(event.reason || new Error('Unhandled admin-console promise rejection'), { where: 'unhandled-rejection' });
  });
  window.addEventListener('online', () => { void flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void flush(); });
}

// The admin API client imports this module before the console shell, so failures during session restore
// and initial module setup are observed too.
initAdminErrorReporting();
