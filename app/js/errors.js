/* Sends uncaught browser errors to the ADDABAAZ API (admin console → Errors). Reports are throttled and de-duplicated; the browser sends no account identifier (the server may associate a verified session).
 * Also owns `friendly()` — the one place that decides what a user may see when something throws:
 * server-authored and deliberately-written messages pass through, browser/JS internals never do. */
import { app } from './app.js';

// Remember what was already reported so a loop of errors cannot flood the server.
const seen = new Set(); let sent = 0;
// Known-harmless browser noise: never reported, never shown.
const NOISE = /^Script error\.?$|ResizeObserver loop|Non-Error promise rejection|This video is not available|Failed to fetch|Load failed|NetworkError/i;

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

// Reports one error (at most 5 per page load, each message once), and only when signed in to the API. Known-harmless browser noise is ignored.
export function reportClientError(err, extra = {}) {
  try {
    // Explicit playback diagnostics may be expected network/media failures, but are useful to operators
    // when investigating a broken stream. `force` only bypasses the generic-noise filter; it is not sent.
    const { force = false, ...details } = extra;
    const message = String(err?.message || err || 'Unknown error').slice(0, 300);
    if (!app.user?.remote || sent >= 5 || seen.has(message) || (!force && NOISE.test(message))) return;
    seen.add(message); sent++;
    app.user.remote.reportError({ message, stack: String(err?.stack || '').slice(0, 3000), url: location.pathname + location.search + location.hash, ...details });
  } catch { /* never throw from the reporter */ }
}

// A single plain toast so an uncaught error is never silent (throttled so a loop cannot spam).
let lastNotice = 0;
function notice() {
  const now = Date.now();
  if (now - lastNotice < 8000) return;
  lastNotice = now;
  import('./ui/components.js').then(({ toast }) => toast('Something went wrong. Please try again.')).catch(() => {});
}

// Hooks the browser's global error events (called once from main.js).
export function initErrorReporting() {
  window.addEventListener('error', (e) => {
    if (e.error || e.message) {
      reportClientError(e.error || e.message);
      if (!NOISE.test(String(e.message || '')) && !(e.target instanceof HTMLMediaElement)) notice();
    }
  });
  window.addEventListener('unhandledrejection', (e) => {
    reportClientError(e.reason);
    if (!NOISE.test(String(e.reason?.message || e.reason || ''))) notice();
  });
}
