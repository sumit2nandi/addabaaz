// Public guest push registration is validated, rate-limited by the features layer, and stores only an anonymous device token.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFeatures } from '../src/features.js';
import { extraDb } from '../src/db-extra.js';
import { endpointHash } from '../src/push.js';

let server, base;
const saved = [], removed = [], prefs = {};
const patched_prefs = (hash) => prefs[hash];
before(async () => {
  const db = { devices: {
    async upsertGuest(device) { saved.push(device); },
    async removeHash(hash) { removed.push(hash); delete prefs[hash]; },
    async getPrefs(hash) { return prefs[hash] || null; },
    async setPrefs(hash, p) { prefs[hash] = { ...(prefs[hash] || { episodes: true, launches: true, news: false }), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) }; return 1; },
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
  // No prefs in the body (the app's guest mode sends none) — the device keeps the server defaults.
  assert.deepEqual(saved, [{ hash: endpointHash(token), token, platform: 'android', label: 'Android app', prefs: null }]);

  const deleted = await call('DELETE', '/devices/guest', { token });
  assert.equal(deleted.status, 204);
  assert.deepEqual(removed, [endpointHash(token)]);
});

test('guest registration refuses malformed tokens and does not write them', async () => {
  const response = await call('POST', '/devices/guest', { token: 'too-short' });
  assert.equal(response.status, 400);
  assert.equal(saved.length, 1);
});

test('the device choices are read and written by token possession, and validated', async () => {
  const token = 'guest-route-prefs-' + 'd'.repeat(30), hash = endpointHash(token);
  prefs[hash] = { episodes: true, launches: true, news: false };

  const status = await call('POST', '/devices/status', { token });
  assert.equal(status.status, 200);
  assert.match(status.headers.get('cache-control'), /no-store/);
  assert.deepEqual((await status.json()).prefs, { episodes: true, launches: true, news: false });

  const patched = await call('PATCH', '/devices/prefs', { token, episodes: false, news: true });
  assert.equal(patched.status, 204);
  assert.deepEqual(patched_prefs(hash), { episodes: false, launches: true, news: true }, 'only what was sent changes');

  assert.equal((await call('PATCH', '/devices/prefs', { token, episodes: 'yes' })).status, 400, 'booleans only');
  assert.equal((await call('PATCH', '/devices/prefs', { token: 'too-short', news: true })).status, 400);
  const unknown = await call('POST', '/devices/status', { token: 'unknown-token-' + 'z'.repeat(20) });
  assert.equal(unknown.status, 200);
  assert.equal((await unknown.json()).prefs, null, 'an unknown token answers null, never someone else’s choices');
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
  assert.match(queries[0].sql, /episodes, launches, news/);
  assert.deepEqual(queries[0].params, ['android', hash, token, 'Android app', 1, 1, 0, 'android', 'Android app'],
    'a guest device starts on the same defaults as the browser: episodes/launches on, announcements off');
  await db.devices.removeHash(hash);
  assert.match(queries[1].sql, /DELETE FROM push_devices WHERE token_hash = \?/);
});

test('the device data layer applies a device’s own switches, exactly like a browser subscription', async () => {
  const queries = [];
  const db = extraDb({
    q: async (sql, params) => { queries.push({ sql, params }); return []; },
    tx: async (fn) => fn({ query: async (sql, params) => { queries.push({ sql, params }); return { affectedRows: 1 }; } }),
    iso: (value) => value,
  });
  const last = () => queries[queries.length - 1];
  // The three targeted audiences filter on the device’s own flag and keep the browser’s user lookup.
  await db.devices.audienceFor({ kind: 'episodes', showId: 'show-1', videoIds: ['v1'] });
  assert.match(last().sql, /WHERE pd\.episodes = 1 AND pd\.user_id IN \(/);
  assert.match(last().sql, /l\.item_type = 'show' AND l\.item_id = \?/);
  assert.deepEqual(last().params, ['show-1', ['v1']]);
  await db.devices.audienceFor({ kind: 'launches', upcomingId: 'up-1' });
  assert.match(last().sql, /WHERE pd\.launches = 1 AND/); assert.deepEqual(last().params, ['up-1']);
  await db.devices.audienceFor({ kind: 'news' });
  assert.match(last().sql, /WHERE pd\.news = 1$/);
  await db.devices.audienceFor({ kind: 'all' });
  assert.doesNotMatch(last().sql, /WHERE pd\.(episodes|launches|news|user_id)/, 'a general broadcast ignores the switches');
  await db.devices.audienceFor({ kind: 'user', userId: 'u1' });
  assert.match(last().sql, /WHERE pd\.user_id = \?/);
  // Writing sends only the switches it was given; an empty change is not a query.
  const before = queries.length;
  await db.devices.setPrefs('hash-1', { episodes: false, news: true });
  assert.match(last().sql, /UPDATE push_devices SET episodes = \?, news = \?, last_seen/);
  assert.deepEqual(last().params, [0, 1, 'hash-1']);
  assert.equal(await db.devices.setPrefs('hash-1', {}), 0);
  assert.equal(queries.length, before + 1, 'no empty update is sent');
  assert.equal(await db.devices.getPrefs('hash-1'), null, 'an unknown token reads as unknown, never as defaults');
});
