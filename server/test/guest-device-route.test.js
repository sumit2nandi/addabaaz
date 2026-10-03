// Public guest push registration is validated, rate-limited by the features layer, and stores only an anonymous device token.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFeatures } from '../src/features.js';
import { extraDb } from '../src/db-extra.js';
import { endpointHash } from '../src/push.js';

let server, base;
const saved = [], removed = [];
before(async () => {
  const db = { devices: {
    async upsertGuest(device) { saved.push(device); },
    async removeHash(hash) { removed.push(hash); },
  } };
  const router = express.Router(); router.use(express.json());
  const features = createFeatures({
    db, secret: 'guest-device-test-secret', mailer: { provider: 'none' },
    push: { configured: false, nativeConfigured: false, publicKey: '' }, catalog: {}, siteUrl: '',
    rate: false, publicUser: () => ({}), notDisabled: (user) => user, userFromRequest: async () => null,
  });
  features.public(router);
  const app = express(); app.use('/api/v1', router);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: { message: err.message, code: err.code } }));
  server = app.listen(0); await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(() => server?.close());

const call = (method, path, body) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});

test('guests can register without sign-in and delete the token to opt out', async () => {
  const token = 'guest-route-token-' + 'a'.repeat(30);
  const response = await call('POST', '/devices/guest', { token, platform: 'android', label: 'Android app' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(saved, [{ hash: endpointHash(token), token, platform: 'android', label: 'Android app' }]);

  const deleted = await call('DELETE', '/devices/guest', { token });
  assert.equal(deleted.status, 204);
  assert.deepEqual(removed, [endpointHash(token)]);
});

test('guest registration refuses malformed tokens and does not write them', async () => {
  const response = await call('POST', '/devices/guest', { token: 'too-short' });
  assert.equal(response.status, 400);
  assert.equal(saved.length, 1);
});

test('the device data layer stores guest ownership as NULL and can remove a token without exposing it in a URL', async () => {
  const queries = [];
  const db = extraDb({
    q: async (sql, params) => { queries.push({ sql, params }); return { affectedRows: 1 }; },
    tx: async (fn) => fn({ query: async (sql, params) => { queries.push({ sql, params }); return { affectedRows: 1 }; } }),
    iso: (value) => value,
  });
  const token = 'guest-db-token-' + 'b'.repeat(30), hash = 'c'.repeat(64);
  await db.devices.upsertGuest({ hash, token, platform: 'android', label: 'Android app' });
  assert.match(queries[0].sql, /VALUES \(UUID\(\),NULL,COALESCE\(/);
  assert.match(queries[0].sql, /ON DUPLICATE KEY UPDATE user_id = NULL/);
  assert.deepEqual(queries[0].params, ['android', hash, token, 'Android app', 'android', 'Android app']);
  await db.devices.removeHash(hash);
  assert.match(queries[1].sql, /DELETE FROM push_devices WHERE token_hash = \?/);
});
