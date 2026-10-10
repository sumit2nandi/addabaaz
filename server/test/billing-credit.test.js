// Checkout with promotional credit: the money path.
//
// The promo rules are tested in promos.test.js and the accounting maths in billing.test.js; this file checks
// the seam between them without a database — that billing.checkout spends credit only when the buyer asked,
// grants the plan with no gateway order when credit covers the price, records `credit_applied_paise` on the
// order, keeps the amount that goes to Razorpay correct, and gives the credit back when the order is
// abandoned. Razorpay, e-mail and the data layer are all in-memory fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilling, billingConfigFromEnv } from '../src/billing.js';
import { createPromos, promosConfigFromEnv } from '../src/promos.js';
import { fakeCreditDb } from './helpers/credit-db.js';
import { PLANS } from '../src/plans.js';

const HOUR = 3600_000;

/** A database with the payment/subscription surface `createBilling` uses, on top of the credit fake. */
function checkoutDb() {
  const db = fakeCreditDb();
  const payments = new Map(), subscriptions = new Map(), invoices = [];
  const planDays = (id) => PLANS.find((p) => p.id === id)?.days || 30;
  db.payments = {
    async create(p) {
      const row = { ...p, status: 'created', createdAt: new Date().toISOString(), invoiceId: null };
      payments.set(row.id, row); return row;
    },
    async byId(id) { return payments.get(String(id)) || null; },
    async openOrder({ userId, planId, amountPaise, couponCode = null, provider }) {
      return [...payments.values()].find((p) => p.userId === userId && p.planId === planId && p.provider === provider && p.amountPaise === amountPaise && p.status === 'created' && (p.couponCode || null) === (couponCode || null)) || null;
    },
    async setBilling(id, billing) { payments.get(id).billing = billing; },
    async settle(payment, providerPaymentId, days, { invoice = null } = {}) {
      const p = payments.get(payment.id);
      if (!p || p.status !== 'created') return { applied: false, invoice: null };
      p.status = 'paid'; p.paymentId = providerPaymentId; p.paidAt = new Date().toISOString();
      if (p.userId) await db.subscriptions.extend(p.userId, { planId: p.planId, days, provider: p.provider });
      let issued = null;
      if (invoice) { issued = { id: `inv_${invoices.length + 1}`, number: `AB/2627/${String(invoices.length + 1).padStart(6, '0')}`, issuedAt: p.paidAt, total: p.amountPaise, kind: 'invoice', ...invoice(p) }; invoices.push(issued); }
      return { applied: true, invoice: issued };
    },
    async listForUser(userId) { return [...payments.values()].filter((p) => p.userId === userId && p.status === 'paid'); },
  };
  db.subscriptions = {
    async extend(userId, { planId, days }) {
      const prev = subscriptions.get(userId);
      const from = prev && Date.parse(prev.expiresAt) > Date.now() ? Date.parse(prev.expiresAt) : Date.now();
      subscriptions.set(userId, { planId, status: 'active', demo: false, expiresAt: new Date(from + days * 86_400_000).toISOString() });
    },
    async get(userId) { return subscriptions.get(userId) || { planId: 'free', status: 'active', expiresAt: null }; },
  };
  db.coupons = { async get() { return null; } };
  db.invoices = { async ensureCounter() {}, async issue(_t, row) { return row; } };
  db.__payments = payments;
  return db;
}

const sent = [];
const mailer = { provider: 'smtp', async send(m) { sent.push(m); return { sent: true }; } };

function setup() {
  const db = checkoutDb();
  const gatewayCalls = [];
  const gateway = {
    provider: 'razorpay', keyId: 'rzp_test_key',
    // Same shape as payments.js returns (orderId + amountPaise), so billing's arithmetic is really exercised.
    async createOrder({ amountPaise, receipt, notes }) { gatewayCalls.push({ amountPaise, receipt, notes }); return { orderId: `order_${gatewayCalls.length}`, amountPaise, currency: 'INR' }; },
  };
  const promos = createPromos({ db, config: promosConfigFromEnv({}), mailer, siteUrl: 'https://addabaaz.in' });
  const billing = createBilling({ db, payments: gateway, mailer, config: billingConfigFromEnv({ PUBLIC_SITE_URL: 'https://addabaaz.in' }), promos });
  const user = db.addUser('u1', { name: 'Asha' });
  return { db, promos, billing, user, gatewayCalls, sent };
}

test('credit that covers the whole price activates the plan with no gateway order', async () => {
  const { db, promos, billing, user, gatewayCalls } = setup();
  await promos.onSignup({ user });
  assert.equal(await db.credits.balance('u1'), 10000);

  const out = await billing.checkout({ user, planId: 'plus-monthly', billing: {}, useCredit: true });
  assert.equal(out.provider, 'credit');
  assert.equal(out.payablePaise, 0);
  assert.equal(out.creditPaise, 9900, 'only the ₹99 the plan costs is taken');
  assert.equal(out.quote.creditPaise, 9900);
  assert.equal(out.quote.finalPaise, 9900);
  assert.equal(gatewayCalls.length, 0, 'nothing was sent to Razorpay');
  assert.equal(out.subscription.planId, 'plus-monthly', 'the plan is active straight away');
  assert.equal(await db.credits.balance('u1'), 100, 'the rest of the bonus stays in the wallet');
  assert.equal((await db.credits.summary('u1')).heldPaise, 0, 'nothing is held once the credit has paid');

  const [pay] = [...db.__payments.values()];
  assert.equal(pay.amountPaise, 0);
  assert.equal(pay.creditAppliedPaise, 9900, 'the order records what paid for it');
  assert.equal(pay.provider, 'credit');
  assert.equal((await db.credits.ledger('u1')).items.find((r) => r.kind === 'spend').status, 'available', 'spent for good, not held');
  await billing.idle();                                   // e-mails are best-effort and tracked, not awaited by checkout
  assert.equal(sent.length >= 1, true, 'the viewer is e-mailed a receipt');
  const invoice = sent.find((m) => m.attachments?.length);
  assert.ok(invoice, 'the receipt carries the invoice PDF');
});

test('credit is never spent unless the buyer asks for it', async () => {
  const { db, promos, billing, user, gatewayCalls } = setup();
  await promos.onSignup({ user });

  const quote = await billing.quote(user.id, 'plus-monthly');
  assert.equal('creditPaise' in billing.quoteView(quote), false, 'a plain quote keeps its old shape');

  const out = await billing.checkout({ user, planId: 'plus-monthly', billing: {} });
  assert.equal(out.provider, 'razorpay');
  assert.equal(out.amount, 9900, 'the full price goes to the gateway');
  assert.equal(out.creditPaise, 0);
  assert.equal(await db.credits.balance('u1'), 10000, 'the bonus is untouched');
  assert.equal(gatewayCalls.length, 1);
  assert.equal([...db.__payments.values()][0].creditAppliedPaise, 0);
});

test('credit pays part of a bigger order and is held until the payment is settled', async () => {
  const { db, promos, billing, user, gatewayCalls } = setup();
  await promos.onSignup({ user });

  const out = await billing.checkout({ user, planId: 'plus-yearly', billing: {}, useCredit: true });
  assert.equal(out.provider, 'razorpay');
  assert.equal(out.payablePaise, 79900 - 10000);
  assert.equal(out.amount, 69900, 'Razorpay is asked for the difference');
  assert.equal(gatewayCalls.at(-1).notes.creditPaise, '10000', 'the order notes explain the amount');
  assert.equal(await db.credits.balance('u1'), 0, 'held, so it cannot be spent twice');
  assert.equal((await db.credits.summary('u1')).heldPaise, 10000, 'the viewer is told it is held, not lost');
  const pay = [...db.__payments.values()][0];

  const r = await billing.settle(pay, 'pay_1');
  assert.equal(r.applied, true);
  assert.equal(r.invoice.doc.credit.paise, 10000, 'the invoice shows the credit');
  assert.equal(r.invoice.doc.paymentRef.provider, 'Razorpay');
  assert.equal((await db.credits.summary('u1')).heldPaise, 0, 'settled');
  assert.equal((await db.credits.ledger('u1')).items.find((x) => x.kind === 'spend').status, 'available');
  assert.equal(await db.credits.balance('u1'), 0);

  // Settling again (the webhook and the browser both report a payment) must not touch the credit twice.
  await billing.settle(pay, 'pay_1');
  assert.equal((await db.credits.ledger('u1')).items.filter((x) => x.kind === 'spend').length, 1);
});

test('an abandoned order gives the held credit back so the buyer can retry', async () => {
  const { db, promos, billing, user } = setup();
  await promos.onSignup({ user });
  await billing.checkout({ user, planId: 'plus-yearly', billing: {}, useCredit: true });
  const pay = [...db.__payments.values()][0];
  assert.equal(await db.credits.balance('u1'), 0);

  assert.equal(await promos.releaseOrder(pay.id), 10000);
  assert.equal(await db.credits.balance('u1'), 10000);
  assert.equal((await db.credits.ledger('u1')).items[0].kind, 'refund');
});

test('the ₹100 welcome bonus is quoted against a ₹99 plan exactly', async () => {
  const { promos, billing, user, db } = setup();
  await promos.onSignup({ user });
  assert.equal(await billing.creditFor(user.id, 9900), 9900);
  assert.equal(await billing.creditFor(user.id, 79900), 10000, 'never more than the balance');
  assert.equal(await billing.creditFor(user.id, 10050), 9950, 'one rupee stays on the card so Razorpay can charge it');
  assert.equal(await billing.creditFor('nobody', 9900), 0);

  // Expired credit is not quoted either.
  const grant = (await db.credits.ledger('u1')).items.find((x) => x.kind === 'signup');
  db.state.credit.find((x) => x.id === grant.id).expiresAt = new Date(Date.now() - HOUR).toISOString();
  assert.equal(await billing.creditFor(user.id, 9900), 0);
});
