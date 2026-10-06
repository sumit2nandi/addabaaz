// Email-delivery behavior for phone-only accounts. All dependencies are fakes; no MySQL or payment provider.
// Run: node --test server/test/phone-account-billing.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createBilling, billingConfigFromEnv, BillingError } from '../src/billing.js';
import { adminExtraRoutes } from '../src/admin-extra.js';

const placeholder = '919812345678@phone.addabaaz.in';

function fixture() {
  const user = { id: 'phone-user', email: placeholder, name: 'Rina Das' };
  const state = { mail: [], reminderClaims: 0, failureClaims: 0, settleCalls: 0 };
  const invoice = { id: 'invoice-1', userId: user.id, number: 'AB/2627/000001', kind: 'invoice', doc: { title: 'PAYMENT RECEIPT', buyer: { name: user.name } } };
  const db = {
    users: { async byId() { return user; } },
    payments: {
      async settle() { state.settleCalls++; return { applied: true, invoice }; },
      async byOrder() { return { id: 'payment-1', userId: user.id, status: 'created', planId: 'plus-monthly' }; },
      async byProviderPayment() { return { id: 'payment-1', userId: user.id, provider: 'razorpay', paymentId: 'provider-pay-1', status: 'paid', planId: 'plus-monthly', amountPaise: 9900 }; },
      async claimFailedNotice() { state.failureClaims++; return true; },
      async releaseFailedNotice() {},
      async openOrder() { return null; },
      async create() {},
    },
    invoices: { async byId() { return invoice; } },
    refunds: {
      async record() { return { becameProcessed: true, refund: { amountPaise: 9900, reason: 'customer request' }, creditNote: null, revoked: false }; },
      async forPayment() { return [{ status: 'processed', amountPaise: 9900 }]; },
    },
    subscriptions: {
      async get() { return { expiresAt: new Date(Date.now() + 30 * 86400_000) }; },
      async dueForReminder() { return [{ userId: user.id, email: user.email, name: user.name, planId: 'plus-monthly', expiresAt: new Date(Date.now() + 2 * 86400_000) }]; },
      async claimReminder() { state.reminderClaims++; return true; },
      async releaseReminder() {},
    },
  };
  const mailer = { provider: 'smtp', async send(message) { state.mail.push(message); return { sent: true }; } };
  const payments = { keyId: 'test-key', async createOrder({ amountPaise }) { return { orderId: 'new-order', amountPaise, currency: 'INR' }; } };
  const billing = createBilling({ db, payments, mailer, config: billingConfigFromEnv({ EXPIRY_REMINDER_DAYS: '3' }), log: { error() {} } });
  return { billing, user, state };
}

test('placeholder is omitted from invoice details and payment-provider prefill', async () => {
  const { billing, user } = fixture();
  assert.equal(billing.billingDetails({}, user).email, null);
  const order = await billing.checkout({ user, planId: 'plus-monthly', billing: {} });
  assert.deepEqual(order.prefill, { name: 'Rina Das' });
});

test('declined refund notices are not sent to the internal placeholder', async (t) => {
  const sent = [];
  const db = {
    refundRequests: {
      async get(id) { return { id, userId: 'phone-user', paymentId: 'payment-1', status: 'pending' }; },
      async decide() { return true; },
    },
    users: { async byId() { return { id: 'phone-user', email: placeholder, name: 'Rina Das' }; } },
    payments: { async byId() { return { planId: 'plus-monthly' }; } },
  };
  const router = express.Router();
  adminExtraRoutes({ router, db, billing: { config: { supportEmail: '' } }, catalog: {}, mailer: { provider: 'smtp', async send(message) { sent.push(message); return { sent: true }; } }, log: async () => {}, logger: { warn() {} }, siteUrl: 'https://app.example.test' });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.admin = { via: 'session', email: 'admin@example.test' }; next(); });
  app.use('/api', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/refund-requests/request-1/decline`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: 'Outside refund window.' }) });
  assert.equal(response.status, 204);
  assert.equal(sent.length, 0, 'the admin decision remains in Billing instead of being mailed to the placeholder');
});

test('payment/refund-adjacent notices and invoice email are never sent to the internal placeholder', async () => {
  const { billing, user, state } = fixture();
  await billing.settle({ id: 'payment-1', userId: user.id, planId: 'plus-monthly', amountPaise: 9900 }, 'pay_ref');
  await billing.idle();
  await billing.onPaymentFailed({ order_id: 'order-1', error_description: 'declined' });
  await billing.onRefundEvent({ id: 'refund-1', payment_id: 'provider-pay-1', amount: 9900, status: 'processed' });
  await billing.idle();
  assert.equal(await billing.sendExpiryReminders(), 0);
  assert.equal(state.mail.length, 0, 'no receipt, failure notice, refund notice or expiry reminder is addressed to the placeholder');
  assert.equal(state.failureClaims, 0, 'a suppressed failure notice does not consume the once-only email claim');
  assert.equal(state.reminderClaims, 0, 'a suppressed reminder does not consume the expiry-date claim');

  await assert.rejects(() => billing.emailInvoice(user, 'invoice-1'), (error) => {
    assert.ok(error instanceof BillingError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'email_not_verified');
    assert.match(error.message, /confirm an email address in Account/);
    return true;
  });
  assert.equal(state.mail.length, 0, 'invoice emailing is blocked until there is a verified contact address');
});
