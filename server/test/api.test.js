import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { dbConfigFromEnv } from '../src/config.js';

/**
 * Integration tests against a real MySQL server. Point them at one with TEST_DATABASE_URL
 * (default mysql://root@127.0.0.1:3306). Each run creates and drops its own throw-away database.
 */
const base_cfg = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...base_cfg, database: `addabaaz_test_${process.pid}_${Date.now().toString(36)}` };
let db, app, base, server;
test.before(async () => {
  try { db = await createDb({ config, ensureDatabase: true }); }
  catch (e) { throw new Error(`MySQL is not reachable (${e.code || e.message}). Start MySQL or set TEST_DATABASE_URL=mysql://user:pass@host:3306`); }
  await migrate(db);
  app = createApp({ db, jwtSecret: 'test-secret', rate: false });
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
test.after(async () => { server?.close(); if (db) { await db.dropDatabase(); await db.close(); } });

const call = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

test('health + catalog + plans are public', async () => {
  const h = await call('GET', '/health'); assert.equal(h.status, 200); assert.equal(h.body.service, 'addabaaz'); assert.equal(h.body.db, 'up');
  assert.equal((await call('GET', '/health/ready')).status, 200);
  const c = await call('GET', '/catalog'); assert.ok(c.body.shows.length >= 3); assert.ok(c.body.videos.length > 100);
  assert.ok((await call('GET', '/plans')).body.plans.some((p) => p.id === 'free'));
});

test('auth: validation, signup, duplicate, login, me', async () => {
  assert.equal((await call('POST', '/auth/signup', { name: 'A', email: 'nope', password: 'longenough' })).status, 400);
  assert.equal((await call('POST', '/auth/signup', { name: 'A', email: 'a@b.co', password: 'short' })).status, 400);
  const s = await call('POST', '/auth/signup', { name: 'Rupa Sen', email: 'Rupa@Example.com', password: 'correct horse' });
  assert.equal(s.status, 201); assert.ok(s.body.token); assert.equal(s.body.user.email, 'rupa@example.com'); assert.equal(s.body.profiles.length, 1);
  assert.equal(s.body.user.passwordHash, undefined);
  assert.equal((await call('POST', '/auth/signup', { name: 'X', email: 'rupa@example.com', password: 'correct horse' })).status, 409);
  assert.equal((await call('POST', '/auth/login', { email: 'rupa@example.com', password: 'wrong password' })).status, 401);
  const l = await call('POST', '/auth/login', { email: 'rupa@example.com', password: 'correct horse' }); assert.equal(l.status, 200);
  const me = await call('GET', '/me', null, l.body.token); assert.equal(me.body.user.name, 'Rupa Sen'); assert.equal(me.body.subscription.planId, 'free');
});

test('protected routes reject missing/forged tokens', async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', null, 'a.b.c')).status, 401);
});

test('profiles + library (list, progress, reminders) are isolated per user', async () => {
  const a = (await call('POST', '/auth/signup', { name: 'Al', email: 'al@example.com', password: 'password123' })).body;
  const b = (await call('POST', '/auth/signup', { name: 'Bo', email: 'bo@example.com', password: 'password123' })).body;
  const pid = a.profiles[0].id;

  const np = await call('POST', '/profiles', { name: 'Kids' }, a.token); assert.equal(np.status, 201);
  assert.equal((await call('PATCH', `/profiles/${np.body.profile.id}`, { name: 'Junior', color: 3 }, a.token)).body.profile.color, 3);
  assert.equal((await call('POST', '/profiles', { name: '' }, a.token)).status, 400);
  assert.equal((await call('GET', `/profiles/${pid}/library`, null, b.token)).status, 404);   // not b's profile

  assert.equal((await call('PUT', `/profiles/${pid}/list/show/shahid`, null, a.token)).status, 204);
  assert.equal((await call('PUT', `/profiles/${pid}/list/show/shahid`, null, a.token)).status, 204);  // idempotent
  assert.equal((await call('PUT', `/profiles/${pid}/list/show/nope`, null, a.token)).status, 404);
  assert.equal((await call('PUT', `/profiles/${pid}/list/bogus/shahid`, null, a.token)).status, 404);
  const vid = (await call('GET', '/catalog')).body.videos.find((v) => v.kind === 'episode').id;
  assert.equal((await call('PUT', `/profiles/${pid}/progress/${vid}`, { position: 42.9, duration: 600 }, a.token)).status, 204);
  assert.equal((await call('PUT', `/profiles/${pid}/progress/${vid}`, { position: -1, duration: 600 }, a.token)).status, 400);
  assert.equal((await call('PUT', `/profiles/${pid}/reminders/trap`, null, a.token)).status, 204);

  const lib = (await call('GET', `/profiles/${pid}/library`, null, a.token)).body;
  assert.equal(lib.list.length, 1); assert.equal(lib.progress[vid].position, 42); assert.deepEqual(lib.reminders, ['trap']);

  await call('DELETE', `/profiles/${pid}/list/show/shahid`, null, a.token);
  await call('DELETE', `/profiles/${pid}/progress/${vid}`, null, a.token);
  await call('DELETE', `/profiles/${pid}/reminders/trap`, null, a.token);
  assert.deepEqual((await call('GET', `/profiles/${pid}/library`, null, a.token)).body, { list: [], progress: {}, reminders: [] });

  assert.equal((await call('DELETE', `/profiles/${np.body.profile.id}`, null, a.token)).status, 204);
  assert.equal((await call('DELETE', `/profiles/${pid}`, null, a.token)).status, 409);          // last profile
});

test('subscription lifecycle (mock provider)', async () => {
  const u = (await call('POST', '/auth/signup', { name: 'Su', email: 'su@example.com', password: 'password123' })).body;
  assert.equal((await call('POST', '/subscription', { planId: 'nope' }, u.token)).status, 400);
  const s = await call('POST', '/subscription', { planId: 'plus-monthly' }, u.token); assert.equal(s.status, 201); assert.equal(s.body.subscription.planId, 'plus-monthly');
  assert.equal((await call('GET', '/me', null, u.token)).body.subscription.planId, 'plus-monthly');
  assert.equal((await call('DELETE', '/subscription', null, u.token)).body.subscription.planId, 'free');
});

test('contact form: validates, honeypot ignored, stored', async () => {
  assert.equal((await call('POST', '/contact', { name: 'x' })).status, 400);
  const before = await db.contacts.count();
  assert.equal((await call('POST', '/contact', { name: 'Bot', email: 'b@b.co', message: 'hi', website: 'spam.com' })).status, 202);
  assert.equal(await db.contacts.count(), before);
  assert.equal((await call('POST', '/contact', { name: 'Real', email: 'r@b.co', message: 'A film project' })).status, 202);
  assert.equal(await db.contacts.count(), before + 1);
});

test('account deletion removes user data', async () => {
  const u = (await call('POST', '/auth/signup', { name: 'Del', email: 'del@example.com', password: 'password123' })).body;
  assert.equal((await call('DELETE', '/me', null, u.token)).status, 204);
  assert.equal((await call('GET', '/me', null, u.token)).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'del@example.com', password: 'password123' })).status, 401);
  for (const t of ['profiles', 'subscriptions']) {          // FK cascade left nothing behind
    const [[{ n }]] = await db.pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, [u.user.id]); assert.equal(n, 0);
  }
});

test('errors are JSON, static site is served', async () => {
  const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'invalid_json');
  const root = base.replace('/api/v1', '');
  assert.equal((await fetch(root + '/')).status, 200);
  assert.equal((await fetch(root + '/data/catalog.json')).status, 200);
  assert.equal((await fetch(root + '/server/src/app.js')).status, 404);      // server code is never exposed
  assert.equal((await fetch(root + '/package.json')).status, 404);
});

test('schema: migrations are recorded and re-running is a no-op', async () => {
  assert.deepEqual(await migrate(db), []);
  const [rows] = await db.pool.query('SELECT version FROM schema_migrations'); assert.ok(rows.length >= 1);
  const [t] = await db.pool.query("SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'schema_migrations'");
  assert.ok(t.length >= 7); assert.ok(t.every((x) => x.ENGINE === 'InnoDB'));
});

test('data integrity: case-sensitive ids, Unicode names, cascade delete, profile cap, progress upsert', async () => {
  const u = (await call('POST', '/auth/signup', { name: 'সুমিত নন্দী', email: 'bn@example.com', password: 'password123' })).body;
  assert.equal(u.user.name, 'সুমিত নন্দী'); assert.equal(u.profiles[0].name, 'সুমিত');
  assert.equal((await call('GET', '/me', null, u.token)).body.user.name, 'সুমিত নন্দী');       // utf8mb4 round-trip
  const pid = u.profiles[0].id;
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/profiles', { name: 'P' + i }, u.token)).status, 201);
  assert.equal((await call('POST', '/profiles', { name: 'Six' }, u.token)).status, 409);        // limit 5
  const vids = (await call('GET', '/catalog')).body.videos.filter((v) => v.kind === 'episode');
  const vid = vids[0].id;
  await call('PUT', `/profiles/${pid}/progress/${vid}`, { position: 10, duration: 100 }, u.token);
  await call('PUT', `/profiles/${pid}/progress/${vid}`, { position: 55, duration: 100 }, u.token);   // upsert, single row
  const lib = (await call('GET', `/profiles/${pid}/library`, null, u.token)).body;
  assert.equal(Object.keys(lib.progress).length, 1); assert.equal(lib.progress[vid].position, 55);
  assert.match(lib.progress[vid].updatedAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  await call('PUT', `/profiles/${pid}/list/video/${vid}`, null, u.token);
  await db.library.addListItem(pid, 'video', 'AbCdEfGhIjK'); await db.library.addListItem(pid, 'video', 'abcdefghijk');   // utf8mb4_bin: distinct ids
  assert.equal((await call('GET', `/profiles/${pid}/library`, null, u.token)).body.list.length, 3);
  const [[{ hours }]] = await db.pool.query('SELECT TIMESTAMPDIFF(MINUTE, (SELECT MAX(added_at) FROM list_items WHERE profile_id = ?), UTC_TIMESTAMP()) AS hours', [pid]);
  assert.ok(Math.abs(hours) <= 1);                                                                                         // DB clock is stored in UTC
  assert.equal((await call('DELETE', '/me', null, u.token)).status, 204);
  const [[{ n }]] = await db.pool.query('SELECT (SELECT COUNT(*) FROM list_items WHERE profile_id = ?) + (SELECT COUNT(*) FROM watch_progress WHERE profile_id = ?) AS n', [pid, pid]);
  assert.equal(n, 0);
});

test('concurrent signups with one email create exactly one account', async () => {
  const r = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/auth/signup', { name: 'Race', email: 'race@example.com', password: 'password123' })));
  assert.equal(r.filter((x) => x.status === 201).length, 1); assert.equal(r.filter((x) => x.status === 409).length, 5);
});

test('progress history is capped at 500 rows per profile', async () => {
  const u = (await call('POST', '/auth/signup', { name: 'Cap', email: 'cap@example.com', password: 'password123' })).body;
  const pid = u.profiles[0].id;
  const rows = Array.from({ length: 503 }, (_, i) => [pid, 'vid' + i, i, 100, new Date(Date.now() - (503 - i) * 1000)]);
  await db.pool.query('INSERT INTO watch_progress (profile_id, video_id, position_sec, duration_sec, updated_at) VALUES ?', [rows]);
  const vid = (await call('GET', '/catalog')).body.videos[0].id;
  assert.equal((await call('PUT', `/profiles/${pid}/progress/${vid}`, { position: 1, duration: 2 }, u.token)).status, 204);
  const [[{ n }]] = await db.pool.query('SELECT COUNT(*) AS n FROM watch_progress WHERE profile_id = ?', [pid]);
  assert.equal(n, 500);
  const lib = (await call('GET', `/profiles/${pid}/library`, null, u.token)).body; assert.ok(lib.progress[vid]); assert.equal(lib.progress.vid0, undefined);
});
