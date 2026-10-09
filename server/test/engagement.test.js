// Tests for account safety (verification, password reset, PIN), Sign in with Apple, ratings, device limit,
// web push, analytics, refund requests, subtitles and scheduled publishing.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { dbConfigFromEnv } from '../src/config.js';
import { createMailer } from '../src/mailer.js';
import { createPush } from '../src/push.js';
import { createAppleVerifier } from '../src/apple.js';
import { socialFromEnv } from '../src/social.js';

// Database for the tests: TEST_DATABASE_URL or a local MySQL. Each file creates its own throw-away database (unique name) and drops it at the end, so tests never touch real data.
const cfg0 = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...cfg0, database: `addabaaz_eng_${process.pid}_${Date.now().toString(36)}` };
const ADMIN = 'a'.repeat(32), tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-eng-'));
// Shared state for the tests in this file (database, HTTP server, base URL).
let db, server, base, root, pushed, mails, theApp;
const fakeSender = async (sub, payload) => { if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 }); pushed.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); };
// Runs once before the tests: create + migrate the database and start the app on a random free port.
test.before(async () => {
  db = await createDb({ config, ensureDatabase: true }); await migrate(db);
  pushed = []; mails = [];
  const mailer = createMailer({ transport: { sendMail: async (m) => { mails.push(m); } } });
  const push = createPush({ db, vapid: { publicKey: 'BPUBLIC' }, sender: fakeSender });
  const app = theApp = createApp({ db, jwtSecret: 'test-secret', rate: false, mailer, push, adminToken: ADMIN, uploadDir: tmpUploads, features: { streamLimit: 1, refundWindowDays: 7 } });
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`; base = `${root}/api/v1`;
});
// Clean up: stop the server and drop the temporary database.
test.after(async () => { server?.close(); if (db) { await db.dropDatabase(); await db.close(); } });

// Tiny HTTP client: calls the running app's API and returns `{ status, body }`; pass a token to act as a signed-in user.
const call = async (method, p, body, token, headers = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null };
};
let n = 0;
// Helper: register a new user and return their token (most tests start with this).
const signup = async (email = `e${++n}@example.com`, password = 'Password123!') => { const r = await call('POST', '/auth/signup', { name: 'Eng Test', email, password }); return { ...r.body, email, password, token: r.body.token }; };
const linkFrom = (mail, path) => new URL(String(mail.text).match(new RegExp(`https?://\\S+${path}\\?token=[\\w-]+`))[0]).searchParams.get('token');
const lastMailTo = async (email, subjectRe) => { for (let i = 0; i < 40; i++) { const m = [...mails].reverse().find((x) => x.to === email && subjectRe.test(x.subject)); if (m) return m; await new Promise((r) => setTimeout(r, 25)); } throw new Error(`no mail to ${email} matching ${subjectRe}`); };

test('email verification: link confirms the account; tokens are single-use; resend is throttled', async () => {
  const u = await signup(); assert.equal(u.user.emailVerified, false); assert.equal(u.verificationEmailSent, true);
  const m = await lastMailTo(u.email, /Confirm your email/); const token = linkFrom(m, '/verify');
  assert.equal((await call('POST', '/auth/verify', { token: 'x'.repeat(30) })).status, 400);
  assert.equal((await call('POST', '/auth/verify', { token })).body.verified, true);
  assert.equal((await call('POST', '/auth/verify', { token })).status, 400, 'a token can be used once');
  const me = await call('GET', '/me', null, u.token); assert.equal(me.body.user.emailVerified, true);
  const v2 = await signup(); assert.equal((await call('POST', '/me/verify/resend', null, v2.token)).status, 429, 'signup just sent one');
});

test('unverified accounts cannot buy while email is configured; verified accounts pass the email gate', async () => {
  const u = await signup();
  assert.equal((await call('POST', '/payments/checkout', { planId: 'plus-monthly' }, u.token)).status, 403);
  await db.accounts.markVerified(u.user.id);
  assert.notEqual((await call('POST', '/payments/checkout', { planId: 'plus-monthly' }, u.token)).status, 403);
});

test('password reset: neutral answer, one-hour single-use link, signs out other sessions, old password stops working', async () => {
  const u = await signup('rita@example.com'); const old = u.token;
  assert.equal((await call('POST', '/auth/forgot', { email: 'nobody@example.com' })).status, 202);   // same answer for unknown emails
  assert.equal((await call('POST', '/auth/forgot', { email: 'not-an-email' })).status, 400);
  assert.equal((await call('POST', '/auth/forgot', { email: 'rita@example.com' })).status, 202);
  const m = await lastMailTo('rita@example.com', /Reset your/); const token = linkFrom(m, '/reset');
  assert.equal(mails.filter((x) => x.to === 'nobody@example.com').length, 0);
  assert.equal((await call('POST', '/auth/reset', { token, password: 'short' })).status, 400);
  assert.equal((await call('POST', '/auth/reset', { token: 'y'.repeat(43), password: 'Brand New Pass 9!' })).status, 400);
  const r = await call('POST', '/auth/reset', { token, password: 'Brand New Pass 9!' }); assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.body.user.emailVerified, true);
  assert.equal((await call('POST', '/auth/reset', { token, password: 'Another Pass 1!' })).status, 400, 'single use');
  assert.equal((await call('GET', '/me', null, old)).status, 401, 'old sessions are signed out');
  assert.equal((await call('GET', '/me', null, r.body.token)).status, 200, 'the new session works');
  assert.equal((await call('POST', '/auth/login', { email: 'rita@example.com', password: 'Password123!' })).status, 401);
  const login = await call('POST', '/auth/login', { email: 'rita@example.com', password: 'Brand New Pass 9!' }); assert.equal(login.status, 200); assert.equal((await call('GET', '/me', null, login.body.token)).status, 200);
  await lastMailTo('rita@example.com', /password was changed/);
});

test('a newer reset link replaces the older one; expired links fail; requests are throttled per account', async () => {
  const u = await signup('twice@example.com');
  await call('POST', '/auth/forgot', { email: u.email }); const first = linkFrom(await lastMailTo(u.email, /Reset your/), '/reset');
  await call('POST', '/auth/forgot', { email: u.email }); assert.equal(mails.filter((x) => x.to === u.email && /Reset your/.test(x.subject)).length, 1, 'one email a minute');
  await db.pool.query("UPDATE auth_tokens SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE user_id = ? AND purpose = 'reset'", [u.user.id]);
  assert.equal((await call('POST', '/auth/reset', { token: first, password: 'Whatever123!' })).status, 400, 'expired');
});

// The website must never claim an email was sent when it wasn't: a failing provider and a missing
// SMTP configuration both surface as 503 with a message the UI shows, and a failed reset send leaves
// no throttle state behind — so retrying once the provider works really delivers.
test('forgot/resend fail loudly instead of pretending an email was sent', async () => {
  const extra = [];
  let broken = true;
  const flaky = createMailer({ transport: { sendMail: async (m) => { if (broken) throw new Error('provider down'); extra.push(m); } } });
  const noSmtp = createMailer({ url: '' });
  const listen = (mailer) => createApp({ db, jwtSecret: 'test-secret', rate: false, mailer }).listen(0);
  const sFlaky = listen(flaky), sNone = listen(noSmtp);
  const callOn = async (srv, method, p, body, token) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null };
  };
  try {
    const em = `honest${Date.now()}@example.com`;
    const su = await callOn(sFlaky, 'POST', '/auth/signup', { name: 'Honest', email: em, password: 'Password123!' });
    assert.equal(su.status, 201, 'the account remains usable even if delivery fails');
    assert.equal(su.body.verificationEmailSent, false, 'signup reports the failed verification mail instead of silently claiming success');
    const [[{ verifyTokens }]] = await db.pool.query("SELECT COUNT(*) AS verifyTokens FROM auth_tokens WHERE user_id = ? AND purpose = 'verify'", [su.body.user.id]);
    assert.equal(verifyTokens, 0, 'a failed mail does not create a token that throttles a resend');

    const f1 = await callOn(sFlaky, 'POST', '/auth/forgot', { email: em });
    assert.equal(f1.status, 503, 'a failed send is reported, not swallowed');
    assert.equal(f1.body.error.code, 'email_send_failed');
    assert.equal(extra.length, 0, 'the failed attempt delivered nothing');

    broken = false;
    const f2 = await callOn(sFlaky, 'POST', '/auth/forgot', { email: em });
    assert.equal(f2.status, 202, 'the failed attempt left no throttle behind');
    assert.ok(extra.some((m) => m.to === em && /Reset your/.test(m.subject)), 'the retry actually delivered');

    // The failed signup send left no verification token/throttle state behind, so resend can be retried.
    await db.pool.query("DELETE FROM auth_tokens WHERE user_id = ? AND purpose = 'verify'", [su.body.user.id]);
    broken = true;
    const rs = await callOn(sFlaky, 'POST', '/me/verify/resend', null, su.body.token);
    assert.equal(rs.status, 503, 'resend is equally honest');
    assert.equal(rs.body.error.code, 'email_send_failed');
    broken = false;
    const rs2 = await callOn(sFlaky, 'POST', '/me/verify/resend', null, su.body.token);
    assert.equal(rs2.status, 202, 'retrying after the failure really sends');
    assert.ok(extra.some((m) => m.to === em && /Confirm your email/.test(m.subject)), 'the verify mail actually delivered');

    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const noMailSignup = await callOn(sNone, 'POST', '/auth/signup', { name: 'No Mail', email: `missing${Date.now()}@example.com`, password: 'Password123!' });
      assert.equal(noMailSignup.status, 201);
      assert.equal(noMailSignup.body.verificationEmailSent, false, 'production signup reports missing SMTP configuration');
      for (const address of [em, 'nobody@example.com']) {           // identical for every address (no enumeration)
        const r = await callOn(sNone, 'POST', '/auth/forgot', { email: address });
        assert.equal(r.status, 503);
        assert.equal(r.body.error.code, 'email_not_configured');
      }
    } finally { if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev; }
  } finally { sFlaky.close(); sNone.close(); }
});

// The sign-up screen must never sit behind a dead mail server. The verification mail gets a short budget
// (SIGNUP_EMAIL_WAIT_MS, 100 ms here) inside the request: a hanging SMTP transport makes the endpoint answer
// "still on its way" (`verificationEmailPending`) while the send finishes in the background — and the token it
// issues afterwards still confirms the account when the mail arrives.
test('signup answers while the confirmation mail is still in flight instead of waiting for SMTP', async () => {
  const delivered = [];
  const slow = createMailer({ transport: { sendMail: async (m) => { await new Promise((r) => setTimeout(r, 1200)); delivered.push(m); } } });
  const srv = createApp({ db, jwtSecret: 'test-secret', rate: false, mailer: slow, signupMailWaitMs: 100 }).listen(0);
  const callOn = async (method, p, body, token) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null };
  };
  try {
    const em = `slow${Date.now()}@example.com`;
    const started = Date.now();
    const su = await callOn('POST', '/auth/signup', { name: 'Slow Mail', email: em, password: 'Password123!' });
    const elapsed = Date.now() - started;
    assert.equal(su.status, 201, 'the account is created');
    assert.ok(elapsed < 1000, `signup answered in ${elapsed}ms instead of waiting for the hanging SMTP server`);
    assert.equal(su.body.verificationEmailSent, false, 'not confirmed as sent — it has not finished');
    assert.equal(su.body.verificationEmailPending, true, 'the client is told the mail is still on its way');
    assert.equal((await callOn('GET', '/me', null, su.body.token)).status, 200, 'the session works immediately');
    // The background send completes and issues the verification token, so the link works when it arrives.
    let verifyTokens = 0;
    for (let i = 0; i < 100 && !verifyTokens; i++) {
      [[{ verifyTokens }]] = await db.pool.query("SELECT COUNT(*) AS verifyTokens FROM auth_tokens WHERE user_id = ? AND purpose = 'verify'", [su.body.user.id]);
      if (!verifyTokens) await new Promise((r) => setTimeout(r, 25));
    }
    const verifyMail = delivered.find((m) => /Confirm your email/.test(m.subject));
    assert.ok(verifyMail, 'the verification mail finished in the background');
    assert.equal(verifyTokens, 1, 'the token was issued once the send completed');
    const token = linkFrom(verifyMail, '/verify');
    assert.equal((await callOn('POST', '/auth/verify', { token })).body.verified, true, 'the link really confirms the account');
  } finally { srv.close(); }
});

test('change password & sign out everywhere', async () => {
  const u = await signup(); const other = (await call('POST', '/auth/login', { email: u.email, password: u.password })).body.token;
  assert.equal((await call('POST', '/me/password', { currentPassword: 'wrong', newPassword: 'newpassword1' }, u.token)).status, 403);
  const r = await call('POST', '/me/password', { currentPassword: u.password, newPassword: 'newpassword1' }, u.token); assert.equal(r.status, 200);
  assert.equal((await call('GET', '/me', null, other)).status, 401); assert.equal((await call('GET', '/me', null, u.token)).status, 401);
  const s = await call('POST', '/me/sessions/revoke', null, r.body.token); assert.equal((await call('GET', '/me', null, r.body.token)).status, 401); assert.equal((await call('GET', '/me', null, s.body.token)).status, 200);
});

test('Sign in with Apple: token verified against Apple keys; issuer, audience, expiry, algorithm', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const verify = createAppleVerifier({ clientIds: ['com.addabaaz.app'], getKey: async (kid) => (kid === 'k1' ? jwk : null) });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mint = (claims, { kid = 'k1', alg = 'RS256', key = privateKey } = {}) => { const body = `${b64({ alg, kid })}.${b64({ iss: 'https://appleid.apple.com', aud: 'com.addabaaz.app', exp: Math.floor(Date.now() / 1000) + 600, sub: '001.abc', email: 'Ann@Privaterelay.appleid.com', email_verified: 'true', ...claims })}`; return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`; };
  const ok = await verify({ identityToken: mint({}), name: 'Ann Lee' });
  assert.deepEqual([ok.provider, ok.subject, ok.email, ok.emailVerified, ok.name], ['apple', '001.abc', 'ann@privaterelay.appleid.com', true, 'Ann Lee']);
  for (const [why, tok] of [['wrong audience', mint({ aud: 'evil' })], ['wrong issuer', mint({ iss: 'https://evil' })], ['expired', mint({ exp: 1 })], ['unknown key', mint({}, { kid: 'zz' })],
    ['bad signature', mint({}, { key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey })], ['wrong alg', mint({}, { alg: 'HS256' })], ['garbage', 'a.b.c']]) await assert.rejects(() => verify(tok), (e) => e.code === 'invalid_credential', why);
  const env = socialFromEnv({ APPLE_CLIENT_ID: 'com.addabaaz.app', APPLE_SERVICE_ID: 'com.addabaaz.web' }); assert.ok(env.verifiers.apple); assert.equal(env.config.apple.clientId, 'com.addabaaz.web'); assert.equal(env.config.apple.bundleId, 'com.addabaaz.app');
  // end to end through the API with the injected verifier
  const app = createApp({ db, jwtSecret: 't', rate: false, social: { config: { apple: { clientId: 'x' } }, verifiers: { apple: verify } } });
  const s = app.listen(0); await new Promise((r) => s.once('listening', r)); const url = `http://127.0.0.1:${s.address().port}/api/v1`;
  const post = (b) => fetch(url + '/auth/apple', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const a = await post({ identityToken: mint({ sub: 'apple-user-1', email: 'apple1@example.com' }), name: 'Apple One' }); assert.equal(a.status, 200); assert.equal(a.body.isNew, true); assert.equal(a.body.user.emailVerified, true); assert.equal(a.body.user.name, 'Apple One');
  const again = await post({ identityToken: mint({ sub: 'apple-user-1', email: undefined }) }); assert.equal(again.status, 200); assert.equal(again.body.isNew, false); assert.equal(again.body.user.id, a.body.user.id);   // later logins carry no email
  assert.equal((await post({ identityToken: 'nope' })).status, 401);
  s.close();
});

test('parental PIN: set, verify, lock-out, and protect profile changes', async () => {
  const u = await signup(); const pid = u.profiles[0].id;
  assert.equal((await call('PUT', '/me/pin', { pin: '12' }, u.token)).status, 400);
  assert.equal((await call('PUT', '/me/pin', { pin: '1234' }, u.token)).status, 204);
  assert.equal((await call('GET', '/me', null, u.token)).body.hasPin, true);
  assert.equal((await call('POST', '/profiles', { name: 'Kid', kids: true }, u.token)).body.error.code, 'pin_required');
  const kid = await call('POST', '/profiles', { name: 'Kid', kids: true }, u.token, { 'X-Parental-Pin': '1234' }); assert.equal(kid.status, 201); assert.equal(kid.body.profile.kids, true);
  assert.equal((await call('GET', '/profiles', null, u.token)).body.profiles.find((p) => p.id === kid.body.profile.id).kids, true);
  assert.equal((await call('PATCH', `/profiles/${pid}`, { name: 'X' }, u.token)).status, 403);
  assert.equal((await call('PATCH', `/profiles/${kid.body.profile.id}`, { kids: false }, u.token, { 'X-Parental-Pin': '1234' })).body.profile.kids, undefined);
  assert.equal((await call('POST', '/me/pin/verify', { pin: '1234' }, u.token)).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/me/pin/verify', { pin: '0000' }, u.token)).status, 403);
  assert.equal((await call('POST', '/me/pin/verify', { pin: '1234' }, u.token)).body.error.code, 'pin_locked', 'even the right PIN is refused while locked');
  await db.pool.query('UPDATE users SET pin_locked_until = NULL, pin_failed = 0 WHERE id = ?', [u.user.id]);
  assert.equal((await call('PUT', '/me/pin', { pin: '5678' }, u.token)).status, 403, 'changing the PIN needs the current one');
  assert.equal((await call('PUT', '/me/pin', { pin: '5678', currentPin: '1234' }, u.token)).status, 204);
  assert.equal((await call('DELETE', '/me/pin', { pin: '5678' }, u.token)).status, 204);
  assert.equal((await call('PATCH', `/profiles/${pid}`, { name: 'Free' }, u.token)).status, 200);
});

test('ratings: thumbs per profile, public counts, validation', async () => {
  const u = await signup(); const pid = u.profiles[0].id; const show = (await call('GET', '/catalog')).body.shows[0];
  assert.equal((await call('PUT', `/profiles/${pid}/ratings/show/${show.id}`, { value: 5 }, u.token)).status, 400);
  assert.equal((await call('PUT', `/profiles/${pid}/ratings/show/nope`, { value: 1 }, u.token)).status, 404);
  assert.deepEqual((await call('PUT', `/profiles/${pid}/ratings/show/${show.id}`, { value: 1 }, u.token)).body, { up: 1, down: 0 });
  const p2 = (await call('POST', '/profiles', { name: 'Two' }, u.token)).body.profile;
  assert.deepEqual((await call('PUT', `/profiles/${p2.id}/ratings/show/${show.id}`, { value: -1 }, u.token)).body, { up: 1, down: 1 });
  assert.deepEqual((await call('PUT', `/profiles/${pid}/ratings/show/${show.id}`, { value: -1 }, u.token)).body, { up: 0, down: 2 }, 'changing your mind replaces the vote');
  assert.deepEqual((await call('GET', `/ratings/show/${show.id}`)).body, { up: 0, down: 2 });
  assert.equal((await call('GET', `/profiles/${pid}/ratings`, null, u.token)).body.ratings[`show:${show.id}`], -1);
  assert.deepEqual((await call('DELETE', `/profiles/${pid}/ratings/show/${show.id}`, null, u.token)).body, { up: 0, down: 1 });
  const other = await signup(); assert.equal((await call('PUT', `/profiles/${pid}/ratings/show/${show.id}`, { value: 1 }, other.token)).status, 404, 'not your profile');
});

test('screens at once: a second device is refused while the first is watching; heartbeat frees the seat', async () => {
  const u = await signup(); const vid = (await call('GET', '/catalog')).body.videos.find((v) => v.kind === 'episode').id;
  const hb = (dev) => call('POST', '/playback/heartbeat', { videoId: vid }, u.token, { 'X-Device-Id': dev, 'X-Device-Label': dev });
  assert.equal((await hb('tv')).status, 200); assert.equal((await hb('tv')).status, 200, 'same device refreshes');
  const refused = await hb('phone'); assert.equal(refused.status, 429); assert.equal(refused.body.error.code, 'stream_limit');
  const devs = await call('GET', '/me/devices', null, u.token, { 'X-Device-Id': 'tv' }); assert.equal(devs.body.streamLimit, 1); assert.equal(devs.body.devices.find((d) => d.deviceId === 'tv').watching, true); assert.equal(devs.body.devices.find((d) => d.deviceId === 'tv').current, true);
  assert.equal((await call('POST', '/playback/stop', null, u.token, { 'X-Device-Id': 'tv' })).status, 204);
  assert.equal((await hb('phone')).status, 200, 'seat freed');
  await db.pool.query("UPDATE playback_sessions SET last_seen = UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE WHERE user_id = ? AND device_id = 'phone'", [u.user.id]);
  assert.equal((await hb('tv')).status, 200, 'a device that stopped sending heartbeats no longer holds a seat');
  assert.equal((await call('DELETE', '/me/devices/phone', null, u.token)).status, 204);
});

test('push: subscribe, preferences, notify audiences, send-once automatic notifications, dead endpoints removed', async () => {
  assert.deepEqual((await call('GET', '/push/config')).body, { enabled: true, publicKey: 'BPUBLIC' });
  const u = await signup(); const cat = (await call('GET', '/catalog')).body; const show = cat.shows[0]; const pid = u.profiles[0].id;
  const sub = (ep) => ({ endpoint: ep, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });
  assert.equal((await call('POST', '/push/subscribe', { subscription: { endpoint: 'http://insecure' } }, u.token)).status, 400);
  assert.equal((await call('POST', '/push/subscribe', { subscription: sub('https://push.example/dev1') }, u.token)).status, 201);
  assert.equal((await call('POST', '/push/subscribe', { subscription: sub('https://push.example/dev1') }, u.token)).status, 201, 'idempotent');
  assert.equal((await call('POST', '/push/subscribe', { subscription: sub('https://push.example/gone') }, u.token)).status, 201);
  assert.deepEqual((await call('POST', '/push/status', { endpoint: 'https://push.example/dev1' }, u.token)).body.prefs, { episodes: true, launches: true, news: true }, 'all three kinds are on unless a viewer turns one off');
  const push = (await import('../src/push.js')).createPush({ db, vapid: { publicKey: 'x' }, sender: fakeSender });
  // nobody follows the show yet → nobody is told
  pushed.length = 0; let r = await push.notify({ kind: 'episodes', showId: show.id, videoIds: [] }, { title: 'T', body: 'B' }); assert.equal(r.sent, 0);
  await call('PUT', `/profiles/${pid}/list/show/${show.id}`, null, u.token);
  r = await push.notify({ kind: 'episodes', showId: show.id, videoIds: [] }, { title: 'New', body: 'ep', url: '/x' }); assert.equal(r.sent, 1); assert.equal(r.removed, 1, 'the 410 endpoint is deleted');
  assert.deepEqual(pushed.map((p) => p.endpoint), ['https://push.example/dev1']); assert.equal(pushed[0].url, '/x');
  assert.equal((await db.push.count()), 1);
  await call('PATCH', '/push/prefs', { endpoint: 'https://push.example/dev1', episodes: false }, u.token);
  pushed.length = 0; r = await push.notify({ kind: 'episodes', showId: show.id, videoIds: [] }, { title: 'x', body: 'y' }); assert.equal(r.sent, 0, 'opted out');
  await call('PATCH', '/push/prefs', { endpoint: 'https://push.example/dev1', episodes: true, news: true }, u.token);
  // automatic: a fresh episode → once per user, however many times the job runs
  const now = Date.now(), ep = cat.videos.find((v) => v.kind === 'episode' && v.showId === show.id);
  const fakeCat = { shows: cat.shows, videos: [{ ...ep, publishedAt: new Date(now - 3600_000).toISOString() }], upcoming: [] };
  pushed.length = 0; assert.equal((await push.runAutomatic(fakeCat, { now })).episodes, 1); assert.equal((await push.runAutomatic(fakeCat, { now })).episodes, 0); assert.equal(pushed.length, 1); assert.equal(pushed[0].url, `/watch/${ep.id}`);
  assert.equal((await push.notify({ kind: 'news' }, { title: 'News', body: 'b' })).sent, 1);
  assert.equal((await call('POST', '/push/unsubscribe', { endpoint: 'https://push.example/dev1' }, u.token)).status, 204); assert.equal(await db.push.count(), 0);
  const off = await call('POST', '/push/subscribe', { subscription: sub('https://x.example/y') }, u.token); assert.equal(off.status, 201);
});

test('analytics events are aggregated, validated and capped', async () => {
  const catalog = (await call('GET', '/catalog')).body;
  assert.equal(catalog.playCounts, undefined, 'all-time database counts are exposed to Admin, not the public API');
  const v = catalog.videos.find((x) => x.kind === 'episode'), reel = catalog.videos.find((x) => x.kind === 'reel');
  const before = await db.playStats.allTimeCounts();
  assert.equal((await call('POST', '/events/play', { videoId: v.id, event: 'start' })).status, 204);
  assert.equal((await call('POST', '/events/play', { videoId: reel.id, event: 'start' })).status, 204, 'reels count as video starts too');
  await call('POST', '/events/play', { videoId: v.id, event: 'progress', seconds: 60 }); await call('POST', '/events/play', { videoId: v.id, event: 'progress', seconds: 999999 });
  await call('POST', '/events/play', { videoId: 'nope', event: 'start' }); await call('POST', '/events/play', { videoId: v.id, event: 'hack' });
  const counts = await db.playStats.allTimeCounts();
  assert.equal(counts[v.id], Number(before[v.id] || 0) + 1);
  assert.equal(counts[reel.id], Number(before[reel.id] || 0) + 1);
  const adminCatalog = await adm('GET', '/catalog');
  assert.equal(adminCatalog.status, 200);
  assert.equal(adminCatalog.body.playCounts[v.id], counts[v.id], 'the current database count is available only to Admin');
  assert.equal(adminCatalog.body.playCounts[reel.id], counts[reel.id]);
  const o = await db.playStats.overview(7); assert.equal(o.totals.plays, 2); assert.equal(o.totals.seconds, 60 + Math.min(v.duration, 600)); assert.equal(o.videos[0].videoId, v.id);
});

test('client error reports are stored and grouped; server errors are logged', async () => {
  // Earlier cases intentionally exercise expected failures; drain and clear those diagnostics so this test only asserts its own reports.
  await theApp.locals.errorLogger.flush();
  await db.errors.clear();
  assert.equal((await call('POST', '/client-errors', { message: 'TypeError: x is undefined', stack: 'at a.js:1', url: '/show/x' })).status, 204);
  await call('POST', '/client-errors', { message: 'TypeError: x is undefined', url: '/watch/y' }); await call('POST', '/client-errors', { url: 'no message' });
  const identified = await signup();
  await call('POST', '/client-errors', { message: 'Identified playback report' }, identified.token);
  const e = await db.errors.list(); const g = e.groups.find((x) => x.message.startsWith('TypeError')); assert.equal(g.count, 2); assert.equal(g.source, 'client'); assert.equal(e.groups.length, 2);
  const accountReport = e.recent.find((x) => x.message === 'Identified playback report');
  assert.deepEqual([accountReport.userId, accountReport.accountName, accountReport.accountEmail], [identified.user.id, 'Eng Test', identified.email]);
});

test('refund requests: only real paid purchases inside the window, once; the customer is told', async () => {
  const u = await signup(); await db.accounts.markVerified(u.user.id);
  const pay = async (over = {}) => { const id = crypto.randomUUID(); await db.pool.query("INSERT INTO payments (id, user_id, plan_id, provider, provider_order_id, provider_payment_id, amount_paise, currency, status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [id, u.user.id, 'plus-monthly', over.provider || 'razorpay', `o_${id}`, `p_${id}`, 9900, 'INR', over.status || 'paid', over.paidAt || new Date()]); return id; };
  const ask = (id, reason = 'Bought by mistake') => call('POST', `/payments/${id}/refund-request`, { reason }, u.token);
  assert.equal((await ask('nope')).status, 404);
  assert.equal((await ask(await pay({ provider: 'mock' }))).status, 409, 'demo purchases are not refundable');
  assert.equal((await ask(await pay({ paidAt: new Date(Date.now() - 20 * 86400_000) }))).body.error.code, 'outside_window');
  const good = await pay(); const r = await ask(good); assert.equal(r.status, 201);
  assert.equal((await ask(good)).body.error.code, 'already_requested');
  await lastMailTo(u.email, /We received your refund request/);
  const other = await signup(); assert.equal((await call('POST', `/payments/${good}/refund-request`, {}, other.token)).status, 404, 'not your payment');
  assert.equal((await call('GET', '/refund-requests', null, u.token)).body.requests[0].status, 'pending');
});

const adm = (method, p, body, raw) => fetch(`${base}/admin${p}`, { method, headers: { Authorization: `Bearer ${ADMIN}`, ...(raw ? {} : { 'Content-Type': 'application/json' }) }, body: raw ?? (body ? JSON.stringify(body) : undefined) }).then(async (r) => { const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* text */ } return { status: r.status, body: j, text: t, headers: r.headers }; });

// Broadcast sending happens in the background, so the tests poll the campaign row.
const waitCampaign = async (id, at = adm) => {
  for (let i = 0; i < 200; i++) {
    const c = (await at('GET', `/notifications/${id}`)).body;
    if (c && ['sent', 'partial', 'failed', 'cancelled'].includes(c.status)) return c;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`campaign ${id} did not finish`);
};
const broadcast = async (body, at = adm) => { const r = await at('POST', '/notifications/send', body); assert.equal(r.status, 202, JSON.stringify(r.body)); return waitCampaign(r.body.id, at); };

test('admin: push broadcasts go to the chosen audience, with progress and audit; bad input refused', async () => {
  const u = await signup(); const cat = (await call('GET', '/catalog')).body; const show = cat.shows[1], up = cat.upcoming[0];
  const sub = { endpoint: 'https://push.example/admin1', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } };
  await call('POST', '/push/subscribe', { subscription: sub }, u.token);
  const meta = (await adm('GET', '/notifications')).body;
  assert.equal(meta.configured, true); assert.equal(meta.push.web, true); assert.equal(meta.push.native, false);
  assert.equal(meta.email.configured, true); assert.ok(meta.email.audiences.some((a) => a.id === 'all' && a.count >= 1));
  assert.ok(meta.audiences.some((a) => a.id === `show:${show.id}`)); assert.ok(meta.subscribers >= 1);
  assert.equal((await adm('POST', '/notifications/send', { title: '', body: 'x' })).status, 400);
  assert.equal((await adm('POST', '/notifications/send', { title: 'T', body: 'B', url: '//evil.com' })).status, 400);
  assert.equal((await adm('POST', '/notifications/send', { title: 'T', body: 'B', audience: 'show:nope' })).status, 400);
  assert.equal((await adm('POST', '/notifications/send', { channel: 'email', title: 'T', body: 'B', audience: 'not-a-filter' })).status, 400);
  assert.equal((await fetch(`${base}/admin/notifications/send`, { method: 'POST' })).status, 401);
  pushed.length = 0;
  let c = await broadcast({ title: 'Big news', body: 'Season 2 is here', url: '/plans', audience: 'news' });
  assert.equal(c.status, 'sent'); assert.equal(c.channel, 'push');
  // Assert on this subscription, not on the total: other tests in this file keep their own rows.
  assert.ok(pushed.some((p) => p.endpoint === 'https://push.example/admin1'), 'announcements reach a subscriber by default');
  const webResults = await adm('GET', `/notifications/${c.id}/deliveries?limit=100`);
  const myWeb = webResults.body.deliveries.find((d) => d.userId === u.user.id);
  assert.equal(myWeb.name, 'Eng Test'); assert.equal(myWeb.email, u.email);
  assert.equal(myWeb.status, 'sent'); assert.equal(myWeb.transport, 'web_push');
  await call('PATCH', '/push/prefs', { endpoint: sub.endpoint, news: false }, u.token);
  pushed.length = 0;
  c = await broadcast({ title: 'One more thing', body: 'Body', audience: 'news' });
  assert.equal(pushed.some((p) => p.endpoint === 'https://push.example/admin1'), false, 'and turning them off is honoured');
  await call('PATCH', '/push/prefs', { endpoint: sub.endpoint, news: true }, u.token);
  c = await broadcast({ title: 'Hello all', body: 'Body', audience: 'all' });
  assert.ok(c.sent >= 1); assert.ok(c.total >= c.sent); assert.equal(c.status, 'sent'); assert.equal(c.by, 'ADMIN_TOKEN');
  assert.equal(pushed.at(-1).title, 'Hello all');
  pushed.length = 0;
  assert.equal((await broadcast({ title: 'Show', body: 'B', audience: `show:${show.id}` })).sent, 0, 'nobody follows it');
  await call('PUT', `/profiles/${u.profiles[0].id}/reminders/${up.id}`, null, u.token);
  assert.equal((await broadcast({ title: 'Live', body: 'B', audience: `launch:${up.id}` })).sent, 1);
  const hist = (await adm('GET', '/notifications')).body;
  assert.ok(hist.campaigns.length >= 4); assert.ok(hist.history.length >= 4);
  assert.equal(hist.campaigns[0].title, 'Live', 'newest first');
  const audit = (await adm('GET', '/audit?action=notification.send')).body.entries;
  assert.ok(audit.some((e) => e.target === `launch:${up.id}`));
});

test('admin: app push reaches registered devices through FCM and drops dead tokens; e-mail campaigns honour unsubscribe', async () => {
  // A second app whose push service has a fake Firebase Cloud Messaging sender (no credentials needed).
  const fcmSent = []; const dead = ['dead-token-' + 'z'.repeat(24)];
  const fcm = { configured: true, send: async (tokens, message) => {
    fcmSent.push({ tokens, message });
    return { sent: tokens.length - 1, failed: 0, dead, results: tokens.map((token) => ({ token, ok: token !== dead[0], dead: token === dead[0], error: token === dead[0] ? 'Device token is unregistered.' : null })) };
  } };
  const push2 = createPush({ db, vapid: { publicKey: 'x' }, sender: fakeSender, fcm });
  const app2 = createApp({ db, jwtSecret: 'test-secret', rate: false, mailer: createMailer({ transport: { sendMail: async (m) => { mails.push(m); } } }), push: push2, adminToken: ADMIN, features: { streamLimit: 1, refundWindowDays: 7 } });
  const server2 = app2.listen(0); await new Promise((r) => server2.once('listening', r));
  const base2 = `http://127.0.0.1:${server2.address().port}/api/v1`;
  const adm2 = (method, p, body) => fetch(`${base2}/admin${p}`, { method, headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => { const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* text */ } return { status: r.status, body: j }; });
  try {
    const u = await signup();
    // Device registration: reject junk, be idempotent, list per account.
    assert.equal((await call('POST', '/devices', { token: 'short' }, u.token)).status, 400);
    assert.equal((await call('POST', '/devices', { token: 't'.repeat(60) })).status, 401, 'sign-in required');
    const good = 'fcm-device-token-' + 'a'.repeat(30);
    assert.equal((await call('POST', '/devices', { token: good, platform: 'android', label: 'Pixel 7' }, u.token)).status, 201);
    assert.equal((await call('POST', '/devices', { token: good }, u.token)).status, 201, 'the same token twice is fine');
    const mine = (await call('GET', '/devices', null, u.token)).body.devices;
    assert.equal(mine.length, 1); assert.equal(mine[0].platform, 'android'); assert.equal(mine[0].label, 'Pixel 7');
    assert.equal((await call('DELETE', '/devices', { token: good }, u.token)).status, 204); assert.equal((await call('GET', '/devices', null, u.token)).body.devices.length, 0);

    // A connected guest can register without an account. The row has no user, enters general
    // broadcasts, and is deliberately absent from profile-based episode targeting.
    const guestToken = 'guest-fcm-token-' + 'g'.repeat(30);
    assert.equal((await call('POST', '/devices/guest', { token: 'short' })).status, 400);
    assert.equal((await call('POST', '/devices/guest', { token: guestToken, platform: 'android', label: 'Guest Android' })).status, 201);
    assert.equal((await call('POST', '/devices/guest', { token: guestToken })).status, 201, 'guest registration is idempotent');
    const generalAudience = await db.devices.audienceFor({ kind: 'all' });
    assert.ok(generalAudience.some((d) => d.token === guestToken && d.userId === null), 'guest token is anonymous');
    const personalizedAudience = await db.devices.audienceFor({ kind: 'episodes', showId: 'guest-show', videoIds: [] });
    assert.equal(personalizedAudience.some((d) => d.token === guestToken), false, 'guest device data is not used for episode targeting');

    // Signing in associates the same installation with the account instead of duplicating it.
    const movingToken = 'guest-transition-token-' + 'm'.repeat(20);
    await call('POST', '/devices/guest', { token: movingToken });
    await call('POST', '/devices', { token: movingToken }, u.token);
    assert.ok((await db.devices.audienceFor({ kind: 'all' })).some((d) => d.token === movingToken && d.userId === u.user.id));
    await call('DELETE', '/devices', { token: movingToken }, u.token);

    // A broadcast reaches every registered token (and the web subscriptions of the audience) in one go.
    const token2 = 'fcm-device-token-' + 'b'.repeat(30);
    await call('POST', '/devices', { token: token2 }, u.token);
    await db.devices.upsert(u.user.id, { hash: crypto.createHash('sha256').update(dead[0]).digest('hex'), token: dead[0], platform: 'android' });
    assert.ok((await adm2('GET', '/notifications')).body.push.nativeDevices >= 3, 'app push is reported as configured');
    fcmSent.length = 0; pushed.length = 0;
    const c = await broadcast({ channel: 'push', title: 'App push', body: 'Hello phones', audience: 'all' }, adm2);
    assert.equal(c.status, 'sent');
    assert.equal(fcmSent.at(-1).message.title, 'App push'); assert.equal(fcmSent.at(-1).message.body, 'Hello phones'); assert.equal(fcmSent.at(-1).message.url, '/');
    assert.equal(fcmSent.at(-1).message.tag, `campaign-${c.id}`);
    assert.deepEqual([...fcmSent.at(-1).tokens].sort(), [token2, dead[0], guestToken].sort());
    const recipientPage = await adm2('GET', `/notifications/${c.id}/deliveries?limit=100`);
    assert.equal(recipientPage.status, 200); assert.ok(recipientPage.body.total >= 3, 'the page includes native devices and any web-push subscriptions');
    const accountDelivery = recipientPage.body.deliveries.find((d) => d.email === u.email && d.status === 'sent');
    assert.equal(accountDelivery.userId, u.user.id); assert.equal(accountDelivery.name, 'Eng Test'); assert.equal(accountDelivery.destination, 'Android');
    const skippedDelivery = recipientPage.body.deliveries.find((d) => d.status === 'skipped');
    assert.equal(skippedDelivery.email, u.email); assert.match(skippedDelivery.error, /expired or no longer registered/);
    const guestDelivery = recipientPage.body.deliveries.find((d) => d.userId === null);
    assert.equal(guestDelivery.name, 'Guest device'); assert.equal(guestDelivery.status, 'sent');
    const filtered = await adm2('GET', `/notifications/${c.id}/deliveries?status=skipped&limit=1`);
    assert.equal(filtered.body.total, 1); assert.equal(filtered.body.deliveries[0].status, 'skipped');
    assert.equal(await db.devices.count(), 2, 'the dead token was removed; account and guest tokens remain');
    assert.equal((await call('DELETE', '/devices/guest', { token: guestToken })).status, 204);
    assert.equal(await db.devices.count(), 1, 'guest opt-out removes the anonymous token');

    // Per-device notification choices: the app now has the same three switches as the browser
    // (episodes / launches / news), read and written by token possession.
    const prefsToken = 'fcm-device-prefs-' + 'p'.repeat(30);
    assert.equal((await call('POST', '/devices', { token: prefsToken }, u.token)).status, 201);
    assert.deepEqual((await call('POST', '/devices/status', { token: prefsToken })).body.prefs,
      { episodes: true, launches: true, news: true }, 'a fresh device gets the web defaults — all three on');
    assert.equal((await call('PATCH', '/devices/prefs', { token: prefsToken, episodes: false, news: true })).status, 204);
    assert.deepEqual((await call('POST', '/devices/status', { token: prefsToken })).body.prefs,
      { episodes: false, launches: true, news: true }, 'only the switches that were sent change');
    assert.equal((await call('PATCH', '/devices/prefs', { token: prefsToken, episodes: 'yes' })).status, 400, 'booleans only');
    assert.equal((await call('PATCH', '/devices/prefs', { token: 'short', news: true })).status, 400);
    assert.equal((await call('POST', '/devices/status', { token: 'unknown-token-' + 'u'.repeat(20) })).body.prefs, null);
    // The apps re-register on every start; that must not wipe the viewer's choices.
    assert.equal((await call('POST', '/devices', { token: prefsToken, platform: 'android', label: 'Pixel 7' }, u.token)).status, 201);
    assert.deepEqual((await call('POST', '/devices/status', { token: prefsToken })).body.prefs,
      { episodes: false, launches: true, news: true }, 're-registration keeps them');
    // Audience selection honours them, exactly like the browser subscriptions.
    assert.ok((await db.devices.audienceFor({ kind: 'all' })).some((d) => d.token === prefsToken), 'everyone-broadcasts ignore the switches');
    assert.ok((await db.devices.audienceFor({ kind: 'news' })).some((d) => d.token === prefsToken), 'news is on for this device');
    assert.ok((await db.devices.audienceFor({ kind: 'news' })).some((d) => d.token === token2), 'and on for a device nobody configured — announcements are the default now');
    await call('PATCH', '/devices/prefs', { token: token2, news: false });
    assert.equal((await db.devices.audienceFor({ kind: 'news' })).some((d) => d.token === token2), false, 'until the viewer turns them off');
    await call('PATCH', '/devices/prefs', { token: token2, news: true });

    // The targeted audiences really do filter on the switch: follow a show, then turn episodes off.
    // (Episodes are off from the round-trip above — put them back before testing the following case.)
    await call('PATCH', '/devices/prefs', { token: prefsToken, episodes: true });
    const followed = (await call('GET', '/catalog')).body.shows[0];
    const profileId = u.profiles[0].id;
    await db.library.addListItem(profileId, 'show', followed.id);
    const epAudience = { kind: 'episodes', showId: followed.id, videoIds: [] };
    assert.ok((await db.devices.audienceFor(epAudience)).some((d) => d.token === prefsToken), 'a follower with episodes on is included');
    await call('PATCH', '/devices/prefs', { token: prefsToken, episodes: false });
    assert.equal((await db.devices.audienceFor(epAudience)).some((d) => d.token === prefsToken), false, 'episodes off means skipped, even while following the show');
    await call('PATCH', '/devices/prefs', { token: prefsToken, episodes: true });
    assert.ok((await db.devices.audienceFor(epAudience)).some((d) => d.token === prefsToken), 'turning it back on restores the notification');

    // The launch switch behaves the same way, and is independent of the episode one.
    const soon = (await call('GET', '/catalog')).body.upcoming[0];
    await db.library.addReminder(profileId, soon.id);
    const launchAudience = { kind: 'launches', upcomingId: soon.id };
    assert.ok((await db.devices.audienceFor(launchAudience)).some((d) => d.token === prefsToken), 'reminder-holders with launches on are included');
    await call('PATCH', '/devices/prefs', { token: prefsToken, launches: false });
    assert.equal((await db.devices.audienceFor(launchAudience)).some((d) => d.token === prefsToken), false, 'launches off means skipped');
    assert.ok((await db.devices.audienceFor(epAudience)).some((d) => d.token === prefsToken), 'while episodes — still on — keeps working');
    assert.equal((await call('DELETE', '/devices', { token: prefsToken }, u.token)).status, 204);

    // E-mail campaigns: plain-text body becomes paragraphs, every mail carries a working unsubscribe link.
    mails.length = 0;
    const mailUser = await signup();
    const mail = await broadcast({ channel: 'email', title: 'New this week', body: 'Hello!\n\nSeason 2 is streaming.', url: '/plans', button: 'Watch now', audience: 'all' });
    assert.equal(mail.status, 'sent'); assert.ok(mail.sent >= 1); assert.equal(mail.total >= mail.sent, true);
    const got = mails.find((m) => m.to === mailUser.email && /New this week/.test(m.subject));
    assert.ok(got, 'the announcement reached a normal account (the account’s own verification mail is not it)');
    const mailDetails = await adm('GET', `/notifications/${mail.id}/deliveries?q=${encodeURIComponent(mailUser.email)}`);
    assert.equal(mailDetails.body.total, 1);
    assert.deepEqual([mailDetails.body.deliveries[0].userId, mailDetails.body.deliveries[0].name, mailDetails.body.deliveries[0].email, mailDetails.body.deliveries[0].status],
      [mailUser.user.id, 'Eng Test', mailUser.email, 'sent']);
    assert.match(got.subject, /New this week/);
    assert.match(got.html, /Season 2 is streaming/); assert.match(got.html, /Watch now/);
    const unsub = String(got.text).match(/https:\/\/addabaaz\.in\/api\/v1\/notifications\/unsubscribe\?u=[^&\s]+&t=[\w-]+/)[0];
    assert.equal((await fetch(unsub.replace('https://addabaaz.in', root))).status, 200);
    assert.equal(await db.adminUsers.emailOptOut(mailUser.user.id), true);
    // A forged token changes nothing.
    assert.equal((await fetch(unsub.replace('https://addabaaz.in', root).replace(/t=[\w-]+/, 't=forged'))).status, 200);
    mails.length = 0;
    const again = await broadcast({ channel: 'email', title: 'Second announcement', body: 'More news', audience: 'all' });
    assert.equal(again.status, 'sent');
    assert.equal(mails.some((m) => m.to === mailUser.email && /Second announcement/.test(m.subject)), false, 'unsubscribed accounts are skipped');
    const evicted = (await adm('GET', '/notifications')).body.email.audiences.find((a) => a.id === 'all');
    assert.ok(evicted.count >= 1);

    // Test sends: only from a signed-in admin session, and they never reach the audience.
    assert.equal((await adm2('POST', '/notifications/test', { channel: 'email', title: 'T', body: 'B' })).status, 400);
    const viewer = await signup(); const viewerAdm = (m, p, b) => fetch(`${base2}/admin${p}`, { method: m, headers: { Authorization: `Bearer ${viewer.token}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    assert.equal((await viewerAdm('GET', '/notifications')).status, 403);
  } finally { server2.close(); }
});

test('admin: analytics and error log views', async () => {
  const v = (await call('GET', '/catalog')).body.videos.find((x) => x.kind === 'episode');
  await call('POST', '/events/play', { videoId: v.id, event: 'start' }); await call('POST', '/events/play', { videoId: v.id, event: 'progress', seconds: 30 });
  const a = (await adm('GET', '/analytics?days=7')).body; assert.equal(a.days, 7); assert.ok(a.totals.plays >= 1); assert.ok(a.videos[0].title); assert.ok(a.shows.length >= 1); assert.equal(Array.isArray(a.business.days), true);
  assert.equal((await adm('GET', '/analytics?days=abc')).body.days, 30);
  await call('POST', '/client-errors', { message: 'Boom in player', url: '/watch/x' });
  const e = (await adm('GET', '/errors')).body; assert.ok(e.groups.some((g) => g.message === 'Boom in player')); assert.ok((await adm('GET', '/inbox')).body.errors >= 1);
  assert.equal((await adm('DELETE', '/errors')).status, 204); assert.equal((await adm('GET', '/errors')).body.groups.length, 0);
});

test('subtitles: SRT is converted to WebVTT, stored, served, and validated on the video', async () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\nনমস্কার\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nHello\r\n';
  const up = await adm('POST', '/uploads/subtitle', null, srt); assert.equal(up.status, 201); assert.equal(up.body.cues, 2); assert.match(up.body.path, /^uploads\/[0-9a-f]{24}\.vtt$/);
  const file = await fetch(`${root}/${up.body.path}`); assert.equal(file.status, 200); assert.match(file.headers.get('content-type'), /text\/vtt/); const txt = await file.text(); assert.match(txt, /^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:03\.500/); assert.ok(txt.includes('নমস্কার'));
  assert.equal((await adm('POST', '/uploads/subtitle', null, 'just some text')).status, 400);
  assert.equal((await adm('POST', '/uploads/subtitle', null, '<html>00:00:01,000 --> 00:00:02,000</html>')).status, 201, 'cue timing is what defines a subtitle (HTML is inert as .vtt text)');
  const v = (await call('GET', '/catalog')).body.videos.find((x) => x.kind === 'episode'); const full = (await adm('GET', '/catalog')).body.videos.find((x) => x.id === v.id);
  const put = (subtitles) => adm('PUT', `/catalog/videos/${v.id}`, { ...full, subtitles });
  assert.equal((await put([{ lang: 'bn', label: 'বাংলা', url: up.body.path }, { lang: 'en', label: 'English', url: 'https://cdn.example.com/en.vtt' }])).status, 200);
  assert.deepEqual((await call('GET', '/catalog')).body.videos.find((x) => x.id === v.id).subtitles.map((t) => t.lang), ['bn', 'en']);
  for (const [why, subs] of [['not vtt', [{ lang: 'en', label: 'E', url: 'https://x.com/a.txt' }]], ['missing file', [{ lang: 'en', label: 'E', url: 'uploads/ffffffffffffffffffffffff.vtt' }]], ['dup lang', [{ lang: 'en', label: 'E', url: 'https://x.com/a.vtt' }, { lang: 'en', label: 'F', url: 'https://x.com/b.vtt' }]], ['bad lang', [{ lang: 'English!', label: 'E', url: 'https://x.com/a.vtt' }]], ['js url', [{ lang: 'en', label: 'E', url: 'javascript:alert(1).vtt' }]]])
    assert.equal((await put(subs)).status, 400, why);
  assert.equal((await put([])).status, 200); assert.equal((await call('GET', '/catalog')).body.videos.find((x) => x.id === v.id).subtitles, undefined);
});

test('maturity ratings validate; scheduled publishing hides an item until it is due, then it appears as new', async () => {
  const shows = (await adm('GET', '/catalog')).body.shows; const s0 = shows[0];
  assert.equal((await adm('PUT', `/catalog/shows/${s0.id}`, { ...s0, rating: '99+' })).status, 400);
  assert.equal((await adm('PUT', `/catalog/shows/${s0.id}`, { ...s0, rating: '7+' })).status, 200); assert.equal((await call('GET', '/catalog')).body.shows.find((x) => x.id === s0.id).rating, '7+');
  const future = new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const doc = { id: 'sched-1', showId: s0.id, kind: 'episode', episode: 99, title: 'Scheduled episode', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 600, publishedAt: '2026-01-01T00:00:00Z', publishAt: future, access: 'free' };
  assert.equal((await adm('POST', '/catalog/videos', doc)).status, 201);
  assert.equal((await call('GET', '/catalog')).body.videos.some((v) => v.id === 'sched-1'), false, 'hidden from visitors');
  assert.equal((await adm('GET', '/catalog')).body.videos.find((v) => v.id === 'sched-1').publishAt, future, 'the admin still sees it');
  assert.equal((await call('POST', '/videos/sched-1/stream', null, null)).status, 404, 'and cannot be played');
  const sitemap = await (await fetch(`${root}/sitemap.xml`)).text(); assert.equal(sitemap.includes('sched-1'), false);
  const past = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  assert.equal((await adm('PUT', '/catalog/videos/sched-1', { ...doc, publishAt: past })).status, 200);
  const live = (await call('GET', '/catalog')).body.videos.find((v) => v.id === 'sched-1'); assert.ok(live, 'due → visible'); assert.equal(live.publishedAt, past); assert.equal(live.publishAt, undefined);
});

test('the scheduled job announces newly published episodes exactly once', async () => {
  const u = await signup(); const cat = (await call('GET', '/catalog')).body; const show = cat.shows[0];
  await call('POST', '/push/subscribe', { subscription: { endpoint: 'https://push.example/job1', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } } }, u.token);
  await call('PUT', `/profiles/${u.profiles[0].id}/list/show/${show.id}`, null, u.token);
  const { runScheduledJobs } = await import('../src/jobs.js');
  const doc = { id: 'sched-2', showId: show.id, kind: 'episode', episode: 100, title: 'Fresh one', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 600, publishedAt: '2026-01-01T00:00:00Z', publishAt: new Date(Date.now() - 1000).toISOString(), access: 'free' };
  assert.equal((await adm('POST', '/catalog/videos', doc)).status, 201);
  pushed.length = 0;
  const r1 = await runScheduledJobs({ db, catalog: theApp.locals.catalog, push: theApp.locals.push, log: { info() {}, error: console.error } });
  assert.ok(pushed.some((p) => p.url === '/watch/sched-2')); assert.ok(r1.episodes >= 1);
  pushed.length = 0; const r2 = await runScheduledJobs({ db, catalog: theApp.locals.catalog, push: theApp.locals.push, log: { info() {} } }); assert.equal(pushed.length, 0); assert.equal(r2.episodes, 0);
});
