// Small HTTP toolkit shared by the routes: typed errors, async wrapping, and JSON replies.
// Same shape as the main app's API (`{ error: { code, message } }`) so one client can talk to both.
export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const bad = (message, code = 'bad_request') => new HttpError(400, code, message);
export const unauthorized = (message = 'Missing or invalid API token.') => new HttpError(401, 'unauthorized', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);

/** Wraps an async route handler so a rejected promise becomes a 500 instead of a hung request. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Turns any thrown value into the API's error envelope. Only authored errors reach the client. */
export function errorHandler(err, _req, res, _next) {
  const status = Number(err?.status) || 500;
  const authored = err instanceof HttpError || (Number.isInteger(err?.status) && typeof err?.code === 'string');
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: {
      code: authored && typeof err.code === 'string' ? err.code : status >= 500 ? 'server_error' : 'bad_request',
      message: authored && err.message ? err.message : status >= 500 ? 'Something went wrong.' : 'That request couldn’t be completed.',
    },
  });
}

/** Per-IP sliding-window rate limit for the few endpoints worth protecting (login-less API, so cheap and in-memory). */
export function rateLimit(name, max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${name}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      res.set('Retry-After', String(Math.ceil((windowMs - (now - list[0])) / 1000)));
      return next(new HttpError(429, 'rate_limited', 'Too many requests — please slow down.'));
    }
    list.push(now); hits.set(key, list);
    // Keep the map from growing without bound on a busy public host.
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    next();
  };
}
