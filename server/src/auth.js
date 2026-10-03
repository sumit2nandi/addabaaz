// Password hashing and signed session tokens, built only on Node's crypto module (no extra dependencies).
import crypto from 'node:crypto';

// base64url encoder used for the JWT parts.
const b64 = (b) => Buffer.from(b).toString('base64url');
// Default session lifetime: 30 days.
const TTL_SECONDS = 60 * 60 * 24 * 30;

// Use Node's asynchronous scrypt worker pool so password checks never block the HTTP event loop.
const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key));
});
// A valid-looking dummy hash keeps unknown-email login attempts doing the same expensive work as real accounts.
export const DUMMY_PASSWORD_HASH = `scrypt${'$'}${'00'.repeat(16)}${'$'}${'00'.repeat(64)}`;

// Hashes a password with scrypt and a random 16-byte salt. Stored format: scrypt$<salt hex>$<hash hex>.
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt);
  return `scrypt${'$'}${salt.toString('hex')}${'$'}${hash.toString('hex')}`;
}
// Recomputes the hash with the stored salt and compares in constant time (avoids timing attacks).
export async function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !/^[0-9a-f]{32}$/i.test(salt || '') || !/^[0-9a-f]{128}$/i.test(hash || '')) return false;
  const test = await scrypt(password, Buffer.from(salt, 'hex'));
  const good = Buffer.from(hash, 'hex');
  return crypto.timingSafeEqual(test, good);
}

/** Rejects missing, short, and known example JWT secrets before production serves any requests. */
export function assertProductionSecret(secret) {
  const placeholders = /(?:change[-_ ]?me|replace[-_ ]?me|example|sample|placeholder|insecure-development-secret)/i;
  if (typeof secret !== 'string' || secret !== secret.trim() || Buffer.byteLength(secret, 'utf8') < 32 || placeholders.test(secret)) {
    throw new Error('JWT_SECRET must be a unique, randomly generated value of at least 32 bytes (for example, 64 hexadecimal characters); do not use the example value.');
  }
  return secret;
}
/** Minimal HS256 JWT. `claims` may carry `aud` to scope a token (session tokens have none; media tokens use "media"). */
// Builds the token: header.payload.signature, signed with HMAC-SHA256; `iat`/`exp` are added automatically.
export function signJwt(claims, secret, ttl = TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ ...claims, iat: now, exp: now + ttl }))}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}
/** Session token. `sv` is the user's session_version: bumping it (password reset, "sign out everywhere") invalidates every older token. */
export const signToken = (userId, secret, ttl = TTL_SECONDS, sv = 0) => signJwt({ sub: userId, ...(sv ? { sv } : {}) }, secret, ttl);
// A token is only valid while its session version matches the user's current one.
export const sessionValid = (payload, user) => (payload.sv || 0) === (user.sessionVersion || 0);
/** Returns the claims of a valid, unexpired token, else null. */
// Checks the signature (constant-time) and expiry before trusting anything in the payload.
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
