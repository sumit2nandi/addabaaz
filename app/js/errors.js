/* Sends uncaught browser errors to the ADDABAAZ API (admin console → Errors). Throttled and de-duplicated; nothing personal is attached. */
import { app } from './app.js';

const seen = new Set(); let sent = 0;
export function reportClientError(err, extra = {}) {
  try {
    const message = String(err?.message || err || 'Unknown error').slice(0, 300);
    if (!app.user?.remote || sent >= 5 || seen.has(message) || /^Script error\.?$|ResizeObserver loop|Non-Error promise rejection|This video is not available|Failed to fetch|Load failed|NetworkError/i.test(message)) return;
    seen.add(message); sent++;
    app.user.remote.reportError({ message, stack: String(err?.stack || '').slice(0, 3000), url: location.pathname + location.search + location.hash, ...extra });
  } catch { /* never throw from the reporter */ }
}
export function initErrorReporting() {
  window.addEventListener('error', (e) => { if (e.error || e.message) reportClientError(e.error || e.message); });
  window.addEventListener('unhandledrejection', (e) => reportClientError(e.reason));
}
