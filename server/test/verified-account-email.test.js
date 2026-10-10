// Verified contact-email flow for SMS-only accounts. Uses fake persistence and SMTP; no MySQL or external mailer.
// Run: node --test server/test/verified-account-email.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { createFeatures } from '../src/features.js';
import { extraDb } from '../src/db-extra.js';
import { runScheduledJobs } from '../src/jobs.js';

const placeholder = '919812345678@phone.addabaaz.in';
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function apiFixture({ send = async () => ({ sent: true }), existing = null, provider = 'smtp' } = {}) {
  const user = { id: 'phone-user', email: placeholder, name: 'Rina Das', emailVerifiedAt: new Date(), phone: '919812345678', phoneVerifiedAt: new Date(), passwordHash: null };
  const state = { user, existing, pending: null, confirmed: false, lastIssuedAt: null, sent: [], revoked: [], payment: null, refundRequests: [] };
  const db = {
    payments: { async byId() { return state.payment; } },
    refundRequests: {
      async pendingFor() { return state.refundRequests.find((r) => r.paymentId === state.payment?.id)?.status === 'pending'; },
      async create(request) { state.refundRequests.push({ ...request, status: 'pending' }); },
    },
    users: {
      async byEmailNorm(email) { return state.existing?.email === email ? state.existing : null; },
      async byEmail(email) { return state.existing?.email === email ? state.existing : null; },
    },
    emailChanges: {
      async lastIssuedAt() { return state.lastIssuedAt; },
      async issue(userId, request) { state.pending = { userId, ...request }; state.lastIssuedAt = new Date(); state.confirmed = false; return true; },
      async revoke(userId, tokenHash) { state.revoked.push({ userId, tokenHash }); state.pending = null; },
      async confirm(tokenHash) {
        if (!state.pending || state.pending.tokenHash !== tokenHash || state.confirmed) return null;
        state.confirmed = true;
        state.user.email = state.pending.email;
        return { userId: state.user.id, email: state.pending.email };
      },
    },
  };
  const mailer = { provider, async send(message) { state.sent.push(message); return send(message); } };
  const features = createFeatures({
    db, secret: 'test-only-session-secret', mailer,
    push: { configured: false, nativeConfigured: false, publicKey: null }, catalog: {},
    siteUrl: 'https://app.example.test', rate: false,
    publicUser: (u) => ({ id: u.id, email: u.email }), notDisabled() {},
    userFromRequest: async () => null, plans: [{ id: 'plus-monthly', name: 'ADDABAAZ Plus' }],
    options: { supportEmail: '', refundWindowDays: 7 },
  });
  const router = express.Router();
  features.public(router);
  features.authed(router);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = state.user; next(); });
  app.use('/api/v1', router);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: { code: err.code || 'internal_error', message: err.message } }));
  return { app, db, state };
}

async function withServer(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/v1`;
}

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('issuing a link stores the normalized pending address with only a token hash and serializes re-sends', async () => {
  const statements = [];
  const db = extraDb({
    q: async (sql, params) => { statements.push({ sql, params }); return []; },
    tx: async (fn) => fn({ query: async (sql, params) => {
      statements.push({ sql, params });
      return { affectedRows: 1 };
    } }),
    iso: (value) => value,
  });
  const before = Date.now();
  assert.equal(await db.emailChanges.issue('phone-user', { email: 'rina@example.com', emailNorm: 'rina@example.com', tokenHash: 'b'.repeat(64), ttlMs: 60 * 60 * 1000 }), true);
  assert.match(statements[0].sql, /UPDATE users SET email_change_requested_at = UTC_TIMESTAMP\(3\)/);
  assert.match(statements[0].sql, /email_change_requested_at <= UTC_TIMESTAMP\(3\) - INTERVAL 60 SECOND/);
  assert.match(statements[1].sql, /DELETE FROM email_change_tokens WHERE user_id/);
  assert.match(statements[2].sql, /INSERT INTO email_change_tokens \(token_hash, user_id, email, email_norm, expires_at\)/);
  assert.deepEqual(statements[2].params.slice(0, 4), ['b'.repeat(64), 'phone-user', 'rina@example.com', 'rina@example.com']);
  assert.ok(statements[2].params[4].getTime() - before >= 60 * 60 * 1000 - 1000);

  const blocked = [];
  const cooldownDb = extraDb({
    q: async () => [],
    tx: async (fn) => fn({ query: async (sql, params) => { blocked.push({ sql, params }); return { affectedRows: 0 }; } }),
    iso: (value) => value,
  });
  assert.equal(await cooldownDb.emailChanges.issue('phone-user', { email: 'later@example.com', emailNorm: 'later@example.com', tokenHash: 'c'.repeat(64), ttlMs: 3600_000 }), false);
  assert.equal(blocked.length, 1, 'a concurrent or too-soon issue never inserts another token');
});

test('pending address is promoted only inside the single-use, unexpired token transaction', async () => {
  const statements = [];
  let transactions = 0;
  const db = extraDb({
    q: async (sql, params) => { statements.push({ sql, params }); return []; },
    tx: async (fn) => {
      transactions++;
      return fn({ query: async (sql, params) => {
        statements.push({ sql, params });
        if (sql.startsWith('SELECT user_id FROM email_change_tokens')) return [{ user_id: 'phone-user' }];
        if (sql.startsWith('SELECT id FROM users')) return [{ id: 'phone-user' }];
        if (sql.startsWith('SELECT user_id, email, email_norm')) return [{ user_id: 'phone-user', email: 'rina@example.com', email_norm: 'rina@example.com' }];
        if (sql.startsWith('UPDATE users SET email')) return { affectedRows: 1 };
        return { affectedRows: 1 };
      } });
    },
    iso: (value) => value,
  });

  const result = await db.emailChanges.confirm('a'.repeat(64));
  assert.deepEqual(result, { userId: 'phone-user', email: 'rina@example.com' });
  assert.equal(transactions, 1, 'locking, account update and token consumption share one transaction');
  assert.match(statements[0].sql, /SELECT user_id FROM email_change_tokens/);
  assert.match(statements[1].sql, /SELECT id FROM users WHERE id = \? FOR UPDATE/);
  assert.match(statements[2].sql, /expires_at > UTC_TIMESTAMP\(3\) FOR UPDATE/);
  assert.match(statements[3].sql, /phone_verified_at IS NOT NULL OR email_verified_at IS NOT NULL/, 'the account needs a verified phone or email');
  assert.deepEqual(statements[3].params, ['rina@example.com', 'rina@example.com', 'phone-user']);
  assert.match(statements[4].sql, /DELETE FROM email_change_tokens WHERE token_hash/);
});

test('scheduled housekeeping invokes the pending-email address/token purge', async () => {
  const purged = [];
  const db = {
    authTokens: { async purge() {} }, emailChanges: { async purge() { purged.push('email-changes'); } }, phoneOtps: { async purge() {} },
    playback: { async purge() {} }, errors: { async prune() {} }, push: { async pruneSent() {} }, devices: { async purge() {} },
    tickets: { async prune() {} }, messages: { async prune() {} }, campaigns: { async prune() {} },
  };
  await runScheduledJobs({ db, catalog: { async get() { return { catalog: { shows: [], videos: [] } }; } }, push: { configured: false }, log: { error() {} } });
  assert.deepEqual(purged, ['email-changes']);
});

test('email-change purge removes expired pending addresses and old resend timestamps', async () => {
  const statements = [];
  const db = extraDb({ q: async (sql, params) => { statements.push({ sql, params }); return []; }, tx: async (fn) => fn({ query: async () => ({ affectedRows: 1 }) }), iso: (value) => value });
  await db.emailChanges.purge();
  assert.match(statements[0].sql, /DELETE FROM email_change_tokens WHERE expires_at < UTC_TIMESTAMP\(3\) - INTERVAL 1 DAY/);
  assert.match(statements[1].sql, /UPDATE users SET email_change_requested_at = NULL WHERE email_change_requested_at < UTC_TIMESTAMP\(3\) - INTERVAL 1 DAY/);
});

test('phone-only account keeps its placeholder until the emailed address is confirmed', async (t) => {
  const f = apiFixture();
  const base = await withServer(t, f.app);
  const response = await post(base, '/me/email', { email: ' Rina@Example.com ' });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(f.state.user.email, placeholder, 'requesting a change must not replace the internal placeholder');
  assert.equal(f.state.pending.email, 'rina@example.com');
  assert.equal(f.state.pending.emailNorm, 'rina@example.com');
  assert.equal(f.state.pending.ttlMs, 60 * 60 * 1000);
  assert.equal(f.state.sent.length, 1);
  assert.equal(f.state.sent[0].to, 'rina@example.com');
  assert.match(f.state.sent[0].subject, /Confirm the email/);

  const token = /emailChange=1&token=([A-Za-z0-9_-]+)/.exec(f.state.sent[0].text)?.[1];
  assert.ok(token, 'the message contains the single-use confirmation URL');
  assert.equal(f.state.pending.tokenHash, hash(token), 'only a token hash is given to persistence');

  const confirmed = await post(base, '/auth/email-change/verify', { token });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await confirmed.json(), { verified: true, email: 'rina@example.com' });
  assert.equal(f.state.user.email, 'rina@example.com');
  assert.equal(f.state.confirmed, true);
  const reuse = await post(base, '/auth/email-change/verify', { token });
  assert.equal(reuse.status, 400, 'the confirmation token cannot be reused');

  // After the request cooldown, a phone-verified user can replace an already-confirmed contact email too.
  f.state.lastIssuedAt = new Date(Date.now() - 61_000);
  const update = await post(base, '/me/email', { email: 'new-address@example.com' });
  assert.equal(update.status, 202);
  assert.equal(f.state.user.email, 'rina@example.com', 'the current verified email remains active until its replacement is confirmed');
  assert.equal(f.state.sent[1].to, 'new-address@example.com');
  const nextToken = /emailChange=1&token=([A-Za-z0-9_-]+)/.exec(f.state.sent[1].text)?.[1];
  assert.ok(nextToken);
  const updated = await post(base, '/auth/email-change/verify', { token: nextToken });
  assert.equal(updated.status, 200);
  assert.equal(f.state.user.email, 'new-address@example.com');
});

test('phone-only refund-request confirmations are shown in Billing, not sent to the placeholder', async (t) => {
  const f = apiFixture();
  f.state.payment = { id: 'payment-1', userId: f.state.user.id, status: 'paid', provider: 'razorpay', amountPaise: 9900, refundedPaise: 0, paidAt: new Date().toISOString(), planId: 'plus-monthly' };
  const base = await withServer(t, f.app);
  const response = await post(base, '/payments/payment-1/refund-request', { reason: 'Please review this charge.' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).request.status, 'pending');
  assert.equal(f.state.sent.length, 0, 'no customer-facing refund email is sent to the internal placeholder');
  const duplicate = await post(base, '/payments/payment-1/refund-request', {});
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error.message, /check Billing for updates/);
});

test('reserved, already-owned, and undeliverable addresses never replace the placeholder', async (t) => {
  const taken = apiFixture({ existing: { id: 'other-user', email: 'taken@example.com' } });
  const takenBase = await withServer(t, taken.app);
  const reserved = await post(takenBase, '/me/email', { email: '123@phone.addabaaz.in' });
  assert.equal(reserved.status, 400);
  assert.equal(taken.state.sent.length, 0);
  const duplicate = await post(takenBase, '/me/email', { email: 'taken@example.com' });
  assert.equal(duplicate.status, 409);
  assert.equal(taken.state.user.email, placeholder);
  assert.equal(taken.state.sent.length, 0);

  const brokenMail = apiFixture({ send: async () => { throw new Error('SMTP unavailable'); } });
  const brokenBase = await withServer(t, brokenMail.app);
  const failed = await post(brokenBase, '/me/email', { email: 'rina@example.com' });
  assert.equal(failed.status, 503);
  assert.equal(brokenMail.state.user.email, placeholder);
  assert.equal(brokenMail.state.pending, null, 'failed delivery revokes the unusable token and pending address');
  assert.equal(brokenMail.state.revoked.length, 1);

  const noSmtp = apiFixture({ provider: 'none' });
  const noSmtpBase = await withServer(t, noSmtp.app);
  const unavailable = await post(noSmtpBase, '/me/email', { email: 'rina@example.com' });
  assert.equal(unavailable.status, 503);
  assert.equal(noSmtp.state.pending, null);
  assert.equal(noSmtp.state.sent.length, 0, 'development mode does not claim an email was sent when there is no SMTP transport');
});


test('verified email accounts can request a replacement, but unverified accounts cannot', async (t) => {
  const { app, state } = apiFixture();
  state.user.phoneVerifiedAt = null;
  state.user.email = 'existing@example.com';
  const base = await withServer(t, app);
  const response = await post(base, '/me/email', { email: 'new@example.com' });
  assert.equal(response.status, 202);
  assert.equal(state.user.email, 'existing@example.com', 'current email is unchanged until confirmation');
  assert.equal(state.pending.email, 'new@example.com');
  state.user.emailVerifiedAt = null;
  const rejected = await post(base, '/me/email', { email: 'other@example.com' });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, 'email_unverified');
});
