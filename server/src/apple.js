import crypto from 'node:crypto';
import { SocialError } from './social.js';

/**
 * Sign in with Apple. The client (Apple JS on the web, the native SDK through Capacitor in the iOS app) obtains an
 * `identityToken` (an RS256 JWT). We verify it against Apple's published keys, issuer and audience — never trusting the client.
 *   APPLE_CLIENT_ID=in.addabaaz.app           (the app's bundle id — used by the iOS app)
 *   APPLE_SERVICE_ID=com.addabaaz.web         (a Services ID — used by the website; optional)
 * Apple only reports the user's name on the FIRST authorisation, and may hide the email behind a private relay address.
 */
// Apple's public signing keys (JWKS), used to verify identity tokens.
const APPLE_KEYS = 'https://appleid.apple.com/auth/keys';
const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// Returns a key lookup by `kid` with a one-hour cache.
export function appleJwks(fetchImpl = fetch) {
  let keys = null, at = 0;
  return async (kid) => {
    if (!keys || Date.now() - at > 3_600_000 || (kid && !keys.some((k) => k.kid === kid) && Date.now() - at > 10_000)) {
      const r = await fetchImpl(APPLE_KEYS).catch(() => null);
      if (!r?.ok) throw new SocialError('provider_unavailable', 'Could not reach Apple to verify your sign-in.');
      keys = (await r.json()).keys || []; at = Date.now();
    }
    return keys.find((k) => k.kid === kid) || null;
  };
}

/** @returns {(credential: string | {identityToken: string, name?: string}) => Promise<{provider:'apple', subject, email, emailVerified, name}>} */
export function createAppleVerifier({ clientIds, getKey = appleJwks() }) {
  const audiences = new Set(clientIds);
  return async function verifyApple(credential) {
    const bad = () => new SocialError('invalid_credential', 'Apple sign-in failed. Please try again.');
    // The web SDK sends a bare token; the native app sends { identityToken, name } because Apple only gives the name on first sign-in.
    const token = typeof credential === 'object' && credential ? credential.identityToken : credential;
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw bad();
    let header, claims;
    try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { throw bad(); }
    // Same checks as the Google verifier: RS256 only, valid signature, issuer, audience and expiry.
    if (header.alg !== 'RS256') throw bad();
    const jwk = await getKey(header.kid); if (!jwk) throw bad();
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    const now = Math.floor(Date.now() / 1000);
    if (!ok || claims.iss !== 'https://appleid.apple.com' || !audiences.has(claims.aud) || !(claims.exp > now - 30) || !claims.sub) throw bad();
    const name = typeof credential === 'object' && credential?.name ? String(credential.name).trim().slice(0, 60) : '';
    return { provider: 'apple', subject: String(claims.sub), email: claims.email ? String(claims.email).toLowerCase() : null, emailVerified: claims.email_verified === true || claims.email_verified === 'true', name };
  };
}
