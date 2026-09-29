import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ab-')), 'db.json');
const app = createApp({ dbFile, jwtSecret: 'test-secret', rate: false });
let base, server;
test.before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
test.after(() => server.close());

const call = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

test('health + catalog + plans are public', async () => {
  const h = await call('GET', '/health'); assert.equal(h.status, 200); assert.equal(h.body.service, 'addabaaz');
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
  const before = app.db.data.contacts.length;
  assert.equal((await call('POST', '/contact', { name: 'Bot', email: 'b@b.co', message: 'hi', website: 'spam.com' })).status, 202);
  assert.equal(app.db.data.contacts.length, before);
  assert.equal((await call('POST', '/contact', { name: 'Real', email: 'r@b.co', message: 'A film project' })).status, 202);
  assert.equal(app.db.data.contacts.length, before + 1);
});

test('account deletion removes user data', async () => {
  const u = (await call('POST', '/auth/signup', { name: 'Del', email: 'del@example.com', password: 'password123' })).body;
  assert.equal((await call('DELETE', '/me', null, u.token)).status, 204);
  assert.equal((await call('GET', '/me', null, u.token)).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'del@example.com', password: 'password123' })).status, 401);
  assert.equal(app.db.data.profiles.some((p) => p.userId === u.user.id), false);
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
