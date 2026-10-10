// Shared HTTP helpers used by the public API (app.js) and the admin router (admin.js).
/** Shared HTTP helpers for the API and the admin router. */
// An error that carries an HTTP status and a machine-readable `code`; the error middleware turns it into `{ error: { code, message } }`.
export class HttpError extends Error { constructor(status, code, message, options = {}) { super(message, options); this.name = new.target.name; this.status = status; this.code = code; } }
// Shortcut for a 400 Bad Request error.
export const bad = (msg, code = 'bad_request') => new HttpError(400, code, msg);
/** Removes query/fragment secrets and short-lived HLS bearer tokens before a URL is persisted in an error report. */
export function safeErrorUrl(value) {
  const input = String(value || '');
  if (!input) return '';
  let path;
  try { path = new URL(input, 'http://error.invalid').pathname; }
  catch { path = input.split(/[?#]/, 1)[0].replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*|^\/\/[^/]*/i, '') || '/'; }
  return path.replace(/(\/api\/v1\/media\/)[^/]+/i, '$1[redacted]').slice(0, 300);
}
// Wraps an async route handler so a rejected promise reaches Express's error middleware (Express 4 does not do this itself).
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Neutralises a redirect target built from a request path so it can never leave this site.
 *
 * The SEO renderer canonicalises URLs (`/show/x/` → `/show/x`) by echoing part of the request path into
 * `Location`. A path is not automatically same-origin: WHATWG URL parsing (browsers, and `new URL()`)
 * treats `//host` *and* `///host` as "same scheme, this authority", so `Location: ///evil.com` lands the
 * visitor on `https://evil.com`. Backslashes are collapsed to slashes by the same parser, and a CR/LF
 * would let a target write extra response headers.
 *
 * So only a single-slash absolute path made of ordinary characters is accepted; anything else returns
 * `fallback` (empty string by default, which means "do not redirect").
 */
export function safeRedirectLocation(target, fallback = '') {
  const s = String(target ?? '');
  if (!s.startsWith('/') || s.startsWith('//')) return fallback;                    // must be a path on this origin, never "//host" or a URL
  if (/[\\\s\u0000-\u001f\u007f]/.test(s)) return fallback;                          // no backslash, whitespace, CRLF or other control character
  return s;
}

/** Outbound-request budget shared by every provider call, so one hung upstream cannot pin a request handler. */
export const OUTBOUND_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS) || 15_000;
/** `fetch` init with an abort timer; `signal` from the caller wins (it may already combine several reasons). */
export function withTimeout(init = {}, ms = OUTBOUND_TIMEOUT_MS) {
  return init.signal || !Number.isFinite(ms) || ms <= 0 ? init : { ...init, signal: AbortSignal.timeout(Math.max(100, Math.round(ms))) };
}

/** Sliding-window in-memory rate limiter (per IP + bucket). Use Redis/edge limits when running multiple nodes. */
export function rateLimit(bucket, max, windowMs) {
  const hits = new Map();
  return (req, _res, next) => {
    // One counter per (bucket, client IP). `bucket` names the endpoint group, e.g. 'login'.
    const key = `${bucket}:${req.ip}`; const now = Date.now();
    // Keep only the timestamps still inside the window.
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    // Over the limit: reject with 429 without recording this attempt.
    if (arr.length >= max) return next(new HttpError(429, 'rate_limited', 'Too many requests — please try again shortly.'));
    // Record this hit, and once the map gets big drop IPs with no recent hits so memory stays bounded.
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    next();
  };
}
