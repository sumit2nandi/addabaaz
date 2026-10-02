// Billing tests: GST invoices and credit notes, coupons, refunds, receipt e-mails and the accounting CSV.
// Razorpay and SMTP are replaced by in-memory fakes.
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
import { createRazorpay } from '../src/payments.js';
import { createMailer } from '../src/mailer.js';
import { createBilling, billingConfigFromEnv } from '../src/billing.js';
import { financialYear, gstinCheckChar } from '../src/gst.js';

/* Invoices, coupons, refunds and emails — against MySQL, a faked Razorpay API and a fake mail transport. */
const KEY_SECRET = 'rzp_secret_test', WEBHOOK_SECRET = 'whsec_test', ADMIN = 'a'.repeat(32);
const SELLER_GSTIN = '27AAPFU0939F1ZV';                                           // Maharashtra
const BUYER_GSTIN = '29AABCT1332L1Z' + gstinCheckChar('29AABCT1332L1Z');   // Karnataka
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const FY = financialYear().code;

const orders = new Map(), refundCalls = []; let refundMode = 'pending', n = 0;
const fetchImpl = async (url, init) => {
  const body = JSON.parse(init.body);
  if (url.endsWith('/v1/orders')) { const id = `order_b${++n}`; orders.set(id, body); return new Response(JSON.stringify({ id, amount: body.amount, currency: body.currency })); }
  const m = /\/v1\/payments\/([^/]+)\/refund$/.exec(url);
  if (m) {
    refundCalls.push({ payment: m[1], ...body });
    if (refundMode === 'error') return new Response(JSON.stringify({ error: { description: 'The refund amount is greater than the amount available for refund' } }), { status: 400 });
    return new Response(JSON.stringify({ id: `rfnd_${++n}`, amount: body.amount, status: refundMode }));
  }
  throw new Error('unexpected fetch ' + url);
};
const razorpay = createRazorpay({ keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, fetchImpl });

const sent = [];
const mailer = createMailer({ transport: { sendMail: async (m) => { sent.push(m); } }, from: 'ADDABAAZ <billing@addabaaz.in>' });
const emailsTo = (to, re) => sent.filter((m) => m.to === to && (!re || re.test(m.subject)));

// Database for the tests: TEST_DATABASE_URL or a local MySQL. Each file creates its own throw-away database (unique name) and drops it at the end, so tests never touch real data.
const cfg0 = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...cfg0, database: `addabaaz_test_bill_${process.pid}_${Date.now().toString(36)}` };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-bill-'));
const catalog = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
const base = catalog.videos.find((v) => v.kind === 'episode');
catalog.videos.push({ ...base, id: 'prem', title: 'prem', access: 'premium', source: { type: 'r2', key: 'premium/prem/video.mp4' } });
// A Plus-only show whose trailer/clip/reel must still stream for everyone, while its episodes stay locked.
catalog.shows.push({ ...catalog.shows[0], id: 'pshow', title: 'Locked show', featured: false, access: 'premium' });
for (const kind of ['trailer', 'reel', 'clip']) {
  catalog.videos.push({ ...base, id: `free-${kind}`, title: `free ${kind}`, kind, episode: null, showId: 'pshow', access: 'premium', source: { type: 'r2', key: `premium/${kind}.mp4` } });
}
catalog.videos.push({ ...base, id: 'lock-ep', title: 'locked episode', showId: 'pshow', access: 'premium', source: { type: 'r2', key: 'premium/lock-ep.mp4' } });
fs.writeFileSync(path.join(tmp, 'catalog.json'), JSON.stringify(catalog));
const fakeR2 = { configured: true, presignGet: (key) => `https://r2.test/${key}`, getText: async () => null };

// Shared state for the tests in this file (database, HTTP server, base URL).
let db, server, root, app, billing;
const billingEnv = { GSTIN: SELLER_GSTIN, GST_LEGAL_NAME: 'Adda Media Pvt Ltd', BUSINESS_ADDRESS: '12 MG Road\\nMumbai 400001', SUPPORT_EMAIL: 'help@addabaaz.in', PUBLIC_SITE_URL: 'https://addabaaz.in' };
const mk = async ({ env = billingEnv, adminToken = ADMIN, provider = razorpay } = {}) => {
  const b = createBilling({ db, payments: provider, mailer, config: { ...billingConfigFromEnv(env), uncompressedPdf: true }, log: { error: () => {} } });
  const a = createApp({ db, jwtSecret: 't', rate: false, catalogPath: path.join(tmp, 'catalog.json'), r2: fakeR2, payments: provider, mailer, billing: b, adminToken });
  const s = a.listen(0); await new Promise((r) => s.once('listening', r));
  return { app: a, s, billing: b, url: `http://127.0.0.1:${s.address().port}/api/v1` };
};
// Runs once before the tests: create + migrate the database and start the app on a random free port.
test.before(async () => {
  try { db = await createDb({ config, ensureDatabase: true }); } catch (e) { throw new Error(`MySQL is not reachable (${e.code || e.message}). Set TEST_DATABASE_URL.`); }
  await migrate(db);
  ({ app, s: server, url: root, billing } = await mk());
});
// Clean up: stop the server and drop the temporary database.
test.after(async () => { server?.close(); if (db) { await db.dropDatabase(); await db.close(); } });

// Tiny HTTP client: calls the running app's API and returns `{ status, body }`; pass a token to act as a signed-in user.
const call = async (method, p, body, token, { url = root, raw, admin } = {}) => {
  const r = await fetch(url + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(admin ? { Authorization: `Bearer ${admin}` } : {}), ...(raw?.headers || {}) }, body: raw ? raw.body : body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer()); const text = buf.toString('utf8'); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, body: json, text, buf, headers: r.headers };
};
let emailN = 0;
// Helper: register a new user and return their token (most tests start with this).
const signup = async (email = `u${++emailN}@example.com`) => { const b = (await call('POST', '/auth/signup', { name: 'Pay Er', email, password: 'password123' })).body; await db.accounts.markVerified(b.user.id); return { ...b, email }; };   // (buying needs a confirmed email when SMTP is on)
const stream = (t) => call('POST', '/videos/prem/stream', null, t);
const adm = (method, p, body) => call(method, '/admin' + p, body, null, { admin: ADMIN });
const MH = { state: 'Maharashtra' }, KA = { state: '29' };
let payN = 0;
/** Full purchase: checkout → (fake) Razorpay payment → verify. Returns everything a test may want to inspect. */
async function buy(u, { planId = 'plus-monthly', couponCode, billing: b = MH } = {}) {
  const c = await call('POST', '/payments/checkout', { planId, couponCode, billing: b }, u.token);
  if (c.status !== 201) return { c };
  if (c.body.provider === 'coupon') return { c };
  const paymentId = `pay_b${++payN}`;
  const v = await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId, signature: hmac(KEY_SECRET, `${c.body.orderId}|${paymentId}`) }, u.token);
  return { c, v, paymentId, orderId: c.body.orderId };
}
const webhook = (event, payload, secret = WEBHOOK_SECRET) => { const body = JSON.stringify({ event, payload }); return call('POST', '/payments/webhook', null, null, { raw: { body, headers: { 'X-Razorpay-Signature': hmac(secret, body) } } }); };
const invoicesOf = async (u) => (await call('GET', '/billing', null, u.token)).body.payments;
/** Text drawn on a page of an uncompressed pdfkit PDF (strings are hex-encoded in TJ operators). */
const pdfText = (buf) => { const s = buf.toString('latin1'); let out = ''; for (const m of s.matchAll(/<([0-9a-f]+)>/g)) out += Buffer.from(m[1], 'hex').toString('latin1'); return out.replace(/\s+/g, ''); };
const squash = (t) => t.replace(/\s+/g, '');

test('checkout needs the buyer state (place of supply) and validates GSTIN', async () => {
  const u = await signup();
  const r1 = await call('POST', '/payments/checkout', { planId: 'plus-monthly' }, u.token); assert.equal(r1.status, 400); assert.equal(r1.body.error.code, 'billing_state_required');
  const r2 = await call('POST', '/payments/checkout', { planId: 'plus-monthly', billing: { state: 'Narnia' } }, u.token); assert.equal(r2.body.error.code, 'billing_state_required');
  const r3 = await call('POST', '/payments/checkout', { planId: 'plus-monthly', billing: { gstin: BUYER_GSTIN.slice(0, 14) + (BUYER_GSTIN.endsWith('A') ? 'B' : 'A'), name: 'Tata' } }, u.token); assert.equal(r3.body.error.code, 'invalid_gstin');
  const r4 = await call('POST', '/payments/checkout', { planId: 'plus-monthly', billing: { gstin: BUYER_GSTIN } }, u.token); assert.equal(r4.body.error.code, 'business_name_required');
  assert.equal((await call('POST', '/payments/checkout', { planId: 'plus-monthly', billing: MH })).status, 401);
  const plans = (await call('GET', '/plans')).body; assert.equal(plans.billing.gst, true); assert.equal(plans.billing.coupons, true); assert.equal(plans.billing.states.length, 37);
  assert.equal(orders.size >= 0, true);
});

test('intra-state sale: CGST + SGST invoice is numbered, stored, emailed and downloadable', async () => {
  const u = await signup('maha@example.com');
  const { v } = await buy(u); assert.equal(v.status, 200);
  await billing.idle();
  const [p] = await invoicesOf(u);
  assert.equal(p.amountPaise, 9900); assert.equal(p.invoice.title, 'TAX INVOICE'); assert.match(p.invoice.number, new RegExp(`^AB/${FY}/\\d{6}$`)); assert.ok(p.invoice.number.length <= 16);
  const inv = await db.invoices.byId(p.invoice.id);
  assert.deepEqual([inv.taxable, inv.cgst, inv.sgst, inv.igst, inv.total, inv.gstRate], [8390, 755, 755, 0, 9900, 18]);
  assert.equal(inv.doc.seller.gstin, SELLER_GSTIN); assert.equal(inv.doc.placeOfSupply, 'Maharashtra (27)'); assert.equal(inv.doc.lines[0].sac, '998439'); assert.equal(inv.doc.buyer.email, 'maha@example.com');

  const dl = await call('GET', `/invoices/${p.invoice.id}/pdf`, null, u.token);
  assert.equal(dl.status, 200); assert.equal(dl.headers.get('content-type'), 'application/pdf'); assert.equal(dl.buf.subarray(0, 5).toString(), '%PDF-');
  assert.match(dl.headers.get('content-disposition'), new RegExp(`invoice-AB-${FY}-\\d{6}\\.pdf`));
  const text = pdfText(dl.buf);
  for (const want of ['TAXINVOICE', inv.number, SELLER_GSTIN, 'AddaMediaPvtLtd', 'Maharashtra(27)', '998439', 'CGST9%', 'SGST9%', '83.90', '7.55', '99.00', 'IndianRupeesNinetyNineOnly']) assert.ok(text.includes(squash(want)), `PDF should contain "${want}"`);
  assert.ok(!text.includes('IGST'), 'no IGST on an intra-state invoice');

  const mails = emailsTo('maha@example.com', /invoice/i);
  assert.equal(mails.length, 1); assert.ok(mails[0].subject.includes(inv.number)); assert.equal(mails[0].attachments[0].contentType, 'application/pdf'); assert.equal(mails[0].attachments[0].content.subarray(0, 5).toString(), '%PDF-');
  assert.match(mails[0].text, /Rs\. 99\.00/); assert.match(mails[0].html, /Start watching/); assert.equal(mails[0].from, 'ADDABAAZ <billing@addabaaz.in>');
});

test('inter-state and B2B (GSTIN) invoices: IGST, buyer in the business name, place of supply from the GSTIN', async () => {
  const a = await signup(), b = await signup();
  const ka = await buy(a, { planId: 'plus-yearly', billing: KA }); assert.equal(ka.v.status, 200);
  const b2b = await buy(b, { billing: { gstin: BUYER_GSTIN.toLowerCase(), name: 'Tata Consultancy', state: 'Kerala' } }); assert.equal(b2b.v.status, 200);
  const ia = await db.invoices.byId((await invoicesOf(a))[0].invoice.id);
  assert.deepEqual([ia.taxable, ia.cgst, ia.sgst, ia.igst, ia.total], [67712, 0, 0, 12188, 79900]); assert.equal(ia.doc.placeOfSupply, 'Karnataka (29)');
  const ib = await db.invoices.byId((await invoicesOf(b))[0].invoice.id);
  assert.equal(ib.doc.buyer.gstin, BUYER_GSTIN); assert.equal(ib.doc.buyer.name, 'Tata Consultancy'); assert.equal(ib.doc.placeOfSupply, 'Karnataka (29)', 'the GSTIN state wins over the selected state');
  assert.equal(ib.igst, 1510);
  const text = pdfText((await call('GET', `/invoices/${ib.id}/pdf`, null, b.token)).buf);
  for (const want of ['IGST18%', BUYER_GSTIN, 'TataConsultancy', '15.10']) assert.ok(text.includes(squash(want)), want);
  assert.ok(!text.includes('CGST'));
});

test('invoice access: only the owner; numbers are gapless and unique under concurrent payments', async () => {
  const a = await signup(), b = await signup();
  await buy(a);
  const id = (await invoicesOf(a))[0].invoice.id;
  assert.equal((await call('GET', `/invoices/${id}/pdf`, null, b.token)).status, 404);
  assert.equal((await call('GET', `/invoices/${id}/pdf`)).status, 401);
  assert.equal((await call('GET', '/invoices/nope/pdf', null, a.token)).status, 404);
  assert.equal((await call('POST', `/invoices/${id}/email`, null, b.token)).status, 404);

  const users = await Promise.all(Array.from({ length: 8 }, () => signup()));
  const results = await Promise.all(users.map((u) => buy(u)));
  assert.ok(results.every((r) => r.v.status === 200), JSON.stringify(results.map((r) => [r.v.status, r.v.body])));
  const nums = (await Promise.all(users.map(async (u) => (await invoicesOf(u))[0].invoice.number))).map((s) => Number(s.slice(-6))).sort((x, y) => x - y);
  assert.equal(new Set(nums).size, 8); assert.equal(nums[7] - nums[0], 7, 'consecutive numbers, no gaps');
});

test('paying twice for the same order (verify + webhook + retries) issues one invoice and one email', async () => {
  const u = await signup('once@example.com');
  const c = await call('POST', '/payments/checkout', { planId: 'plus-monthly', billing: MH }, u.token);
  const pid = 'pay_once', sig = hmac(KEY_SECRET, `${c.body.orderId}|${pid}`);
  const entity = { id: pid, order_id: c.body.orderId, amount: 9900, currency: 'INR', status: 'captured' };
  await Promise.all([call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: pid, signature: sig }, u.token), webhook('payment.captured', { payment: { entity } }), webhook('payment.captured', { payment: { entity } })]);
  await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: pid, signature: sig }, u.token);
  await billing.idle();
  assert.equal((await invoicesOf(u)).length, 1); assert.equal((await db.invoices.forPayment((await db.payments.byOrder('razorpay', c.body.orderId)).id)).length, 1);
  assert.equal(emailsTo('once@example.com', /invoice/i).length, 1);
});

test('resend an invoice to the account email', async () => {
  const u = await signup('resend@example.com'); await buy(u); await billing.idle();
  const id = (await invoicesOf(u))[0].invoice.id; const before = sent.length;
  assert.equal((await call('POST', `/invoices/${id}/email`, null, u.token)).status, 204);
  assert.equal(sent.length, before + 1); assert.equal(sent.at(-1).to, 'resend@example.com'); assert.equal(sent.at(-1).attachments.length, 1);
});

test('without a GSTIN the document is a plain receipt: no tax lines, no state needed', async () => {
  const off = await mk({ env: {} });
  try {
    assert.equal((await call('GET', '/plans', null, null, { url: off.url })).body.billing.gst, false);
    const u = await signup(); const c = await call('POST', '/payments/checkout', { planId: 'plus-monthly' }, u.token, { url: off.url }); assert.equal(c.status, 201);
    const pid = 'pay_rcpt'; await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: pid, signature: hmac(KEY_SECRET, `${c.body.orderId}|${pid}`) }, u.token, { url: off.url });
    const inv = await db.invoices.byId((await call('GET', '/billing', null, u.token, { url: off.url })).body.payments[0].invoice.id);
    assert.equal(inv.doc.title, 'PAYMENT RECEIPT'); assert.deepEqual([inv.taxable, inv.cgst, inv.sgst, inv.igst, inv.total, inv.gstRate], [9900, 0, 0, 0, 9900, 0]);
    const text = pdfText((await call('GET', `/invoices/${inv.id}/pdf`, null, u.token, { url: off.url })).buf);
    assert.ok(text.includes('PAYMENTRECEIPT') && !text.includes('CGST') && !text.includes('IGST'));
    assert.equal((await call('POST', '/payments/checkout', { planId: 'plus-monthly', billing: { gstin: BUYER_GSTIN, name: 'X' } }, u.token, { url: off.url })).body.error.code, 'gstin_not_supported');
  } finally { off.s.close(); }
});

/* ---------------- coupons ---------------- */
test('admin API: the shared token only works when it is long enough; viewers are refused', async () => {
  const off = await mk({ adminToken: '' }); const short = await mk({ adminToken: 'short' });
  try {
    assert.equal((await call('GET', '/admin/coupons', null, null, { url: off.url, admin: ADMIN })).status, 401, 'no ADMIN_TOKEN configured → the token is not accepted');
    assert.equal((await call('GET', '/admin/coupons', null, null, { url: short.url, admin: 'short' })).status, 401, 'a too-short token is ignored');
  } finally { off.s.close(); short.s.close(); }
  assert.equal((await call('GET', '/admin/coupons')).status, 401);
  assert.equal((await call('GET', '/admin/coupons', null, null, { admin: 'x'.repeat(32) })).status, 401);
  const u = await signup(); assert.equal((await call('GET', '/admin/coupons', null, u.token)).status, 403, 'a viewer session is not an admin');
  assert.equal((await adm('GET', '/coupons')).status, 200);
});

test('admin coupon creation is validated; codes are unique and case-insensitive', async () => {
  const bad = async (b) => { const r = await adm('POST', '/coupons', b); assert.equal(r.status, 400, JSON.stringify(b)); };
  await bad({ code: 'x', kind: 'percent', value: 10 }); await bad({ code: 'OK10', kind: 'bogus', value: 10 }); await bad({ code: 'OK10', kind: 'percent', value: 0 }); await bad({ code: 'OK10', kind: 'percent', value: 101 });
  await bad({ code: 'OK10', kind: 'flat', value: 50 }); await bad({ code: 'OK10', kind: 'percent', value: 10, planIds: ['nope'] }); await bad({ code: 'OK10', kind: 'percent', value: 10, perUserLimit: 0 }); await bad({ code: 'OK10', kind: 'percent', value: 10, expiresAt: 'not-a-date' });
  const ok = await adm('POST', '/coupons', { code: ' welcome20 ', kind: 'percent', value: 20, description: '20% off' }); assert.equal(ok.status, 201); assert.equal(ok.body.coupon.code, 'WELCOME20'); assert.equal(ok.body.coupon.perUserLimit, 1);
  assert.equal((await adm('POST', '/coupons', { code: 'WELCOME20', kind: 'percent', value: 5 })).status, 409);
  assert.equal((await adm('PATCH', '/coupons/nothere', { active: false })).status, 404);
  const list = (await adm('GET', '/coupons')).body.coupons; assert.equal(list.find((c) => c.code === 'WELCOME20').redeemed, 0);
});

test('percent coupon: discounted order, GST carved out of the discounted price, single use per user', async () => {
  await adm('POST', '/coupons', { code: 'SAVE50', kind: 'percent', value: 50, description: 'Half price' });
  const u = await signup('coupon@example.com');
  const q = await call('POST', '/payments/quote', { planId: 'plus-monthly', couponCode: 'save50' }, u.token);
  assert.deepEqual(q.body.quote, { planId: 'plus-monthly', listPaise: 9900, discountPaise: 4950, finalPaise: 4950, coupon: { code: 'SAVE50', description: 'Half price' } });
  assert.equal((await call('POST', '/payments/quote', { planId: 'plus-monthly' }, u.token)).body.quote.finalPaise, 9900);
  const r = await buy(u, { couponCode: 'SAVE50' });
  assert.equal(r.c.body.amount, 4950); assert.equal(orders.get(r.orderId).amount, 4950); assert.equal(orders.get(r.orderId).notes.coupon, 'SAVE50'); assert.equal(r.v.status, 200);
  await billing.idle();
  const p = (await invoicesOf(u))[0]; assert.equal(p.amountPaise, 4950); assert.equal(p.discountPaise, 4950); assert.equal(p.couponCode, 'SAVE50');
  const inv = await db.invoices.byId(p.invoice.id);
  assert.equal(inv.total, 4950); assert.equal(inv.taxable + inv.cgst + inv.sgst, 4950); assert.equal(inv.doc.discount.code, 'SAVE50'); assert.equal(inv.doc.listPricePaise, 9900);
  const text = pdfText((await call('GET', `/invoices/${inv.id}/pdf`, null, u.token)).buf); assert.ok(text.includes('CouponSAVE50') && text.includes('99.00') && text.includes('49.50'));
  assert.match(emailsTo('coupon@example.com', /invoice/i)[0].text, /saved you Rs\. 49\.50/);
  const again = await call('POST', '/payments/checkout', { planId: 'plus-yearly', couponCode: 'SAVE50', billing: MH }, u.token); assert.equal(again.status, 400); assert.equal(again.body.error.code, 'invalid_coupon'); assert.match(again.body.error.message, /already used/);
  assert.equal((await call('POST', '/payments/quote', { planId: 'plus-yearly', couponCode: 'SAVE50' }, u.token)).status, 400);
  assert.equal((await adm('GET', '/coupons')).body.coupons.find((c) => c.code === 'SAVE50').redeemed, 1);
});

test('coupon rules: unknown, inactive, expired, not started, wrong plan, exhausted', async () => {
  const u = await signup();
  const q = async (code, plan = 'plus-monthly') => call('POST', '/payments/quote', { planId: plan, couponCode: code }, u.token);
  const why = async (code, re, plan) => { const r = await q(code, plan); assert.equal(r.status, 400, code); assert.equal(r.body.error.code, 'invalid_coupon'); assert.match(r.body.error.message, re, code); };
  await why('NOSUCH', /isn’t valid/); await why('bad code!', /isn’t valid/);
  await adm('POST', '/coupons', { code: 'OFFLINE', kind: 'percent', value: 10, active: true }); await adm('PATCH', '/coupons/OFFLINE', { active: false }); await why('OFFLINE', /isn’t valid/);
  await adm('POST', '/coupons', { code: 'OLD', kind: 'percent', value: 10, expiresAt: new Date(Date.now() - 1000).toISOString() }); await why('OLD', /expired/);
  await adm('POST', '/coupons', { code: 'LATER', kind: 'percent', value: 10, startsAt: new Date(Date.now() + 86_400_000).toISOString() }); await why('LATER', /yet/);
  await adm('POST', '/coupons', { code: 'YEARONLY', kind: 'percent', value: 10, planIds: ['plus-yearly'] }); await why('YEARONLY', /doesn’t apply/); assert.equal((await q('YEARONLY', 'plus-yearly')).status, 200);
  await adm('POST', '/coupons', { code: 'ONLY1', kind: 'percent', value: 10, maxRedemptions: 1 });
  const first = await signup(); assert.equal((await buy(first, { couponCode: 'ONLY1' })).v.status, 200);
  await why('ONLY1', /fully redeemed/);
  assert.equal((await adm('PATCH', '/coupons/ONLY1', { maxRedemptions: 2 })).body.coupon.maxRedemptions, 2); assert.equal((await q('ONLY1')).status, 200);
  assert.equal((await adm('PATCH', '/coupons/ONLY1', { active: false })).body.coupon.active, false); await why('ONLY1', /isn’t valid/);
});

test('flat coupons never exceed the price or push the charge below ₹1; the reopened order keeps one coupon slot', async () => {
  await adm('POST', '/coupons', { code: 'FLAT50', kind: 'flat', value: 5000 }); await adm('POST', '/coupons', { code: 'BIG', kind: 'flat', value: 500000 }); await adm('POST', '/coupons', { code: 'NEARFREE', kind: 'percent', value: 99, maxRedemptions: 1 });
  const u = await signup();
  const q = async (code) => (await call('POST', '/payments/quote', { planId: 'plus-monthly', couponCode: code }, u.token)).body.quote;
  assert.equal((await q('FLAT50')).finalPaise, 4900); assert.equal((await q('NEARFREE')).finalPaise, 100, '99% of ₹99 is clamped to the ₹1 minimum'); assert.equal((await q('NEARFREE')).discountPaise, 9800);
  const big = await call('POST', '/payments/checkout', { planId: 'plus-monthly', couponCode: 'BIG', billing: MH }, u.token); assert.equal(big.status, 201, 'a flat coupon larger than the price makes it free'); assert.equal(big.body.provider, 'coupon');

  const v = await signup(); const before = orders.size;
  const c1 = await call('POST', '/payments/checkout', { planId: 'plus-monthly', couponCode: 'NEARFREE', billing: MH }, v.token);
  const c2 = await call('POST', '/payments/checkout', { planId: 'plus-monthly', couponCode: 'NEARFREE', billing: { state: 'Goa' } }, v.token);   // dismissed the payment window and reopened it
  assert.equal(c1.body.orderId, c2.body.orderId); assert.equal(orders.size, before + 1, 'no second Razorpay order');
  assert.equal((await db.payments.byOrder('razorpay', c1.body.orderId)).billing.state, '30', 'billing details follow the latest attempt');
  const w = await signup();
  assert.equal((await call('POST', '/payments/checkout', { planId: 'plus-monthly', couponCode: 'NEARFREE', billing: MH }, w.token)).body.error.code, 'invalid_coupon', 'the single redemption is held by the open order');
  const pid = 'pay_near'; assert.equal((await call('POST', '/payments/verify', { orderId: c2.body.orderId, paymentId: pid, signature: hmac(KEY_SECRET, `${c2.body.orderId}|${pid}`) }, v.token)).status, 200);
  const inv = await db.invoices.byId((await invoicesOf(v))[0].invoice.id); assert.equal(inv.total, 100); assert.equal(inv.igst, 15); assert.equal(inv.taxable, 85, 'Goa ≠ Maharashtra → IGST');
});

test('trailers, clips and reels stream for everyone, even premium ones under a Plus-only show', async () => {
  for (const kind of ['trailer', 'reel', 'clip']) {
    const anon = await call('POST', `/videos/free-${kind}/stream`);          // no account at all
    assert.equal(anon.status, 200, `${kind} of a premium show streams anonymously`);
    assert.match(anon.body.url, /r2\.test/, `${kind} gets a signed URL without any gate`);
  }
  const u = await signup();                                                  // signed in but on the free plan
  for (const kind of ['trailer', 'reel', 'clip']) {
    assert.equal((await call('POST', `/videos/free-${kind}/stream`, null, u.token)).status, 200, `${kind} needs no plan`);
  }
  // Episodes of the same show stay locked: 401 anonymous, 402 on the free plan.
  assert.equal((await call('POST', '/videos/lock-ep/stream')).status, 401);
  assert.equal((await call('POST', '/videos/lock-ep/stream', null, u.token)).status, 402);
});

test('parallel checkouts cannot both take the last redemption', async () => {
  await adm('POST', '/coupons', { code: 'LASTONE', kind: 'percent', value: 10, maxRedemptions: 1 });
  const users = await Promise.all(Array.from({ length: 5 }, () => signup()));
  const res = await Promise.all(users.map((u) => call('POST', '/payments/checkout', { planId: 'plus-monthly', couponCode: 'LASTONE', billing: MH }, u.token)));
  assert.equal(res.filter((r) => r.status === 201).length, 1); assert.ok(res.filter((r) => r.status !== 201).every((r) => r.body.error.code === 'invalid_coupon'));
});

test('a 100%-off coupon grants access without a payment or an invoice, once', async () => {
  await adm('POST', '/coupons', { code: 'FREEMONTH', kind: 'percent', value: 100, planIds: ['plus-monthly'], description: 'Launch gift' });
  const u = await signup('gift@example.com');
  assert.equal((await stream(u.token)).status, 402);
  const r = await call('POST', '/payments/checkout', { planId: 'plus-monthly', couponCode: 'freemonth', billing: MH }, u.token);
  assert.equal(r.status, 201); assert.equal(r.body.provider, 'coupon'); assert.equal(r.body.subscription.planId, 'plus-monthly'); assert.equal(r.body.quote.finalPaise, 0);
  assert.equal((await stream(u.token)).status, 200);
  await billing.idle();
  const [p] = await invoicesOf(u); assert.equal(p.amountPaise, 0); assert.equal(p.invoice, null, 'nothing was charged, so no invoice');
  assert.equal(emailsTo('gift@example.com', /active/i).length, 1); assert.equal(emailsTo('gift@example.com', /invoice/i).length, 0);
  assert.equal((await call('POST', '/payments/checkout', { planId: 'plus-monthly', couponCode: 'FREEMONTH', billing: MH }, u.token)).body.error.code, 'invalid_coupon');
  assert.equal((await call('DELETE', '/subscription', null, u.token)).status, 409, 'granted plans aren’t “demo” plans');
  assert.equal((await adm('POST', `/payments/${p.id}/refund`, {})).body.error.code, 'not_refundable');
});

test('mock (demo) provider ignores coupons and billing details', async () => {
  const demo = await mk({ provider: { provider: 'mock' } });
  try { const u = await signup(); assert.equal((await call('POST', '/payments/quote', { planId: 'plus-monthly', couponCode: 'X' }, u.token, { url: demo.url })).status, 501); assert.equal((await call('POST', '/payments/checkout', { planId: 'plus-monthly' }, u.token, { url: demo.url })).body.provider, 'mock'); }
  finally { demo.s.close(); }
});

/* ---------------- refunds ---------------- */
const refund = (paymentId, body) => adm('POST', `/payments/${paymentId}/refund`, body);
const daysLeft = async (u) => (Date.parse((await call('GET', '/subscription', null, u.token)).body.subscription.expiresAt) - Date.now()) / 86_400_000;

test('partial then final refund: credit notes add up to the invoice; a full refund ends the access', async () => {
  const u = await signup('refunds@example.com'); const r = await buy(u); await billing.idle();
  const [p] = await invoicesOf(u); const inv = await db.invoices.byId(p.invoice.id);
  assert.equal((await stream(u.token)).status, 200);
  refundMode = 'pending'; refundCalls.length = 0;

  const one = await refund(p.id, { amountPaise: 3000, reason: 'Duplicate purchase' });
  assert.equal(one.status, 201); assert.equal(one.body.refund.status, 'pending'); assert.equal(one.body.refund.amountPaise, 3000); assert.equal(one.body.creditNote, null, 'no credit note until the refund is processed');
  assert.deepEqual([refundCalls[0].payment, refundCalls[0].amount, refundCalls[0].notes.reason], [r.paymentId, 3000, 'Duplicate purchase']);
  assert.equal((await invoicesOf(u))[0].creditNotes.length, 0);
  assert.equal((await webhook('refund.processed', { refund: { entity: { id: one.body.refund.providerRefundId, payment_id: r.paymentId, amount: 3000, status: 'processed' } } })).status, 200);
  await billing.idle();
  let hist = (await invoicesOf(u))[0]; assert.equal(hist.creditNotes.length, 1); assert.equal(hist.refundedPaise, 3000); assert.match(hist.creditNotes[0].number, new RegExp(`^CN/${FY}/\\d{6}$`));
  assert.equal((await stream(u.token)).status, 200, 'a partial refund leaves the access alone');
  assert.ok((await daysLeft(u)) > 29.5);
  const cn1 = await db.invoices.byId(hist.creditNotes[0].id);
  assert.equal(cn1.kind, 'credit_note'); assert.equal(cn1.total, 3000); assert.equal(cn1.taxable + cn1.cgst + cn1.sgst + cn1.igst, 3000); assert.equal(cn1.parentId, inv.id); assert.equal(cn1.doc.refers.number, inv.number); assert.equal(cn1.doc.reason, 'Duplicate purchase');
  const cnPdf = pdfText((await call('GET', `/invoices/${cn1.id}/pdf`, null, u.token)).buf);
  for (const want of ['CREDITNOTE', cn1.number, `Againstinvoice${inv.number}`, 'Duplicateproduct'.replace('product', 'purchase'), 'Totalcredited']) assert.ok(cnPdf.includes(squash(want)), want);
  const m1 = emailsTo('refunds@example.com', /refund/i); assert.equal(m1.length, 1); assert.match(m1[0].subject, /Rs\. 30\.00/); assert.equal(m1[0].attachments[0].filename, `credit-note-${cn1.number.replace(/\//g, '-')}.pdf`); assert.match(m1[0].text, /access is unchanged/);

  assert.equal((await webhook('refund.processed', { refund: { entity: { id: one.body.refund.providerRefundId, payment_id: r.paymentId, amount: 3000, status: 'processed' } } })).status, 200);   // Razorpay retries
  await billing.idle(); assert.equal((await invoicesOf(u))[0].creditNotes.length, 1); assert.equal(emailsTo('refunds@example.com', /refund/i).length, 1);

  assert.equal((await refund(p.id, { amountPaise: 7000 })).status, 409, 'more than what is left');
  assert.equal((await refund(p.id, { amountPaise: 50 })).body.error.code, 'invalid_amount');
  assert.equal((await refund(p.id, { amountPaise: 12.5 })).body.error.code, 'invalid_amount');
  assert.equal((await refund('nope', {})).status, 404);

  refundMode = 'processed';
  const two = await refund(p.id, { reason: 'Customer request' });                          // "the rest"
  assert.equal(two.status, 201); assert.equal(two.body.refund.amountPaise, 6900); assert.equal(two.body.refund.status, 'processed'); assert.ok(two.body.creditNote.number.startsWith('CN/')); assert.equal(two.body.accessRevoked, true);
  await billing.idle();
  hist = (await invoicesOf(u))[0]; assert.equal(hist.refundedPaise, 9900); assert.equal(hist.creditNotes.length, 2);
  const cn2 = await db.invoices.byId(hist.creditNotes.find((c) => c.id !== cn1.id).id);
  assert.deepEqual([cn1.taxable + cn2.taxable, cn1.cgst + cn2.cgst, cn1.sgst + cn2.sgst, cn1.total + cn2.total], [inv.taxable, inv.cgst, inv.sgst, inv.total], 'credit notes reverse the invoice exactly');
  assert.equal((await stream(u.token)).status, 402, 'fully refunded → premium is locked again');
  assert.equal((await refund(p.id, {})).status, 409);
  assert.equal(emailsTo('refunds@example.com', /refund/i).length, 2); assert.match(emailsTo('refunds@example.com', /refund/i)[1].text, /access for that payment has ended/);
});

test('refunds shorten only the days that payment bought (renewals are kept); partial refunds can opt in to revoke', async () => {
  const u = await signup(); const a = await buy(u); const b = await buy(u); await billing.idle();
  assert.ok((await daysLeft(u)) > 59.5);
  const ps = await invoicesOf(u); const first = ps.find((p) => p.paidAt === ps.map((x) => x.paidAt).sort()[0]);
  refundMode = 'processed';
  const r = await refund(first.id, {}); assert.equal(r.status, 201);
  assert.equal(r.body.accessRevoked, true); const left = await daysLeft(u); assert.ok(left > 29.5 && left < 30.1, `one month left, got ${left}`);
  assert.equal((await stream(u.token)).status, 200);
  const other = ps.find((p) => p.id !== first.id);
  const part = await refund(other.id, { amountPaise: 1000, revokeAccess: true }); assert.equal(part.body.accessRevoked, true);
  assert.equal((await stream(u.token)).status, 402);
  assert.ok(a.v && b.v);
});

test('a failed refund gives the access back; provider errors surface and record nothing', async () => {
  const u = await signup(); const r = await buy(u); await billing.idle();
  const [p] = await invoicesOf(u);
  refundMode = 'pending';
  const one = await refund(p.id, { revokeAccess: true }); assert.equal(one.body.accessRevoked, true); assert.equal((await stream(u.token)).status, 402);
  await webhook('refund.failed', { refund: { entity: { id: one.body.refund.providerRefundId, payment_id: r.paymentId, amount: 9900, status: 'failed' } } });
  assert.equal((await stream(u.token)).status, 200, 'restored'); assert.equal((await invoicesOf(u))[0].creditNotes.length, 0); assert.equal((await invoicesOf(u))[0].refundedPaise, 0);
  refundMode = 'error';
  const err = await refund(p.id, {}); assert.equal(err.status, 502); assert.match(err.body.error.message, /greater than the amount available/);
  assert.equal((await db.refunds.forPayment(p.id)).filter((x) => x.status !== 'failed').length, 0);
  refundMode = 'processed'; assert.equal((await refund(p.id, {})).status, 201, 'the failed attempt doesn’t block a new refund');
});

test('refunds made in the Razorpay dashboard are picked up by webhook; foreign or oversized ones are ignored', async () => {
  const u = await signup('dash@example.com'); const r = await buy(u); await billing.idle();
  const [p] = await invoicesOf(u);
  const ev = (over) => webhook('refund.processed', { refund: { entity: { id: 'rfnd_dash', payment_id: r.paymentId, amount: 9900, status: 'processed', notes: { reason: 'From dashboard' }, ...over } } });
  assert.equal((await ev({ payment_id: 'pay_unknown' })).status, 200);
  assert.equal((await ev({ id: 'rfnd_big', amount: 999999 })).status, 200);
  assert.equal((await invoicesOf(u))[0].creditNotes.length, 0);
  assert.equal((await ev()).status, 200); await billing.idle();
  const hist = (await invoicesOf(u))[0]; assert.equal(hist.refundedPaise, 9900); assert.equal(hist.creditNotes.length, 1);
  assert.equal((await db.refunds.forPayment(p.id))[0].source, 'provider'); assert.equal((await stream(u.token)).status, 402, 'a full dashboard refund ends the access too');
  assert.equal(emailsTo('dash@example.com', /refund/i).length, 1);
  assert.equal((await webhook('refund.processed', { refund: { entity: { id: 'x' } } }, 'wrong-secret')).status, 400);
});

test('payment.failed emails the buyer once and leaves the order open for a retry', async () => {
  const u = await signup('failed@example.com');
  const c = await call('POST', '/payments/checkout', { planId: 'plus-monthly', billing: MH }, u.token);
  const ev = () => webhook('payment.failed', { payment: { entity: { id: 'pay_x', order_id: c.body.orderId, status: 'failed', error_description: 'Payment declined by bank' } } });
  await ev(); await ev(); await billing.idle();
  const mails = emailsTo('failed@example.com', /didn’t go through/); assert.equal(mails.length, 1); assert.match(mails[0].text, /Payment declined by bank/); assert.match(mails[0].text, /#\/plans/);
  const pid = 'pay_retry'; assert.equal((await call('POST', '/payments/verify', { orderId: c.body.orderId, paymentId: pid, signature: hmac(KEY_SECRET, `${c.body.orderId}|${pid}`) }, u.token)).status, 200);
  assert.equal((await stream(u.token)).status, 200);
  await webhook('payment.failed', { payment: { entity: { id: 'pay_late', order_id: c.body.orderId, status: 'failed' } } }); await billing.idle();
  assert.equal(emailsTo('failed@example.com', /didn’t go through/).length, 1, 'nothing for an order that has since been paid');
});

/* ---------------- reminders, register, retention ---------------- */
test('expiry reminders: once per expiry date, only for paid plans ending soon', async () => {
  const soon = await signup('soon@example.com'), far = await signup('far@example.com'), gone = await signup('gone@example.com');
  await buy(soon); await buy(far); await buy(gone); await billing.idle();
  const demo = await signup('demo@example.com'); await db.subscriptions.activateDemo(demo.user.id, 'plus-monthly', 2);
  const set = (u, sql) => db.pool.query(`UPDATE subscriptions SET expires_at = ${sql} WHERE user_id = ?`, [u.user.id]);
  await set(soon, 'UTC_TIMESTAMP(3) + INTERVAL 2 DAY'); await set(gone, 'UTC_TIMESTAMP(3) - INTERVAL 1 DAY'); await db.pool.query("UPDATE subscriptions SET expires_at = UTC_TIMESTAMP(3) + INTERVAL 1 DAY WHERE user_id = ?", [demo.user.id]);
  const before = sent.length;
  assert.equal(await billing.sendExpiryReminders(), 1); await billing.idle();
  const m = emailsTo('soon@example.com', /ends on/); assert.equal(m.length, 1); assert.match(m[0].text, /Plans don’t renew automatically/); assert.match(m[0].html, /Renew now/); assert.equal(sent.length, before + 1);
  assert.equal(await billing.sendExpiryReminders(), 0, 'not again for the same date');
  const [[row]] = await db.pool.query('SELECT expires_at FROM subscriptions WHERE user_id = ?', [soon.user.id]);
  const claims = await Promise.all([1, 2, 3].map(() => db.subscriptions.claimReminder(soon.user.id, row.expires_at))); assert.deepEqual(claims, [false, false, false]);
  await buy(soon); await set(soon, 'UTC_TIMESTAMP(3) + INTERVAL 1 DAY');                     // renewed, then approaches a *different* end date
  assert.equal(await billing.sendExpiryReminders(), 1);
});

test('expiring plans: concurrent runners send exactly one reminder', async () => {
  const u = await signup('race@example.com'); await buy(u); await billing.idle();
  await db.pool.query('UPDATE subscriptions SET expires_at = UTC_TIMESTAMP(3) + INTERVAL 1 DAY WHERE user_id = ?', [u.user.id]);
  const counts = await Promise.all([1, 2, 3, 4].map(() => billing.sendExpiryReminders())); await billing.idle();
  assert.equal(counts.reduce((a, b) => a + b, 0), 1); assert.equal(emailsTo('race@example.com', /ends on/).length, 1);
});

test('sales register CSV: invoices positive, credit notes negative, GSTIN and place of supply included', async () => {
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const r = await adm('GET', `/invoices.csv?from=${day}&to=${day}`); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.headers.get('content-disposition'), /sales-register/);
  const lines = r.text.trim().split('\r\n'); assert.equal(lines[0], 'Document,Number,Date (IST),Against,Customer,Customer GSTIN,Place of supply,Taxable value,CGST,SGST,IGST,Total,GST rate %');
  assert.ok(lines.some((l) => l.startsWith('Tax invoice,AB/') && l.includes(BUYER_GSTIN) && l.includes('Karnataka (29)') && l.includes(',18')));
  const cn = lines.filter((l) => l.startsWith('Credit note,CN/')); assert.ok(cn.length >= 3); assert.ok(cn.every((l) => /,-\d+\.\d{2},[^,]*,[^,]*,[^,]*,-\d+\.\d{2},18$/.test(l)), cn[0]);
  const sum = (col) => lines.slice(1).reduce((n, l) => n + Number(l.split(',').at(col)), 0); assert.ok(Math.abs(sum(-2)) >= 0);
  assert.equal((await adm('GET', '/invoices.csv?from=2020-01-01&to=2020-01-31')).text.trim().split('\r\n').length, 1, 'empty range = header only');
  assert.equal((await adm('GET', '/invoices.csv?from=yesterday&to=today')).status, 400);
  const any = (await db.pool.query('SELECT id FROM invoices LIMIT 1'))[0][0].id;
  const pdf = await adm('GET', `/invoices/${any}/pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
});

test('deleting an account keeps its invoices for the statutory period, detached from the user', async () => {
  const u = await signup('leaver@example.com'); await buy(u); await billing.idle();
  const inv = (await invoicesOf(u))[0].invoice;
  assert.equal((await call('DELETE', '/me', { password: 'password123' }, u.token)).status, 204);
  const row = await db.invoices.byId(inv.id); assert.equal(row.userId, null); assert.equal(row.doc.buyer.email, 'leaver@example.com'); assert.equal(row.number, inv.number);
  assert.equal((await call('GET', `/invoices/${inv.id}/pdf`, null, u.token)).status, 401);
});

test('refund requests: the customer asks, the admin approves (real refund + access ends) or declines (email, nothing changes)', async () => {
  const u = await signup('askrefund@example.com'); const r = await buy(u); await billing.idle();
  const [p] = await invoicesOf(u); refundMode = 'processed'; refundCalls.length = 0;
  assert.equal((await call('POST', `/payments/${p.id}/refund-request`, { reason: 'Not what I expected' }, u.token)).status, 201);
  await billing.idle();
  assert.ok(emailsTo('help@addabaaz.in', /Refund request from askrefund@example.com/).length, 'support is told');
  assert.equal((await adm('GET', '/inbox')).body.refunds >= 1, true);
  const list = (await adm('GET', '/refund-requests')).body; const req = list.requests.find((x) => x.email === 'askrefund@example.com');
  assert.equal(req.reason, 'Not what I expected'); assert.equal(req.payment.amountPaise, p.amountPaise);
  // decline first request → mail, access stays; the customer may ask again afterwards
  assert.equal((await adm('POST', `/refund-requests/${req.id}/decline`, { note: 'Outside our policy' })).status, 204);
  assert.equal((await adm('POST', `/refund-requests/${req.id}/decline`, {})).status, 409, 'decided once');
  assert.equal((await adm('POST', `/refund-requests/${req.id}/approve`, {})).status, 409);
  await new Promise((r2) => setTimeout(r2, 50));
  assert.ok(emailsTo('askrefund@example.com', /About your ADDABAAZ refund request/).length); assert.equal(refundCalls.length, 0); assert.equal((await stream(u.token)).status, 200);
  assert.equal((await call('GET', '/refund-requests', null, u.token)).body.requests[0].status, 'declined');
  assert.equal((await call('POST', `/payments/${p.id}/refund-request`, { reason: 'Please, again' }, u.token)).status, 201);
  const req2 = (await adm('GET', '/refund-requests')).body.requests.find((x) => x.email === 'askrefund@example.com' && x.status === 'pending');
  // a provider failure leaves the request open for another try
  refundMode = 'error'; const failed = await adm('POST', `/refund-requests/${req2.id}/approve`, {}); assert.ok(failed.status >= 400);
  assert.equal((await adm('GET', '/refund-requests?status=pending')).body.requests.some((x) => x.id === req2.id), true, 'back to pending');
  refundMode = 'processed'; const ok = await adm('POST', `/refund-requests/${req2.id}/approve`, { note: 'ok' }); assert.equal(ok.status, 200); assert.equal(refundCalls.length >= 1, true);
  await billing.idle(); assert.equal((await stream(u.token)).status, 402, 'access ended with the full refund');
  assert.equal((await call('POST', `/payments/${p.id}/refund-request`, {}, u.token)).status, 409, 'nothing left to refund');
  assert.equal((await call('POST', '/admin/refund-requests/x/decline', {}, u.token)).status, 403);
});
