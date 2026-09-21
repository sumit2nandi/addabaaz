import { generateKeyPairSync, sign } from 'node:crypto';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const clientId = 'test-client.apps.googleusercontent.com';
export const email = 'editor@example.test';
export const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
export function token(nonce, overrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid, ...headerOverrides })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: clientId, sub: 'google-test-user', iat: now, exp: now + 3600, email, email_verified: true, nonce, ...overrides })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
