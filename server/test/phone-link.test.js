import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerPhoneLinkRoutes } from '../src/routes/phone-link.js';
import { phoneLinkDb } from '../src/db-phone-link.js';

function fixture() {
  const routes = new Map(), state = { user: { id: 'u1', phone: null }, records: [], sent: [], taken: false, attached: null };
  const sms = { configured: true, provider: 'test', countryCode: '91', send: async (message) => { state.sent.push(message); } };
  const db = { phones: { byPhone: async () => state.taken ? { id: 'other' } : null }, phoneLinks: {
    issue: async (userId, phone, hash) => { state.records.push({ id: 'otp', userId, phone, hash }); return 'otp'; },
    revoke: async () => { state.records = []; },
    verify: async (userId, phone, hash) => {
      const record = state.records.find((r) => r.userId === userId && r.phone === phone && r.hash === hash);
      if (!record) return 'invalid';
      state.records = []; state.attached = { userId, phone }; return 'ok';
    },
  } };
  registerPhoneLinkRoutes({ post: (path, ...handlers) => routes.set(path, handlers.at(-1)) }, { db, sms, secret: 'test-secret', authLimit: (_q, _s, n) => n() });
  const call = async (path, body) => {
    let status = 200, result;
    await routes.get(`/me/phone/${path}`)({ user: state.user, body }, { status(n) { status = n; return this; }, json(value) { result = value; } }, (error) => { throw error; });
    return { status, result };
  };
  return { state, sms, db, call };
}

test('linking verifies an account-bound code without issuing a session or creating an account', async () => {
  const f = fixture();
  assert.equal((await f.call('request', { phone: '9812345678' })).status, 202);
  const code = f.state.sent[0].code;
  assert.notEqual(f.state.records[0].hash, code);
  f.state.user = { id: 'other', phone: null };
  await assert.rejects(f.call('verify', { phone: '9812345678', code }), { code: 'otp_invalid' });
  f.state.user = { id: 'u1', phone: null };
  await assert.rejects(f.call('verify', { phone: '9812345679', code }), { code: 'otp_invalid' });
  const verified = await f.call('verify', { phone: '9812345678', code });
  assert.deepEqual(verified.result, { phone: '919812345678', phoneVerified: true });
  assert.deepEqual(f.state.attached, { userId: 'u1', phone: '919812345678' });
  await assert.rejects(f.call('verify', { phone: '9812345678', code }));
});

test('existing numbers, malformed codes, unavailable SMS and delivery failure do not link accounts', async () => {
  const f = fixture(); f.state.taken = true;
  await assert.rejects(f.call('request', { phone: '9812345678' }), { code: 'phone_unavailable' });
  f.state.taken = false; f.state.user.phone = '919812345678';
  await assert.rejects(f.call('request', { phone: '9812345679' }), { code: 'phone_already_set' });
  f.state.user.phone = null;
  await assert.rejects(f.call('verify', { phone: '9812345678', code: '12' }), { code: 'invalid_code' });
  f.sms.configured = false;
  await assert.rejects(f.call('request', { phone: '9812345678' }), { status: 503 });
  f.sms.configured = true; f.sms.send = async () => { throw new Error('delivery failed'); };
  await assert.rejects(f.call('request', { phone: '9812345678' }));
  assert.equal(f.state.records.length, 0); assert.equal(f.state.attached, null);
});

test('persistence locks the owner and validates expiry, attempts and consumes in the linking transaction', async () => {
  let attempts = 0, linked = false, consumed = false;
  const queries = [];
  const query = async (sql) => {
    queries.push(sql);
    if (sql.startsWith('SELECT phone')) return [{ phone: null, disabled_at: null }];
    if (sql.startsWith('SELECT id, code_hash')) return consumed ? [] : [{ id: 'otp', code_hash: 'correct', attempts }];
    if (sql.includes('SET attempts =')) { attempts++; return {}; }
    if (sql.startsWith('UPDATE users')) { linked = true; return { affectedRows: 1 }; }
    if (sql.includes('SET consumed_at')) { consumed = true; return {}; }
    throw new Error(sql);
  };
  const db = phoneLinkDb({ q: query, tx: (fn) => fn({ query }) });
  for (let i = 0; i < 5; i++) assert.equal(await db.verify('u', 'phone', 'wrong'), 'invalid');
  assert.equal(await db.verify('u', 'phone', 'correct'), 'expired');
  assert.equal(linked, false);
  attempts = 0;
  assert.equal(await db.verify('u', 'phone', 'correct'), 'ok');
  assert.equal(linked, true); assert.equal(consumed, true);
  assert.equal(await db.verify('u', 'phone', 'correct'), 'expired');
  assert.match(queries[0], /FOR UPDATE/);
  assert.ok(queries.some((q) => /user_id = \? AND phone = \?.*expires_at > UTC_TIMESTAMP/.test(q)));
});

test('resend limits are enforced inside the account lock', async () => {
  for (const limits of [{ latest: new Date(), n: 1 }, { latest: null, n: 5 }]) {
    const db = phoneLinkDb({ q: async () => [], tx: (fn) => fn({ query: async (sql) => {
      if (sql.startsWith('SELECT phone')) return [{ phone: null }];
      if (sql.includes('MAX(created_at)')) return [limits];
      if (sql.includes('COUNT(*)')) return [{ n: 0 }];
      throw new Error('Should not issue a code');
    } }) });
    await assert.rejects(db.issue('u', 'phone', 'hash'), { status: 429 });
  }
});

test('link routes are installed after session authentication and UI uses only link endpoints', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf('  registerPhoneLinkRoutes(api') > app.indexOf('req.user = session.user; next();'));
  const ui = readFileSync(new URL('../../app/js/ui/add-phone.js', import.meta.url), 'utf8');
  assert.match(ui, /requestPhoneLink/); assert.match(ui, /verifyPhoneLink/);
  assert.doesNotMatch(ui, /verifyOtp|requestOtp|setToken/);
});
