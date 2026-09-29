// Tests for social sign-in (Google / Facebook, using fake providers) and premium video: R2 signed URLs,
// access rules (login + paid plan) and the HLS gateway. No network or real credentials are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { dbConfigFromEnv } from '../src/config.js';
import { presign, createR2 } from '../src/r2.js';
import { createGoogleVerifier, createFacebookVerifier, SocialError } from '../src/social.js';

/* ---------------- pure unit tests (no database) ---------------- */

test('R2 presigner reproduces the AWS SigV4 documented example', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const { signature } = presign({ host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', expires: 86400, now: new Date('2013-05-24T00:00:00Z') });
  assert.equal(signature, 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('createR2: not configured without credentials; presigned URLs are path-style, encoded and expiring', () => {
  assert.equal(createR2({}).configured, false);
  const r2 = createR2({ R2_ACCOUNT_ID: 'acct123', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK', R2_BUCKET: 'addabaaz-premium' });
  const u = new URL(r2.presignGet('shahid/ep 6/মূল.mp4', { ttl: 600, now: new Date('2026-01-01T00:00:00Z') }));
  assert.equal(u.host, 'acct123.r2.cloudflarestorage.com');
  assert.equal(u.pathname, '/addabaaz-premium/shahid/ep%206/%E0%A6%AE%E0%A7%82%E0%A6%B2.mp4');
  assert.equal(u.searchParams.get('X-Amz-Expires'), '600'); assert.equal(u.searchParams.get('X-Amz-Date'), '20260101T000000Z');
  assert.match(u.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/); assert.match(u.searchParams.get('X-Amz-Credential'), /^AK\/20260101\/auto\/s3\/aws4_request$/);
  assert.notEqual(r2.presignGet('a.mp4', { now: new Date('2026-01-01T00:00:00Z') }), r2.presignGet('b.mp4', { now: new Date('2026-01-01T00:00:00Z') }));
});

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const gToken = (claims = {}, { key = privateKey, kid = 'k1', alg = 'RS256' } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg, kid, typ: 'JWT' })}.${b64({ iss: 'https://accounts.google.com', aud: 'g-web', sub: 'g-1', email: 'Aparna@Example.com', email_verified: true, name: 'Aparna Roy', iat: now, exp: now + 3600, ...claims })}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
};

test('Google ID token verification: signature, issuer, audience, expiry, algorithm', async () => {
  const verify = createGoogleVerifier({ clientIds: ['g-web', 'g-ios'], getKey: async (kid) => (kid === 'k1' ? jwk : null) });
  const ok = await verify(gToken()); assert.deepEqual(ok, { provider: 'google', subject: 'g-1', email: 'aparna@example.com', emailVerified: true, name: 'Aparna Roy' });
  assert.equal((await verify(gToken({ aud: 'g-ios' }))).subject, 'g-1');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  for (const [label, t] of [['wrong audience', gToken({ aud: 'someone-else' })], ['wrong issuer', gToken({ iss: 'https://evil.example' })], ['expired', gToken({ exp: Math.floor(Date.now() / 1000) - 3600 })],
    ['forged signature', gToken({}, { key: other })], ['unknown kid', gToken({}, { kid: 'nope' })], ['alg none', gToken({}, { alg: 'none' })], ['garbage', 'a.b.c'], ['empty', '']]) {
    await assert.rejects(verify(t), (e) => e instanceof SocialError && e.code === 'invalid_credential', label);
  }
});

const fbFetch = (routes) => async (url) => { const u = new URL(url); const r = routes[u.pathname.split('/').pop()]; const x = typeof r === 'function' ? r(u) : r; return { ok: x.status === undefined || x.status < 400, status: x.status || 200, json: async () => x.body }; };
test('Facebook token verification: debug_token must be valid and issued to OUR app', async () => {
  const good = { debug_token: { body: { data: { is_valid: true, app_id: '111', user_id: '42' } } }, me: { body: { id: '42', name: 'Bipasha', email: 'bip@example.com' } } };
  const v = (routes) => createFacebookVerifier({ appId: '111', appSecret: 's3cret', fetchImpl: fbFetch(routes) });
  assert.deepEqual(await v(good)('a'.repeat(30)), { provider: 'facebook', subject: '42', email: 'bip@example.com', emailVerified: true, name: 'Bipasha' });
  const probe = []; await v({ ...good, debug_token: (u) => { probe.push(u.searchParams.get('access_token')); return good.debug_token; } })('a'.repeat(30)); assert.deepEqual(probe, ['111|s3cret']);
  const reject = async (routes, code = 'invalid_credential') => assert.rejects(v(routes)('a'.repeat(30)), (e) => e.code === code);
  await reject({ ...good, debug_token: { body: { data: { is_valid: true, app_id: '999', user_id: '42' } } } });      // token issued to another app
  await reject({ ...good, debug_token: { body: { data: { is_valid: false, app_id: '111', user_id: '42' } } } });
  await reject({ ...good, debug_token: { status: 400, body: { error: {} } } });
  await reject({ ...good, me: { body: { id: '43', name: 'x' } } });                                                  // profile of a different user
  await reject({ ...good, debug_token: { status: 503, body: {} } }, 'provider_unavailable');
  await assert.rejects(v(good)('short'), (e) => e.code === 'invalid_credential');
  assert.equal((await v({ ...good, me: { body: { id: '42', name: 'No Mail' } } })('a'.repeat(30))).email, null);
});

/* ---------------- API tests against MySQL ---------------- */

// Database for the tests: TEST_DATABASE_URL or a local MySQL. Each file creates its own throw-away database (unique name) and drops it at the end, so tests never touch real data.
const cfg0 = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...cfg0, database: `addabaaz_test_sp_${process.pid}_${Date.now().toString(36)}` };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-cat-'));
const catalog = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
const base = catalog.videos.find((v) => v.kind === 'episode');
const mk = (id, extra) => ({ ...base, id, title: id, showId: base.showId, kind: 'clip', episode: null, ...extra });
catalog.videos.push(
  mk('prem-mp4', { access: 'premium', source: { type: 'r2', key: 'premium/prem-mp4/video.mp4' } }),
  mk('prem-hls', { access: 'premium', source: { type: 'r2', key: 'premium/prem-hls/master.m3u8' } }),
  mk('free-r2', { access: 'free', source: { type: 'r2', key: 'free/free-r2.mp4' } }),
);
fs.writeFileSync(path.join(tmp, 'catalog.json'), JSON.stringify(catalog));

const files = { 'premium/prem-hls/master.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720p/index.m3u8\n', 'premium/prem-hls/720p/index.m3u8': '#EXTM3U\n#EXTINF:6,\nseg0.ts\n#EXT-X-ENDLIST\n' };
const fakeR2 = { configured: true, presignGet: (key, { ttl }) => `https://r2.test/${key}?ttl=${ttl}`, getText: async (key) => files[key] ?? null };
const social = {
  config: { google: { clientId: 'g-web' }, facebook: { appId: '111' } },
  verifiers: {
    google: async (c) => { const m = { 'g-new': { subject: 'g-1', email: 'gina@example.com', emailVerified: true, name: 'Gina Das' }, 'g-unverified': { subject: 'g-9', email: 'x@example.com', emailVerified: false, name: 'X' }, 'g-existing': { subject: 'g-2', email: 'existing@example.com', emailVerified: true, name: 'Ex Isting' }, 'g-race': { subject: 'g-race', email: 'race@example.com', emailVerified: true, name: 'Race' } }[c]; if (!m) throw new SocialError('invalid_credential', 'Google sign-in failed. Please try again.'); return { provider: 'google', ...m }; },
    facebook: async (c) => { const m = { 'f-new': { subject: 'f-1', email: 'fay@example.com', emailVerified: true, name: 'Fay' }, 'f-nomail': { subject: 'f-2', email: null, emailVerified: false, name: 'NoMail' }, 'f-down': 'down' }[c]; if (m === 'down') throw new SocialError('provider_unavailable', 'down'); if (!m) throw new SocialError('invalid_credential', 'Facebook sign-in failed. Please try again.'); return { provider: 'facebook', ...m }; },
  },
};

// Shared state for the tests in this file (database, HTTP server, base URL).
let db, server, root;
const mkServer = async (opts) => { const app = createApp({ db, jwtSecret: 'test-secret', rate: false, catalogPath: path.join(tmp, 'catalog.json'), r2: fakeR2, social, payments: { provider: 'mock' }, ...opts }); const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}/api/v1` }; };
// Runs once before the tests: create + migrate the database and start the app on a random free port.
test.before(async () => {
  try { db = await createDb({ config, ensureDatabase: true }); } catch (e) { throw new Error(`MySQL is not reachable (${e.code || e.message}). Set TEST_DATABASE_URL.`); }
  await migrate(db);
  const a = await mkServer(); server = a.s; root = a.url;
});
// Clean up: stop the server and drop the temporary database.
test.after(async () => { server?.close(); if (db) { await db.dropDatabase(); await db.close(); } });

// Tiny HTTP client: calls the running app's API and returns `{ status, body }`; pass a token to act as a signed-in user.
const call = async (method, p, body, token, url = root, redirect = 'follow') => {
  const r = await fetch(url + p, { method, redirect, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, body: json, text, headers: r.headers };
};

test('social: providers are advertised', async () => {
  const p = (await call('GET', '/auth/providers')).body;
  assert.equal(p.password, true); assert.equal(p.google.clientId, 'g-web'); assert.equal(p.facebook.appId, '111'); assert.equal(p.facebook.appSecret, undefined);
  assert.equal((await call('GET', '/health')).body.storage, 'r2');
});

test('social: Google creates a passwordless account, repeat logins reuse it', async () => {
  assert.equal((await call('POST', '/auth/google', { idToken: 'bogus' })).status, 401);
  assert.equal((await call('POST', '/auth/google', {})).status, 401);
  const a = await call('POST', '/auth/google', { idToken: 'g-new' });
  assert.equal(a.status, 200); assert.equal(a.body.isNew, true); assert.equal(a.body.user.email, 'gina@example.com'); assert.equal(a.body.user.name, 'Gina Das'); assert.equal(a.body.profiles[0].name, 'Gina');
  const b = await call('POST', '/auth/google', { idToken: 'g-new' });
  assert.equal(b.body.isNew, false); assert.equal(b.body.user.id, a.body.user.id); assert.equal(b.body.profiles.length, 1);
  const me = (await call('GET', '/me', null, b.body.token)).body;
  assert.deepEqual(me.providers, ['google']); assert.equal(me.hasPassword, false);
  // no password login for a social-only account, and sign-up with that email explains why
  assert.equal((await call('POST', '/auth/login', { email: 'gina@example.com', password: 'anything at all' })).status, 401);
  const dup = await call('POST', '/auth/signup', { name: 'G', email: 'gina@example.com', password: 'password123' });
  assert.equal(dup.status, 409); assert.match(dup.body.error.message, /Google\/Facebook/);
});

test('social: a verified email matching a password account links to it; unverified emails are refused', async () => {
  const pw = (await call('POST', '/auth/signup', { name: 'Existing User', email: 'existing@example.com', password: 'password123' })).body;
  const g = (await call('POST', '/auth/google', { idToken: 'g-existing' })).body;
  assert.equal(g.isNew, false); assert.equal(g.user.id, pw.user.id);
  const me = (await call('GET', '/me', null, g.token)).body; assert.deepEqual(me.providers, ['google']); assert.equal(me.hasPassword, true);
  assert.equal((await call('POST', '/auth/login', { email: 'existing@example.com', password: 'password123' })).status, 200);   // password still works
  const un = await call('POST', '/auth/google', { idToken: 'g-unverified' }); assert.equal(un.status, 400); assert.equal(un.body.error.code, 'email_unverified');
});

test('social: Facebook sign-in, missing email, provider outage, unconfigured provider', async () => {
  const f = await call('POST', '/auth/facebook', { accessToken: 'f-new' }); assert.equal(f.status, 200); assert.equal(f.body.isNew, true);
  assert.equal((await call('POST', '/auth/facebook', { accessToken: 'f-new' })).body.user.id, f.body.user.id);
  const nm = await call('POST', '/auth/facebook', { accessToken: 'f-nomail' }); assert.equal(nm.status, 400); assert.equal(nm.body.error.code, 'email_required');
  assert.equal((await call('POST', '/auth/facebook', { accessToken: 'f-down' })).status, 503);
  const bare = await mkServer({ social: { config: {}, verifiers: {} } });
  assert.equal((await call('POST', '/auth/google', { idToken: 'g-new' }, null, bare.url)).status, 501);
  assert.equal((await call('GET', '/auth/providers', null, null, bare.url)).body.google, undefined); bare.s.close();
});

test('social: concurrent first sign-ins create exactly one account', async () => {
  const r = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/auth/google', { idToken: 'g-race' })));
  assert.ok(r.every((x) => x.status === 200)); assert.equal(new Set(r.map((x) => x.body.user.id)).size, 1);
  const [[{ n }]] = await db.pool.query("SELECT COUNT(*) AS n FROM users WHERE email = 'race@example.com'"); assert.equal(n, 1);
});

test('social: deleting the account removes linked identities', async () => {
  const a = (await call('POST', '/auth/google', { idToken: 'g-new' })).body;
  assert.equal((await call('DELETE', '/me', null, a.token)).status, 204);
  const [[{ n }]] = await db.pool.query("SELECT COUNT(*) AS n FROM auth_identities WHERE subject = 'g-1'"); assert.equal(n, 0);
  assert.equal((await call('POST', '/auth/google', { idToken: 'g-new' })).body.isNew, true);      // starts fresh
});

// Helper: register a new user and return their token (most tests start with this).
const signup = async (email) => (await call('POST', '/auth/signup', { name: 'Vee', email, password: 'password123' })).body;
const pay = (token) => call('POST', '/payments/checkout', { planId: 'plus-monthly' }, token);          // demo provider: instant
const paidUser = async (email) => { const u = await signup(email); await pay(u.token); return u; };

test('premium (R2): needs sign-in AND a paid plan; free R2 videos are public', async () => {
  const anon = await call('POST', '/videos/prem-mp4/stream'); assert.equal(anon.status, 401); assert.equal(anon.body.error.code, 'login_required');
  assert.equal((await call('POST', '/videos/prem-mp4/stream', null, 'a.b.c')).status, 401);
  assert.equal((await call('POST', '/videos/nope/stream')).status, 404);
  assert.equal((await call('POST', `/videos/${base.id}/stream`)).status, 400);                    // YouTube video: nothing to sign
  const free = await call('POST', '/videos/free-r2/stream'); assert.equal(free.status, 200); assert.match(free.body.url, /^https:\/\/r2\.test\/free\/free-r2\.mp4\?ttl=21600$/);
  const u = await signup('viewer@example.com');                                                    // signed in but NOT paid
  const unpaid = await call('POST', '/videos/prem-mp4/stream', null, u.token); assert.equal(unpaid.status, 402); assert.equal(unpaid.body.error.code, 'subscription_required');
  assert.equal((await call('POST', '/videos/free-r2/stream', null, u.token)).status, 200);        // free titles are never gated
  await pay(u.token);
  const r = await call('POST', '/videos/prem-mp4/stream', null, u.token);
  assert.equal(r.status, 200); assert.equal(r.body.type, 'mp4'); assert.equal(r.body.url, 'https://r2.test/premium/prem-mp4/video.mp4?ttl=21600'); assert.ok(Date.parse(r.body.expiresAt) > Date.now());
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const viaGoogle = (await call('POST', '/auth/google', { idToken: 'g-new' })).body;                // social login is signed in, but still needs a plan
  assert.equal((await call('POST', '/videos/prem-mp4/stream', null, viaGoogle.token)).status, 402);
  await pay(viaGoogle.token); assert.equal((await call('POST', '/videos/prem-mp4/stream', null, viaGoogle.token)).status, 200);
});

test('premium (R2): an expired plan stops working', async () => {
  const u = await paidUser('lapsed@example.com');
  assert.equal((await call('POST', '/videos/prem-mp4/stream', null, u.token)).status, 200);
  await db.pool.query("UPDATE subscriptions SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 DAY WHERE user_id = ?", [u.user.id]);
  const denied = await call('POST', '/videos/prem-mp4/stream', null, u.token); assert.equal(denied.status, 402);
  const sub = (await call('GET', '/me', null, u.token)).body.subscription; assert.equal(sub.planId, 'free'); assert.equal(sub.status, 'expired'); assert.equal(sub.expiredPlanId, 'plus-monthly');
  await pay(u.token); assert.equal((await call('POST', '/videos/prem-mp4/stream', null, u.token)).status, 200);   // renewing restores access
});

test('premium (R2): storage not configured', async () => {
  const off = await mkServer({ r2: { configured: false } }); const u = await paidUser('nostorage@example.com');
  assert.equal((await call('POST', '/videos/prem-mp4/stream', null, u.token, off.url)).status, 503); off.s.close();
});

const rawGet = (p) => new Promise((resolve, reject) => { const u = new URL(root); http.get({ host: u.hostname, port: u.port, path: p }, (res) => { res.resume(); resolve({ status: res.statusCode, location: res.headers.location }); }).on('error', reject); });

test('premium HLS gateway: proxied playlists, redirected segments, scoped tokens, no path escape', async () => {
  const u = await paidUser('hls@example.com');
  const s = await call('POST', '/videos/prem-hls/stream', null, u.token);
  assert.equal(s.status, 200); assert.equal(s.body.type, 'hls'); assert.match(s.body.url, /\/api\/v1\/media\/[^/]+\/master\.m3u8$/);
  const master = await fetch(s.body.url); assert.equal(master.status, 200); assert.match(master.headers.get('content-type'), /mpegurl/); assert.match(await master.text(), /720p\/index\.m3u8/);
  const variant = await fetch(new URL('720p/index.m3u8', s.body.url)); assert.equal(variant.status, 200);               // relative URLs resolve on the gateway
  const seg = await fetch(new URL('720p/seg0.ts', s.body.url), { redirect: 'manual' });
  assert.equal(seg.status, 302); assert.equal(seg.headers.get('location'), 'https://r2.test/premium/prem-hls/720p/seg0.ts?ttl=900');
  assert.equal((await fetch(new URL('720p/missing.m3u8', s.body.url))).status, 404);
  const token = s.body.url.split('/media/')[1].split('/')[0];
  for (const evil of ['../prem-mp4/video.mp4', '%2e%2e/prem-mp4/video.mp4', '..%2F..%2Ffree%2Ffree-r2.mp4', '/etc/passwd']) {
    const r = await rawGet(`${new URL(root).pathname}/media/${token}/${evil}`);         // raw request: fetch() would normalise the dots away
    assert.ok([400, 404].includes(r.status), `${evil} → ${r.status}`);
    assert.ok(!(r.location || '').includes('prem-mp4') && !(r.location || '').includes('free-r2'), evil);
  }
  assert.equal((await fetch(`${root}/media/garbage/master.m3u8`)).status, 401);
  assert.equal((await fetch(`${root}/media/${u.token}/master.m3u8`)).status, 401);                                       // a session token is not a media token
  assert.equal((await call('GET', '/me', null, token)).status, 401);                                                      // …and a media token is not a session
  assert.equal((await call('POST', '/videos/prem-hls/stream')).status, 401);
});
