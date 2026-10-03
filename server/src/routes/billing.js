// Authenticated subscription, checkout, payment-history and invoice endpoints.
import { HttpError, bad, wrap, rateLimit } from '../http.js';
import { paidPlan } from '../plans.js';

export function registerBillingRoutes(api, { db, billing, payments, features, rate }) {
  /* ---------- subscription & payments ---------- */
  api.get('/subscription', wrap(async (req, res) => res.json({ subscription: await db.subscriptions.get(req.user.id) })));
  // Payment endpoints are rate limited too (20 per minute per IP).
  const payLimit = rate ? rateLimit('pay', 20, 60_000) : (_q, _s, n) => n();

  /**
   * Price preview: applies a coupon, and — when the buyer asks for it (`useCredit: true`, the plans page's
   * "use my credit" box) — shows how much of the price promotional credit would cover.
   */
  api.post('/payments/quote', payLimit, wrap(async (req, res) => {
    if (payments.provider !== 'razorpay') throw new HttpError(501, 'payments_not_configured', 'Coupons aren’t available right now.');
    const q = await billing.quote(req.user.id, req.body?.planId, req.body?.couponCode);
    const creditPaise = req.body?.useCredit === true ? await billing.creditFor(req.user.id, q.finalPaise) : 0;
    res.json({ quote: billing.quoteView(q, { creditPaise }) });
  }));

  /** Step 1: start a purchase. Razorpay → returns the order for Checkout (coupon + GST billing details applied). Demo provider → activates immediately. */
  api.post('/payments/checkout', payLimit, wrap(async (req, res) => {
    features.requireVerified(req.user);
    const plan = paidPlan(req.body?.planId);
    if (!plan) throw bad('Choose a paid plan.', 'unknown_plan');
    if (payments.provider === 'none') throw new HttpError(501, 'payments_not_configured', 'Payments aren’t available right now — please try again later.');
    // Development only: no real payment, activate the plan immediately ("demo" subscription).
    if (payments.provider === 'mock') {
      await db.subscriptions.activateDemo(req.user.id, plan.id, plan.days);
      return res.status(201).json({ provider: 'mock', demo: true, subscription: await db.subscriptions.get(req.user.id) });
    }
    res.status(201).json(await billing.checkout({ user: req.user, planId: plan.id, couponCode: req.body?.couponCode, billing: req.body?.billing, useCredit: req.body?.useCredit === true }));
  }));

  /** Step 3: the browser reports a finished payment. Nothing is granted unless the signature is valid for OUR order. */
  api.post('/payments/verify', payLimit, wrap(async (req, res) => {
    if (payments.provider !== 'razorpay') throw new HttpError(501, 'payments_not_configured', 'Payments aren’t available right now — please try again later.');
    // The signature proves Razorpay (not the browser) says this payment happened.
    const { orderId, paymentId, signature } = req.body || {};
    const pay = typeof orderId === 'string' ? await db.payments.byOrder('razorpay', orderId) : null;
    if (!pay || pay.userId !== req.user.id) throw new HttpError(404, 'not_found', 'Unknown order.');            // also blocks using someone else's order
    if (!payments.verifyPayment({ orderId, paymentId, signature })) throw new HttpError(400, 'invalid_signature', 'Payment could not be verified. If money was deducted it will be reversed automatically, or contact support.');
    await billing.settle(pay, paymentId);                                                                          // idempotent; issues the invoice
    res.json({ subscription: await db.subscriptions.get(req.user.id) });
  }));

  /* ---------- billing history & documents ---------- */
  // Payment history and downloadable GST invoices / credit notes.
  api.get('/billing', wrap(async (req, res) => res.json({ payments: await billing.history(req.user.id) })));
  api.get('/invoices/:id/pdf', wrap(async (req, res) => {
    const f = await billing.invoicePdf(req.user.id, req.params.id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'private, no-store' }); res.send(f.content);
  }));
  api.post('/invoices/:id/email', payLimit, wrap(async (req, res) => { await billing.emailInvoice(req.user, req.params.id); res.sendStatus(204); }));

  /** Cancelling only applies to demo plans: real plans are prepaid, don't renew and simply run out. */
  api.delete('/subscription', wrap(async (req, res) => {
    const sub = await db.subscriptions.get(req.user.id);
    if (sub.planId !== 'free' && !sub.demo) throw new HttpError(409, 'not_cancellable', `Your plan is prepaid and doesn’t renew automatically — it stays active until ${new Date(sub.expiresAt).toDateString()}.`);
    await db.subscriptions.clear(req.user.id);
    res.json({ subscription: await db.subscriptions.get(req.user.id) });
  }));

}
