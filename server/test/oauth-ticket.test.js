// Native Google sign-in: the app opens /auth/google/native-start in a Custom Tab; Google redirects
// (implicit id_token flow) to /auth/google/native-return, whose page turns the verified id_token into
// a single-use ticket and deep-links it into the app; /auth/ticket exchanges it for a session.
// Needs MySQL (CI); see api.test.js. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { dbConfigFromEnv } from '../src/config.js';
import { signJwt } from '../src/auth.js';

// Must be set BEFORE createApp: the Google verifier and the start endpoint key off it.
process.env.GOOGLE_CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';

const base_cfg = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...base_cfg, database: `addabaaz_test_oauth_${process.pid}_${Date.now().toString(36)}` };
let db, app, base, server;
test.before(async () => {
  try { db = await createDb({ config, ensureDatabase: true }); }
  catch (e) { throw new Error(`MySQL is not reachable (${e.code || e.message}). Start MySQL or set TEST_DATABASE_URL.`); }
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

test('native-page is a CSP-safe page that shows the website\'s own Google button in the Custom Tab', async () => {
  const page = await fetch(`${base}/auth/google/native-page`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /src="\/api\/v1\/auth\/google-native\.js"/, 'no inline script (the site CSP forbids it)');
  const js = await fetch(`${base}/auth/google-native.js`);
  assert.equal(js.status, 200);
  const src = await js.text();
  assert.match(src, /accounts\.google\.com\/gsi\/client/, 'same Google Identity Services SDK as the website (origin already authorized)');
  assert.match(src, /renderButton/, 'a real Google button, no redirect URIs involved');
  assert.match(src, /in\.addabaaz\.app:\/\/oauth\?ticket=/, 'deep-links the ticket back into the app');
});

test('a ticket mints a session exactly once; garbage and reuse are refused', async () => {
  const s = await call('POST', '/auth/signup', { name: 'OAuth Tester', email: 'oauth@example.com', password: 'correct horse' });
  assert.equal(s.status, 201);
  const userId = s.body.user.id;

  const ticket = signJwt({ aud: 'oauth-ticket', sub: userId, sv: 0, jti: 't-1' }, 'test-secret', 120);
  const ok = await call('POST', '/auth/ticket', { ticket });
  assert.equal(ok.status, 200, 'the app exchanges the ticket for a session');
  assert.equal(ok.body.user.email, 'oauth@example.com');
  assert.ok(ok.body.token && ok.body.profiles);

  const again = await call('POST', '/auth/ticket', { ticket });
  assert.equal(again.status, 401, 'a ticket works exactly once');
  assert.equal((await call('POST', '/auth/ticket', { ticket: 'nonsense' })).status, 401);
  const wrongAud = signJwt({ aud: 'media', sub: userId, jti: 't-2' }, 'test-secret', 120);
  assert.equal((await call('POST', '/auth/ticket', { ticket: wrongAud })).status, 401, 'tokens with another audience are not tickets');
});

test('google sign-in with ticket:true never leaks a session to the browser that verified it', async () => {
  const r = await call('POST', '/auth/google', { idToken: 'garbage', ticket: true });
  assert.equal(r.status, 401, 'an unverifiable id_token is refused before any ticket is minted');
  assert.equal(r.body?.token, undefined);
});
