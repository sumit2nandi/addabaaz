// Phone sign-in (SMS OTP, MSG91): number normalisation, the provider factory, the MSG91 request/response
// handling, and the two HTTP endpoints — all without MySQL (the database is a fake, MSG91 is a fake fetch).
// Run: node --test server/test/phone-signin.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { smsFromEnv, createMsg91, normalizePhone, generateOtp, phoneEmail, isPhoneEmail, maskPhone, SmsError } from '../src/sms.js';
import { registerOtpRoutes } from '../src/routes/otp.js';
import { registerAuthRoutes } from '../src/routes/auth.js';

/* ---------- normalisation ---------- */
test('phone numbers are normalised to MSG91’s 91XXXXXXXXXX form', () => {
  for (const input of ['9812345678', '+91 98123 45678', '098123 45678', '0091-9812345678', '(981) 234-5678', '91 98123 45678', '+919812345678'])
    assert.equal(normalizePhone(input), '919812345678', input);
  // Other countries keep their own code.
  assert.equal(normalizePhone('+44 7700 900123', '44'), '447700900123');
  assert.equal(normalizePhone('7700900123', '44'), '447700900123');
  // Nothing that cannot be a number.
  for (const bad of ['', '   ', 'abc', '12345', '+1 234 567 8901 234 567', '98123']) assert.equal(normalizePhone(bad), null, JSON.stringify(bad));
});

test('the reserved phone-account address can never receive or be mistaken for real mail', () => {
  assert.equal(phoneEmail('+91 98123 45678'), '919812345678@phone.addabaaz.in');
  assert.equal(isPhoneEmail('919812345678@phone.addabaaz.in'), true);
  assert.equal(isPhoneEmail('919812345678@PHONE.ADDABAAZ.IN'), true);
  assert.equal(isPhoneEmail('viewer@example.com'), false);
  assert.equal(isPhoneEmail(''), false);
});

test('the masked form shown to admins hides the middle of the number', () => {
  assert.equal(maskPhone('919812345678'), '+91 981••••678');
  assert.equal(maskPhone('9812345678'), '98•••••678');
  assert.equal(maskPhone(''), '');
});

test('generated codes are always the requested number of digits', () => {
  for (let i = 0; i < 200; i++) assert.match(generateOtp(6), /^\d{6}$/);
  assert.match(generateOtp(4), /^\d{4}$/);
});

/* ---------- provider selection ---------- */
test('the provider is chosen from the environment: real / dev stand-in / none', () => {
  const quiet = { warn() {}, log() {} };
  const real = smsFromEnv({ MSG91_AUTH_KEY: 'key-123', MSG91_OTP_TEMPLATE_ID: 'tpl-1' }, { log: quiet });
  assert.equal(real.provider, 'msg91'); assert.equal(real.configured, true); assert.equal(real.countryCode, '91');

  // Half-configured is a configuration mistake, not a working setup.
  const half = smsFromEnv({ MSG91_AUTH_KEY: 'key-123' }, { log: quiet });
  assert.notEqual(half.provider, 'msg91');
  assert.equal(half.dev, true, 'in development the console provider keeps the flow testable');

  const dev = smsFromEnv({}, { log: quiet });
  assert.equal(dev.provider, 'console'); assert.equal(dev.dev, true);

  const prod = smsFromEnv({ NODE_ENV: 'production' }, { log: quiet });
  assert.equal(prod.provider, 'none'); assert.equal(prod.configured, false);
  assert.equal(smsFromEnv({ NODE_ENV: 'production', MSG91_AUTH_KEY: 'k', MSG91_OTP_TEMPLATE_ID: 't' }, { log: quiet }).provider, 'msg91');
});

/* ---------- MSG91 request/response handling ---------- */
test('MSG91 is called with the documented v5 parameters and headers', async () => {
  const calls = [];
  const sms = createMsg91({
    authKey: 'key-123', templateId: 'tpl-1', senderId: 'ADDABZ', countryCode: '91',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ type: 'success', message: 'request-id' }) }; },
  });
  const r = await sms.send({ phone: '919812345678', code: '042917', minutes: 10 });
  assert.deepEqual(r, { sent: true, providerRef: 'request-id' });
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://control.msg91.com/api/v5/otp');
  assert.equal(url.searchParams.get('template_id'), 'tpl-1');
  assert.equal(url.searchParams.get('mobile'), '919812345678');
  assert.equal(url.searchParams.get('otp'), '042917');
  assert.equal(url.searchParams.get('otp_length'), '6');
  assert.equal(url.searchParams.get('otp_expiry'), '10');
  assert.equal(url.searchParams.get('sender'), 'ADDABZ');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authkey, 'key-123');
  assert.equal(JSON.parse(calls[0].init.body).otp, '042917', 'the code is also repeated in the JSON body');
});

test('MSG91 failures arrive as HTTP 200 with type:error — the body decides', async () => {
  const quiet = { warn() {} };
  const failing = createMsg91({ authKey: 'bad', templateId: 'tpl', log: quiet, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ type: 'error', code: '201', message: 'Invalid Authkey' }) }) });
  await assert.rejects(() => failing.send({ phone: '919812345678', code: '123456' }), (e) => e instanceof SmsError && e.status === 502 && e.code === 'sms_auth_failed');

  const rejected = createMsg91({ authKey: 'key', templateId: 'tpl', log: quiet, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ type: 'error', message: 'template not found' }) }) });
  await assert.rejects(() => rejected.send({ phone: '919812345678', code: '123456' }), (e) => e.code === 'sms_send_failed');

  const down = createMsg91({ authKey: 'key', templateId: 'tpl', log: quiet, fetchImpl: async () => { throw new Error('socket hang up'); } });
  await assert.rejects(() => down.send({ phone: '919812345678', code: '123456' }), (e) => e.status === 503 && e.code === 'sms_unavailable');
});

/* ---------- the HTTP endpoints ---------- */
function phoneDb() {
  const state = { users: [], otps: [], nextId: 1 };
  return {
    state,
    profiles: { async list() { return [{ id: 'p1', name: 'Ram', color: 0 }]; } },
    accounts: { async markVerified(id) { state.verified = id; } },
    phones: {
      async byPhone(phone) { return state.users.find((u) => u.phone === phone) || null; },
      async createWithPhone(user, profile) {
        if (state.users.some((u) => u.phone === user.phone)) { const e = new Error('duplicate'); e.code = 'ER_DUP_ENTRY'; throw e; }
        state.users.push({ ...user, phoneVerifiedAt: null, emailVerifiedAt: null }); state.profile = profile; state.created = user;
      },
      async attach(id, phone) { state.attached = { id, phone }; },
    },
    phoneOtps: {
      async lastIssuedAt() { return state.lastIssued || null; },
      async recentCount() { return state.recent || 0; },
      async issue(phone, codeHash, ttl) {
        state.issued = { phone, codeHash, ttl };
        const row = { id: `o${state.nextId++}`, phone, codeHash, attempts: 0 };
        state.otps = [row]; state.lastIssued = new Date(); state.recent = (state.recent || 0) + 1;
      },
      async active(phone) { return state.otps.find((o) => o.phone === phone) || null; },
      async fail(id, max) { const o = state.otps.find((x) => x.id === id); if (o) o.attempts = Math.min(o.attempts + 1, max); },
      async consume(id) { const i = state.otps.findIndex((x) => x.id === id); if (i < 0) return false; state.otps.splice(i, 1); return true; },
    },
  };
}

async function otpServer({ sms, seedUsers = [] } = {}) {
  const provider = sms ?? smsFromEnv({}, { log: { warn() {}, log() {} } });
  const db = phoneDb();
  db.state.users = seedUsers;
  // The test needs the code that was handed to the provider: the real provider records it (the console
  // provider only logs it, and the stored row keeps nothing but its hash — by design).
  const recording = {
    provider: provider.provider, configured: provider.configured, dev: provider.dev, countryCode: provider.countryCode || '91',
    async send(o) { db.state.lastCode = o.code; return { sent: true, providerRef: 'test' }; },
  };
  const router = express.Router(); router.use(express.json());
  registerOtpRoutes(router, { db, sms: recording, secret: 'test-secret', publicUser: (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, emailIsPlaceholder: isPhoneEmail(u.email) }), notDisabled: (u) => u, authLimit: (_req, _res, next) => next() });
  const app = express(); app.use('/api/v1', router);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: { code: err.code, message: err.message } }));
  const server = app.listen(0); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  return { db, server, base, call: (method, path, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }) };
}

test('requesting a code stores only its hash and never reveals whether the number has an account', async () => {
  const { db, server, call } = await otpServer();
  try {
    const res = await call('POST', '/auth/otp/request', { phone: '+91 98123 45678' });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.devHint, true, 'in development the page may say the code went to the server log');
    assert.equal(db.state.issued.phone, '919812345678', 'the number is normalised before it is stored');
    assert.match(db.state.issued.codeHash, /^[0-9a-f]{64}$/, 'only the SHA-256 hash of the code is stored');
    assert.equal(db.state.issued.ttl, 600_000, 'codes live for 10 minutes');

    const bad = await call('POST', '/auth/otp/request', { phone: '123' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'invalid_phone');

    // One SMS a minute per number.
    const again = await call('POST', '/auth/otp/request', { phone: '9812345678' });
    assert.equal(again.status, 429);
    assert.equal((await again.json()).error.code, 'otp_cooldown');

    // …and at most five an hour.
    db.state.lastIssued = new Date(Date.now() - 120_000); db.state.recent = 5;
    const flood = await call('POST', '/auth/otp/request', { phone: '9812345678' });
    assert.equal(flood.status, 429);
    assert.equal((await flood.json()).error.code, 'otp_flood');
  } finally { server.close(); }
});

test('verifying a code signs in an existing account and creates one on first use', async () => {
  const { db, server, call } = await otpServer();
  try {
    await call('POST', '/auth/otp/request', { phone: '9812345678' });
    const code = await issuedCode(db);
    const created = await call('POST', '/auth/otp/verify', { phone: '9812345678', code, name: 'Ram Sen' });
    assert.equal(created.status, 200);
    const body = await created.json();
    assert.equal(body.isNew, true);
    assert.equal(body.phoneSignIn, true);
    assert.ok(body.token, 'a session token comes back');
    assert.equal(body.user.phone, '919812345678');
    assert.equal(body.user.emailIsPlaceholder, true, 'phone accounts get a reserved, non-routable address');
    assert.equal(db.state.created.email, '919812345678@phone.addabaaz.in');
    assert.equal(db.state.profile.name, 'Ram', 'a first profile is created from the name');
    assert.equal(db.state.verified, db.state.created.id, 'a verified phone counts as a verified identity');
    assert.equal(db.state.otps.length, 0, 'the code is consumed on success');

    // Second sign-in for the same number: no new account, isNew false.
    db.state.lastIssued = new Date(Date.now() - 120_000); db.state.recent = 1;
    await call('POST', '/auth/otp/request', { phone: '9812345678' });
    const code2 = await issuedCode(db);
    const again = await call('POST', '/auth/otp/verify', { phone: '9812345678', code: code2 });
    const body2 = await again.json();
    assert.equal(body2.isNew, false);
    assert.equal(body2.user.id, body.user.id);
    assert.equal(db.state.users.length, 1, 'the same number always maps to the same account');
  } finally { server.close(); }
});

test('a wrong code is counted, then the code is locked; expired codes ask for a new one', async () => {
  const { db, server, call } = await otpServer();
  try {
    await call('POST', '/auth/otp/request', { phone: '9812345678' });
    const code = await issuedCode(db);
    const wrong = await call('POST', '/auth/otp/verify', { phone: '9812345678', code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error.code, 'otp_invalid');
    assert.equal(db.state.otps[0].attempts, 1, 'the wrong try is recorded');

    for (let i = 0; i < 4; i++) await call('POST', '/auth/otp/verify', { phone: '9812345678', code: '000000' });
    const locked = await call('POST', '/auth/otp/verify', { phone: '9812345678', code });
    assert.equal(locked.status, 429);
    assert.equal((await locked.json()).error.code, 'otp_locked', 'the correct code no longer works after five wrong tries');

    db.state.otps = [];
    const expired = await call('POST', '/auth/otp/verify', { phone: '9812345678', code: '123456' });
    assert.equal(expired.status, 400);
    assert.equal((await expired.json()).error.code, 'otp_expired');

    const short = await call('POST', '/auth/otp/verify', { phone: '9812345678', code: '12' });
    assert.equal(short.status, 400);
    assert.equal((await short.json()).error.code, 'invalid_code');
  } finally { server.close(); }
});

test('without MSG91 configured in production the endpoints refuse politely — the app keeps working', async () => {
  const none = smsFromEnv({ NODE_ENV: 'production' }, { log: { warn() {} } });
  const { server, call } = await otpServer({ sms: none });
  try {
    for (const [path, body] of [['/auth/otp/request', { phone: '9812345678' }], ['/auth/otp/verify', { phone: '9812345678', code: '123456' }]]) {
      const res = await call('POST', path, body);
      assert.equal(res.status, 503);
      const err = (await res.json()).error;
      assert.equal(err.code, 'sms_not_configured');
      assert.match(err.message, /email/i, 'the message points at the fallback that does work');
    }
  } finally { server.close(); }
});

test('the sign-in page is told whether phone sign-in exists (and the country code to use)', async () => {
  const build = (sms) => {
    const api = express.Router();
    registerAuthRoutes(api, {
      db: {}, secret: 's', mailer: { provider: 'none' }, authLimit: (_q, _s, next) => next(),
      social: { config: { google: false, facebook: false, apple: false }, verifiers: {} },
      features: {}, publicUser: (u) => u, notDisabled: (u) => u, sms,
    });
    return api;
  };
  const real = smsFromEnv({ MSG91_AUTH_KEY: 'k', MSG91_OTP_TEMPLATE_ID: 't', MSG91_COUNTRY_CODE: '91' }, { log: { warn() {} } });
  const get = async (api) => {
    const server = express().use(api).listen(0);
    await new Promise((r) => server.once('listening', r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/auth/providers`);
    const body = await res.json(); server.close(); return body;
  };
  const on = await get(build(real));
  assert.equal(on.otp, true); assert.equal(on.otpCountryCode, '91'); assert.equal(on.password, true);
  const off = await get(build(smsFromEnv({ NODE_ENV: 'production' }, { log: { warn() {} } })));
  assert.equal(off.otp, false, 'no OTP tab when MSG91 is absent');
  assert.equal(off.password, true, 'email + password is always offered');
});

// The code as it left the server (recorded by the fake provider — the database only ever sees its hash).
const issuedCode = (db) => db.state.lastCode;
