// API authentication: one shared secret (CONVERTER_TOKEN) compared in constant time.
//
// The service is an operator tool, not a public website: every /api/v1 route below needs the token,
// sent as `Authorization: Bearer <token>` or `x-api-token`. The portal keeps it in localStorage and
// sends it on every request; curl and the Admin console do the same.
import crypto from 'node:crypto';
import { HttpError, unauthorized } from './http.js';

const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();

export function requireToken(token) {
  const usable = typeof token === 'string' && token.length >= 24;
  return (req, _res, next) => {
    if (!usable) return next(new HttpError(503, 'not_configured', 'CONVERTER_TOKEN is not set on the server (at least 24 characters) — the portal and the API are disabled until it is.'));
    const header = req.get('authorization') || '';
    const supplied = (header.replace(/^Bearer\s+/i, '') || req.get('x-api-token') || '').trim();
    if (!supplied || !crypto.timingSafeEqual(digest(supplied), digest(token))) return next(unauthorized());
    next();
  };
}

/** True when the request carries the service token — used by the few “is this the operator?” checks. */
export const tokenMatches = (supplied, token) => {
  if (!supplied || !token || String(token).length < 24) return false;
  const a = digest(supplied), b = digest(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
