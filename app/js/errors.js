/* Sends uncaught browser errors to the ADDABAAZ API (admin console → Errors). Throttled and de-duplicated; nothing personal is attached. */
import { app } from './app.js';

// Remember what was already reported so a loop of errors cannot flood the server.
const seen = new Set(); let sent = 0;
// Reports one error (at most 5 per page load, each message once), and only when signed in to the API. Known-harmless browser noise is ignored.
export function reportClientError(err, extra = {}) {
  try {
    const message = String(err?.message || err || 'Unknown error').slice(0, 300);
    if (!app.user?.remote || sent >= 5 || seen.has(message) || /^Script error\.?$|ResizeObserver loop|Non-Error promise rejection|This video is not available|Failed to fetch|Load failed|NetworkError/i.test(message)) return;
    seen.add(message); sent++;
    app.user.remote.reportError({ message, stack: String(err?.stack || '').slice(0, 3000), url: location.pathname + location.search + location.hash, ...extra });
  } catch { /* never throw from the reporter */ }
}
// Hooks the browser's global error events (called once from main.js).
export function initErrorReporting() {
  window.addEventListener('error', (e) => { if (e.error || e.message) reportClientError(e.error || e.message); });
  window.addEventListener('unhandledrejection', (e) => reportClientError(e.reason));
}
