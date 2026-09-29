import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { dbConfigFromEnv } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { createRazorpay, paymentsFromEnv } from '../src/payments.js';

/* Razorpay is exercised against a fake of its API + our own HMAC maths (no network, no real keys). */
const KEY_SECRET = 'rzp_secret_test', WEBHOOK_SECRET = 'whsec_test';
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const orders = new Map(); let calls = 0, failNext = false;
const fetchImpl = async (url, init) => {
  calls++;
  assert.equal(url, 'https://api.razorpay.com/v1/orders');
  assert.equal(init.headers.Authorization, 'Basic ' + Buffer.from('rzp_test_key:' + KEY_SECRET).toString('base64'));
  if (failNext) { failNext = false; return new Response(JSON.stringify({ error: { description: 'nope' } }), { status: 400 }); }
  const b = JSON.parse(init.body); const id = `order_${orders.size + 1}`;
  orders.set(id, b);
  return new Response(JSON.stringify({ id, amount: b.amount, currency: b.currency }), { status: 200 });
};
const razorpay = createRazorpay({ keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, fetchImpl });

const cfg0 = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...cfg0, database: `addabaaz_test_pay_${process.pid}_${Date.now().toString(36)}` };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-pay-'));
const catalog = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
const base = catalog.videos.find((v) => v.kind === 'episode');
catalog.videos.push({ ...base, id: 'prem', title: 'prem', kind: 'clip', episode: null, access: 'premium', source: { type: 'r2', key: 'premium/prem/video.mp4' } });
fs.writeFileSync(path.join(tmp, 'catalog.json'), JSON.stringify(catalog));
const fakeR2 = { configured: true, presignGet: (key) => `https://r2.test/${key}`, getText: async () => null };

let db, server, root;
const mkServer = async (payments) => { const app = createApp({ db, jwtSecret: 't', rate: false, catalogPath: path.join(tmp, 'catalog.json'), r2: fakeR2, payments }); const s = app.listen(0); await new Promise((r) => s.once('listening', r)); return { s, url: `http://127.0.0.1:${s.address().port}/api/v1` }; };
test.before(async () => {
  try { db = await createDb({ config, ensureDatabase: true }); } catch (e) { throw new Error(`MySQL is not reachable (${e.code || e.message}). Set TEST_DATABASE_URL.`); }
  await migrate(db);
  const a = await mkServer(razorpay); server = a.s; root = a.url;
});
test.after(async () => { server?.close(); if (db) { await db.dropDatabase(); await db.close(); } });

const call = async (method, p, body, token, url = root, raw) => {
  const r = await fetch(url + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw?.headers || {}) }, body: raw ? raw.body : body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: r.status, body: json };
};
const signup = async (email) => { const b = (await call('POST', '/auth/signup', { name: 'Pay Er', email, password: 'password123' })).body; await db.accounts.markVerified(b.user.id); return b; };
const stream = (token) => call('POST', '/videos/prem/stream', null, token);
const checkout = (token, planId = 'plus-monthly') => call('POST', '/payments/checkout', { planId }, token);
const goodSig = (o, p) => hmac(KEY_SECRET, `${o}|${p}`);
const webhook = (event, entity, secret = WEBHOOK_SECRET) => { const body = JSON.stringify({ event, payload: { payment: { entity } } }); return call('POST', '/payments/webhook', null, null, root, { body, headers: { 'X-Razorpay-Signature': hmac(secret, body) } }); };

test('provider selection: mock only outside production (or when explicitly allowed)', () => {
  assert.equal(paymentsFromEnv({}).provider, 'mock');
  assert.equal(paymentsFromEnv({ NODE_ENV: 'production' }).provider, 'none');
  assert.equal(paymentsFromEnv({ NODE_ENV: 'production', ALLOW_MOCK_PAYMENTS: 'true' }).provider, 'mock');
  assert.equal(paymentsFromEnv({ NODE_ENV: 'production', RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b' }).provider, 'razorpay');
});

test('no provider configured: checkout is refused, never silently granted', async () => {
  const off = await mkServer({ provider: 'none' });
  try {
    const u = await signup('none@example.com');
    const r = await call('POST', '/payments/checkout', { planId: 'plus-monthly' }, u.token, off.url); assert.equal(r.status, 501);
    assert.equal((await call('GET', '/plans', null, null, off.url)).body.payments.provider, 'none');
    assert.equal((await call('POST', '/videos/prem/stream', null, u.token, off.url)).status, 402);
  } finally { off.s.close(); }
});

test('Razorpay: free → order → verified payment → premium plays; keys stay private', async () => {
  const pl = (await call('GET', '/plans')).body; assert.deepEqual(pl.payments, { provider: 'razorpay', keyId: 'rzp_test_key' });
  assert.ok(!JSON.stringify(pl).includes(KEY_SECRET));
  const u = await signup('buyer@example.com');
  assert.equal((await stream(u.token)).status, 402);
  const c = await checkout(u.token); assert.equal(c.status, 201);
  assert.equal(c.body.provider, 'razorpay'); assert.equal(c.body.keyId, 'rzp_test_key'); assert.equal(c.body.currency, 'INR'); assert.equal(c.body.amount, orders.get(c.body.orderId).amount);
  assert.equal(c.body.amount % 100, 0); assert.ok(c.body.amount > 0); assert.equal(c.body.prefill.email, 'buyer@example.com');
  assert.equal(orders.get(c.body.orderId).notes.planId, 'plus-monthly');
  assert.equal((await stream(u.token)).status, 402, 'creating an order grants nothing');

  const bad = await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: 'pay_1', signature: 'f'.repeat(64) }, u.token); assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'invalid_signature');
  assert.equal((await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: 'pay_1', signature: goodSig(c.body.orderId, 'pay_OTHER') }, u.token)).status, 400);
  assert.equal((await stream(u.token)).status, 402, 'a bad signature grants nothing');

  const ok = await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: 'pay_1', signature: goodSig(c.body.orderId, 'pay_1') }, u.token);
  assert.equal(ok.status, 200); assert.equal(ok.body.subscription.planId, 'plus-monthly'); assert.notEqual(ok.body.subscription.demo, true);
  assert.equal((await stream(u.token)).status, 200);
  const exp1 = Date.parse(ok.body.subscription.expiresAt); assert.ok(Math.abs((exp1 - Date.now()) / 86_400_000 - 30) < 0.1);

  const again = await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: 'pay_1', signature: goodSig(c.body.orderId, 'pay_1') }, u.token);   // double submit / webhook race
  assert.equal(again.status, 200); assert.equal(Date.parse(again.body.subscription.expiresAt), exp1, 'replaying a payment never extends twice');

  const cancel = await call('DELETE', '/subscription', null, u.token); assert.equal(cancel.status, 409); assert.equal(cancel.body.error.code, 'not_cancellable');   // prepaid: no refunds by API
  assert.equal((await stream(u.token)).status, 200);

  const c2 = await checkout(u.token, 'plus-yearly');                                              // renewing stacks onto the remaining time
  await call('POST', '/payments/verify', { orderId: c2.body.orderId, paymentId: 'pay_2', signature: goodSig(c2.body.orderId, 'pay_2') }, u.token);
  const sub = (await call('GET', '/subscription', null, u.token)).body.subscription;
  assert.equal(sub.planId, 'plus-yearly'); assert.ok(Math.abs((Date.parse(sub.expiresAt) - exp1) / 86_400_000 - 365) < 0.1);

  await db.pool.query("UPDATE subscriptions SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE user_id = ?", [u.user.id]);
  assert.equal((await stream(u.token)).status, 402, 'expired → locked again');
});

test('Razorpay: orders are bound to their buyer', async () => {
  const a = await signup('alice@example.com'), b = await signup('mallory@example.com');
  const c = await checkout(a.token);
  const steal = await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: 'pay_x', signature: goodSig(c.body.orderId, 'pay_x') }, b.token);
  assert.equal(steal.status, 404); assert.equal((await stream(b.token)).status, 402);
  assert.equal((await call('POST', '/payments/verify', { orderId: 'order_unknown', paymentId: 'p', signature: 's' }, b.token)).status, 404);
  assert.equal((await call('POST', '/payments/verify', {}, b.token)).status, 404);
  assert.equal((await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: 'p', signature: 's' })).status, 401);
});

test('Razorpay: provider errors surface cleanly and create nothing', async () => {
  const u = await signup('err@example.com'); failNext = true;
  const r = await checkout(u.token); assert.equal(r.status, 502); assert.equal(r.body.error.code, 'provider_error');
  const [[{ n }]] = await db.pool.query('SELECT COUNT(*) n FROM payments WHERE user_id = ?', [u.user.id]); assert.equal(n, 0);
  assert.equal((await checkout(u.token, 'gold')).status, 400);
});

test('webhook: signed captures activate the plan even if the browser never returned', async () => {
  const u = await signup('closedtab@example.com');
  const c = await checkout(u.token);
  const entity = { id: 'pay_wh1', order_id: c.body.orderId, amount: c.body.amount, currency: 'INR', status: 'captured' };

  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity } } });
  assert.equal((await call('POST', '/payments/webhook', null, null, root, { body: raw, headers: { 'X-Razorpay-Signature': 'bad' } })).status, 400);
  assert.equal((await call('POST', '/payments/webhook', null, null, root, { body: raw })).status, 400);
  assert.equal((await webhook('payment.captured', entity, 'wrong-secret')).status, 400);
  assert.equal((await stream(u.token)).status, 402);

  assert.equal((await webhook('payment.captured', { ...entity, amount: 100 })).status, 200);       // valid signature, wrong amount → ignored
  assert.equal((await stream(u.token)).status, 402);
  assert.equal((await webhook('payment.authorized', { ...entity, status: 'authorized' })).status, 200);
  assert.equal((await stream(u.token)).status, 402);

  assert.equal((await webhook('payment.captured', entity)).status, 200);
  assert.equal((await stream(u.token)).status, 200);
  const e1 = (await call('GET', '/subscription', null, u.token)).body.subscription.expiresAt;
  assert.equal((await webhook('payment.captured', entity)).status, 200);                           // Razorpay retries
  await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: 'pay_wh1', signature: goodSig(c.body.orderId, 'pay_wh1') }, u.token);   // browser arrives late
  assert.equal((await call('GET', '/subscription', null, u.token)).body.subscription.expiresAt, e1);
  assert.equal((await webhook('payment.captured', { ...entity, id: 'pay_unknown', order_id: 'order_nope' })).status, 200);
});

test('account deletion keeps the payment record for accounting but drops the user link', async () => {
  const u = await signup('leaver@example.com'); const c = await checkout(u.token);
  await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: 'pay_leave', signature: goodSig(c.body.orderId, 'pay_leave') }, u.token);
  assert.equal((await call('DELETE', '/me', { password: 'password123' }, u.token)).status, 204);
  const [[row]] = await db.pool.query("SELECT user_id, status FROM payments WHERE provider_order_id = ?", [c.body.orderId]);
  assert.equal(row.user_id, null); assert.equal(row.status, 'paid');
});
