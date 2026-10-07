import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeatures } from '../src/features.js';
import { verifyPassword, verifyToken, signJwt } from '../src/auth.js';
import { readFileSync } from 'node:fs';

function fixture() {
  const user = { id: 'owner', email: 'parent@example.com', emailVerifiedAt: 'yes', hasPin: true };
  let hash = 'old-hash', tokenHash, consumed = false, last = null, sent = null;
  const db = {
    users: { byId: async (id) => id === user.id ? user : null },
    accounts: { pin: async () => ({ hash }), setPin: async (_id, value) => { hash = value; } },
    authTokens: {
      lastIssuedAt: async () => last,
      issue: async (_uid, purpose, value) => { assert.equal(purpose, 'pin_reset'); tokenHash = value; consumed = false; },
      consume: async (value, purpose) => { if (purpose !== 'pin_reset' || value !== tokenHash || consumed) return null; consumed = true; return user.id; },
    },
  };
  const routes = new Map();
  const api = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((method) => [method, (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1))]));
  const secret = 'test-secret-parental';
  const mailer = { provider: 'smtp', send: async (message) => { sent = message; return { sent: true }; } };
  const features = createFeatures({ db, secret, mailer, rate: false, siteUrl: 'https://example.com', notDisabled: (u) => { if (u.disabledAt) throw Object.assign(new Error('disabled'), { status: 403 }); } });
  features.public(api); features.authed(api);
  const call = async (path, body = {}) => {
    let status = 200;
    const res = { status(n) { status = n; return this; }, json() {}, sendStatus(n) { status = n; } };
    await routes.get(`post ${path}`)({ user, body }, res, (error) => { throw error; });
    return status;
  };
  const token = () => {
    const link = `${sent.text || ''} ${sent.html || ''}`.match(/token=([^\s"<>]+)/)[1];
    return decodeURIComponent(link.replace(/&amp;.*/, ''));
  };
  return { user, call, token, secret, mailer, setLast: (v) => { last = v; }, getHash: () => hash, changeHash: (v) => { hash = v; } };
}

test('verified email recovery sets a new PIN once, without issuing a login credential', async () => {
  const f = fixture();
  assert.equal(await f.call('/me/pin/forgot'), 202);
  const token = f.token();
  const claims = verifyToken(token, f.secret);
  assert.equal(claims.sub, undefined);
  assert.equal(claims.exp - claims.iat, 900);
  assert.equal(await f.call('/auth/pin/reset', { token, pin: '5678' }), 204);
  assert.ok(await verifyPassword('5678', f.getHash()));
  await assert.rejects(f.call('/auth/pin/reset', { token, pin: '1234' }));
});

test('requires a verified email and applies resend cooldown and mail errors', async () => {
  const f = fixture(); f.user.emailVerifiedAt = null;
  await assert.rejects(f.call('/me/pin/forgot'), { code: 'verified_email_required' });
  f.user.emailVerifiedAt = 'yes'; f.setLast(new Date());
  await assert.rejects(f.call('/me/pin/forgot'), { status: 429 });
  f.setLast(null); f.mailer.send = async () => { throw new Error('offline'); };
  await assert.rejects(f.call('/me/pin/forgot'), { status: 503 });
});

test('rejects changed email, removed PIN, disabled accounts, malformed PIN and wrong-purpose/expired tokens', async () => {
  for (const mutate of [(f) => { f.user.email = 'other@example.com'; }, (f) => f.changeHash(null), (f) => { f.user.disabledAt = 'yes'; }]) {
    const f = fixture(); await f.call('/me/pin/forgot'); const token = f.token(); mutate(f);
    await assert.rejects(f.call('/auth/pin/reset', { token, pin: '1234' }));
  }
  const f = fixture(); await f.call('/me/pin/forgot');
  await assert.rejects(f.call('/auth/pin/reset', { token: f.token(), pin: '12' }), { code: 'invalid_pin' });
  for (const token of ['invalid', signJwt({ aud: 'other', uid: 'owner' }, f.secret), signJwt({ aud: 'parental-pin-reset', uid: 'owner' }, f.secret, -1)]) {
    await assert.rejects(f.call('/auth/pin/reset', { token, pin: '1234' }), { code: 'invalid_token' });
  }
});

test('admin PIN removal is behind existing admin guard and records its action', () => {
  const source = readFileSync(new URL('../src/admin.js', import.meta.url), 'utf8');
  assert.match(source, /router.delete\('\/users\/:id\/parental-pin'[\s\S]*?userOr404[\s\S]*?db.accounts.setPin\(u.id, null\)[\s\S]*?log\(req, 'user.parental_pin.remove', u.id\)/);
});
