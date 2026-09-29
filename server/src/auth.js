import crypto from 'node:crypto';

const b64 = (b) => Buffer.from(b).toString('base64url');
const TTL_SECONDS = 60 * 60 * 24 * 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const test = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  const good = Buffer.from(hash, 'hex');
  return test.length === good.length && crypto.timingSafeEqual(test, good);
}
/** Minimal HS256 JWT. `claims` may carry `aud` to scope a token (session tokens have none; media tokens use "media"). */
export function signJwt(claims, secret, ttl = TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ ...claims, iat: now, exp: now + ttl }))}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}
/** Session token. `sv` is the user's session_version: bumping it (password reset, "sign out everywhere") invalidates every older token. */
export const signToken = (userId, secret, ttl = TTL_SECONDS, sv = 0) => signJwt({ sub: userId, ...(sv ? { sv } : {}) }, secret, ttl);
export const sessionValid = (payload, user) => (payload.sv || 0) === (user.sessionVersion || 0);
/** Returns the claims of a valid, unexpired token, else null. */
export function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expect = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return p.exp > Math.floor(Date.now() / 1000) ? p : null;
  } catch { return null; }
}
