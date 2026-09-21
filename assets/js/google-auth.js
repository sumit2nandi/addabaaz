// Identity verification for the static editor's UI gate, NOT server authorization.
// All hosted files remain public on GitHub Pages. Never use this to protect an API.
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export function validateAuthConfig(config) {
  if (!config || typeof config.clientId !== 'string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) {
    throw new Error('Google sign-in is not configured. Set clientId in config/admin-auth.json to your Google OAuth Web client ID.');
  }
  if (!Array.isArray(config.allowedEmails) || !config.allowedEmails.length || config.allowedEmails.some(email => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('No valid admin allowlist is configured. Add the permitted Google email addresses to allowedEmails in config/admin-auth.json.');
  }
  return { clientId: config.clientId, allowedEmails: config.allowedEmails.map(email => email.toLowerCase()) };
}

function decodeBase64Url(value) {
  if (!/^[\w-]+$/.test(value)) throw new Error('Invalid Google sign-in response.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

export async function verifyGoogleCredential(credential, config, nonce) {
  if (typeof credential !== 'string' || credential.length > 16384 || !nonce) throw new Error('Invalid Google sign-in response.');
  const parts = credential.split('.');
  if (parts.length !== 3) throw new Error('Invalid Google sign-in response.');
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch { throw new Error('Invalid Google sign-in response.'); }
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported Google sign-in signature.');
  const response = await fetch(GOOGLE_CERTS_URL, { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Could not verify Google sign-in. Please try again.');
  const keyset = await response.json();
  const jwk = keyset.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256'));
  if (!jwk) throw new Error('Google signing key was not found. Please sign in again.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error('Google sign-in signature is invalid.');
  const now = Date.now() / 1000;
  if (!claims || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
      claims.aud !== config.clientId || (claims.azp && claims.azp !== config.clientId) || claims.nonce !== nonce ||
      typeof claims.sub !== 'string' || !claims.sub || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) ||
      claims.exp <= now || claims.exp > now + 86400 || claims.iat > now + 60 || claims.iat >= claims.exp) {
    throw new Error('Google sign-in is expired or was issued for a different page. Please sign in again.');
  }
  if (claims.email_verified !== true || typeof claims.email !== 'string' || !config.allowedEmails.includes(claims.email.toLowerCase())) {
    throw new Error('This Google account is not permitted to use the editor. Sign in with an allowed account.');
  }
  return { email: claims.email, expiresAt: claims.exp * 1000 };
}
