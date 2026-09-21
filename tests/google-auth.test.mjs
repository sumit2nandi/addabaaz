import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateAuthConfig, verifyGoogleCredential, GOOGLE_CERTS_URL } from '../assets/js/google-auth.js';
import { clientId, email, jwk, token } from './google-fixture.mjs';
const config = validateAuthConfig({ clientId, allowedEmails: [email] });
const nonce = 'single-page-random-nonce';
const fetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = async url => { assert.equal(url, GOOGLE_CERTS_URL); return Response.json({ keys: [jwk] }); }; });
afterEach(() => { globalThis.fetch = fetch; });

test('Google login fails closed without a client ID and explicit allowlist', () => {
  for (const value of [null, {}, { clientId, allowedEmails: [] }, { clientId, allowedEmails: ['*'] }]) assert.throws(() => validateAuthConfig(value));
  assert.deepEqual(validateAuthConfig({ clientId, allowedEmails: ['Editor@Example.Test'] }).allowedEmails, [email]);
});
test('verifies Google RSA signature and returns only account identity and expiry', async () => {
  const result = await verifyGoogleCredential(token(nonce), config, nonce);
  assert.equal(result.email, email);
  assert.equal(Object.keys(result).length, 2);
  assert.ok(result.expiresAt > Date.now());
});
test('rejects modified signatures and unsigned tokens', async () => {
  const credential = token(nonce);
  const [header, payload, signature] = credential.split('.');
  const modified = Buffer.from(signature, 'base64url'); modified[0] ^= 1;
  await assert.rejects(verifyGoogleCredential(`${header}.${payload}.${modified.toString('base64url')}`, config, nonce), /signature is invalid/);
  await assert.rejects(verifyGoogleCredential(token(nonce, {}, { alg: 'none' }), config, nonce), /Unsupported/);
});
test('rejects wrong audience, issuer, nonce, expiry and unverified or unlisted accounts', async () => {
  const invalidClaims = [
    { aud: 'another-client.apps.googleusercontent.com' }, { iss: 'https://example.test' },
    { nonce: 'another-page' }, { exp: Math.floor(Date.now() / 1000) - 1 }, { iat: Math.floor(Date.now() / 1000) + 600 },
    { email_verified: false }, { email: 'unlisted@example.test' }, { azp: 'different-client' }, { sub: '' }
  ];
  for (const claims of invalidClaims) await assert.rejects(verifyGoogleCredential(token(nonce, claims), config, nonce));
});
test('malformed tokens, missing signing keys and verification outages remain locked', async () => {
  for (const value of [null, '', 'abc', 'a.b.c', 'x'.repeat(17000)]) await assert.rejects(verifyGoogleCredential(value, config, nonce));
  globalThis.fetch = async () => Response.json({ keys: [] });
  await assert.rejects(verifyGoogleCredential(token(nonce), config, nonce), /key was not found/);
  globalThis.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(verifyGoogleCredential(token(nonce), config, nonce), /Could not verify/);
});
