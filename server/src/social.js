import crypto from 'node:crypto';
import { createAppleVerifier } from './apple.js';

/**
 * Server-side verification of social sign-in credentials. The client obtains a credential from the provider
 * (web: Google Identity Services / Facebook JS SDK; apps: native SDK via Capacitor) and we verify it here —
 * the API never trusts profile data sent by the client.
 */
export class SocialError extends Error { constructor(code, message) { super(message); this.code = code; } }

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Fetches (and caches for an hour) Google's public signing keys. */
export function googleJwks(fetchImpl = fetch) {
  let keys = null, at = 0;
  return async (kid) => {
    const fresh = () => Date.now() - at < 3_600_000;
    if (!keys || !fresh() || (kid && !keys.some((k) => k.kid === kid))) {
      if (!keys || Date.now() - at > 10_000) {                       // don't hammer Google on bad kids
        const r = await fetchImpl(GOOGLE_JWKS_URL);
        if (!r.ok) throw new SocialError('provider_unavailable', 'Could not reach Google to verify your sign-in.');
        keys = (await r.json()).keys || []; at = Date.now();
      }
    }
    return keys.find((k) => k.kid === kid) || null;
  };
}

/**
 * Verifies a Google ID token (RS256 JWT): signature against Google's JWKS, issuer, audience (one of our client ids), expiry.
 * @returns {{provider:'google', subject:string, email:string|null, emailVerified:boolean, name:string}}
 */
export function createGoogleVerifier({ clientIds, getKey = googleJwks() }) {
  const audiences = new Set(clientIds);
  return async function verifyGoogle(idToken) {
    const bad = (m = 'Google sign-in failed. Please try again.') => new SocialError('invalid_credential', m);
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw bad();
    let header, claims;
    try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { throw bad(); }
    if (header.alg !== 'RS256') throw bad();
    const jwk = await getKey(header.kid);
    if (!jwk) throw bad();
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    const now = Math.floor(Date.now() / 1000);
    if (!ok || !GOOGLE_ISSUERS.has(claims.iss) || !audiences.has(claims.aud) || !(claims.exp > now - 30) || !claims.sub) throw bad();
    return { provider: 'google', subject: String(claims.sub), email: claims.email ? String(claims.email).toLowerCase() : null, emailVerified: claims.email_verified === true || claims.email_verified === 'true', name: claims.name || '' };
  };
}

/**
 * Verifies a Facebook user access token: `debug_token` (must be valid AND issued to OUR app) then reads the profile.
 * Requires the app secret (server side only).
 */
export function createFacebookVerifier({ appId, appSecret, version = 'v21.0', fetchImpl = fetch }) {
  const graph = `https://graph.facebook.com/${version}`;
  return async function verifyFacebook(accessToken) {
    const bad = () => new SocialError('invalid_credential', 'Facebook sign-in failed. Please try again.');
    if (typeof accessToken !== 'string' || accessToken.length < 10 || accessToken.length > 2048) throw bad();
    const get = async (url) => {
      let r; try { r = await fetchImpl(url); } catch { throw new SocialError('provider_unavailable', 'Could not reach Facebook to verify your sign-in.'); }
      if (r.status >= 500) throw new SocialError('provider_unavailable', 'Facebook is unavailable right now. Please try again.');
      return r.ok ? r.json() : null;
    };
    const dbg = await get(`${graph}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`);
    const d = dbg?.data;
    if (!d || d.is_valid !== true || String(d.app_id) !== String(appId) || !d.user_id) throw bad();
    const proof = crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
    const me = await get(`${graph}/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}&appsecret_proof=${proof}`);
    if (!me || String(me.id) !== String(d.user_id)) throw bad();
    return { provider: 'facebook', subject: String(me.id), email: me.email ? String(me.email).toLowerCase() : null, emailVerified: !!me.email, name: me.name || '' };   // Facebook only returns confirmed emails
  };
}

/** Builds the enabled verifiers from the environment. */
export function socialFromEnv(env = process.env) {
  const googleIds = [env.GOOGLE_CLIENT_ID, env.GOOGLE_IOS_CLIENT_ID, ...(env.GOOGLE_EXTRA_CLIENT_IDS || '').split(',')].map((s) => (s || '').trim()).filter(Boolean);
  const out = { config: {}, verifiers: {} };
  if (env.GOOGLE_CLIENT_ID) {
    out.verifiers.google = createGoogleVerifier({ clientIds: googleIds });
    out.config.google = { clientId: env.GOOGLE_CLIENT_ID.trim(), ...(env.GOOGLE_IOS_CLIENT_ID ? { iosClientId: env.GOOGLE_IOS_CLIENT_ID.trim() } : {}) };
  }
  if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) {
    out.verifiers.facebook = createFacebookVerifier({ appId: env.FACEBOOK_APP_ID.trim(), appSecret: env.FACEBOOK_APP_SECRET.trim(), version: env.FACEBOOK_GRAPH_VERSION || 'v21.0' });
    out.config.facebook = { appId: env.FACEBOOK_APP_ID.trim(), version: env.FACEBOOK_GRAPH_VERSION || 'v21.0', ...(env.FACEBOOK_CLIENT_TOKEN ? { clientToken: env.FACEBOOK_CLIENT_TOKEN.trim() } : {}) };
  }
  const appleIds = [env.APPLE_CLIENT_ID, env.APPLE_SERVICE_ID].map((s) => (s || '').trim()).filter(Boolean);
  if (appleIds.length) {
    out.verifiers.apple = createAppleVerifier({ clientIds: appleIds });
    out.config.apple = { clientId: (env.APPLE_SERVICE_ID || env.APPLE_CLIENT_ID).trim(), ...(env.APPLE_CLIENT_ID ? { bundleId: env.APPLE_CLIENT_ID.trim() } : {}) };
  }
  return out;
}
