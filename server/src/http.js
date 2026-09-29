/** Shared HTTP helpers for the API and the admin router. */
export class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
export const bad = (msg, code = 'bad_request') => new HttpError(400, code, msg);
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Sliding-window in-memory rate limiter (per IP + bucket). Use Redis/edge limits when running multiple nodes. */
export function rateLimit(bucket, max, windowMs) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = `${bucket}:${req.ip}`; const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return next(new HttpError(429, 'rate_limited', 'Too many requests — please try again shortly.'));
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    next();
  };
}
