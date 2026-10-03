// Billing business logic: pricing with coupons, GST details, checkout, settling payments, invoices, refunds,
// receipt e-mails and the accounting CSV. It sits between the HTTP routes (app.js / admin.js) and the
// storage layer (db-billing.js); the tax maths is in gst.js and the PDF drawing in invoice-pdf.js.
// All amounts are integers in paise (1 rupee = 100 paise) to avoid floating-point errors.
import crypto from 'node:crypto';
import { paidPlan, PLANS } from './plans.js';
import { computeTax, isValidGstin, gstinState, resolveState, stateName } from './gst.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import * as mail from './emails.js';

// An error with an HTTP status and code, translated to a JSON response by the API.
export class BillingError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
// Shortcut for a 400 BillingError.
const bad = (code, message) => new BillingError(400, code, message);

/**
 * Seller / invoicing configuration.
 *   GSTIN                 your 15-character GST number. Set  → invoices are GST tax invoices. Unset → plain payment receipts, no tax lines.
 *   GST_LEGAL_NAME        legal name printed on invoices        BUSINESS_ADDRESS  printed address (use \n for line breaks)
 *   BUSINESS_STATE        state name or code (only needed when GSTIN is unset)
 *   GST_SAC=998439        service accounting code               GST_RATE=18      percent, prices are GST-inclusive
 *   INVOICE_PREFIX=AB     ≤4 chars → AB/2627/000001 (16 characters is the legal maximum)
 *   SUPPORT_EMAIL, PUBLIC_SITE_URL, EXPIRY_REMINDER_DAYS=3, INVOICE_FOOTER
 */
export function billingConfigFromEnv(env = process.env) {
  // Read and validate everything up front so a typo (bad GSTIN, bad rate) stops the server at startup instead of producing wrong invoices.
  const gstin = (env.GSTIN || '').trim().toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new Error(`GSTIN "${gstin}" is not a valid GSTIN (check the digits — the last character is a checksum).`);
  const stateCode = gstin ? gstinState(gstin) : resolveState(env.BUSINESS_STATE);
  if (env.BUSINESS_STATE && !stateCode) throw new Error(`BUSINESS_STATE "${env.BUSINESS_STATE}" is not a recognised Indian state.`);
  // Without a GSTIN the seller is not GST-registered: tax rate 0 and documents are plain receipts.
  const rate = gstin ? Number(env.GST_RATE ?? 18) : 0;
  if (!(rate >= 0 && rate <= 40)) throw new Error('GST_RATE must be a percentage between 0 and 40.');
  const prefix = (env.INVOICE_PREFIX || 'AB').toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(prefix)) throw new Error('INVOICE_PREFIX must be 1–4 letters/digits (invoice numbers may not exceed 16 characters).');
  return {
    gstEnabled: !!gstin, rate, sac: env.GST_SAC || '998439', invoicePrefix: prefix, creditNotePrefix: 'CN',
    seller: {
      name: env.GST_LEGAL_NAME || 'ADDABAAZ', gstin: gstin || null, address: (env.BUSINESS_ADDRESS || '').replace(/\\n/g, '\n'),
      stateCode: stateCode || null, stateName: stateCode ? stateName(stateCode) : null, email: env.SUPPORT_EMAIL || '',
    },
    footer: env.INVOICE_FOOTER || '', supportEmail: env.SUPPORT_EMAIL || '', siteUrl: (env.PUBLIC_SITE_URL || 'https://addabaaz.in').replace(/\/$/, ''),
    reminderDays: Number(env.EXPIRY_REMINDER_DAYS ?? 3),
  };
}

// Coupon codes are case-insensitive: always compare upper-case.
const normCode = (c) => String(c || '').trim().toUpperCase();
// Smallest amount Razorpay accepts (100 paise = Rs 1); a coupon may not push a paid order below it.
const MIN_CHARGE = 100;      // Razorpay's minimum order is ₹1

// Factory: dependencies (database, payment provider, mailer) are injected so tests can fake them.
export function createBilling({ db, payments, mailer, config = billingConfigFromEnv(), log = console }) {
  // Tracks in-flight e-mail promises (see `track`).
  const pending = new Set();
  /** Emails are best-effort: they never delay or fail a payment. `idle()` lets tests (and graceful shutdown) wait for them. */
  const track = (p) => { const t = p.catch((e) => log.error('[billing] email failed:', e?.message || e)).finally(() => pending.delete(t)); pending.add(t); return t; };
  // Small helpers shared by the functions below.
  const seller = config.seller;
  const mailOpts = { supportEmail: config.supportEmail, siteUrl: config.siteUrl };
  const planName = (id) => PLANS.find((p) => p.id === id)?.name || id;
  const pdfName = (inv) => `${inv.kind === 'credit_note' ? 'credit-note' : 'invoice'}-${inv.number.replace(/\//g, '-')}.pdf`;
  const pdf = async (inv) => ({ filename: pdfName(inv), content: await renderInvoicePdf(inv, { compress: !config.uncompressedPdf }), contentType: 'application/pdf' });

  /* ---------------- coupons ---------------- */
  /** Prices a purchase. Throws a 400 `invalid_coupon` with a human reason when the coupon can't be used. */
  async function quote(userId, planId, couponCode) {
    const plan = paidPlan(planId);
    if (!plan) throw bad('unknown_plan', 'Choose a paid plan.');
    // List price in paise; discounts are applied on top of this.
    const listPaise = plan.priceINR * 100;
    const out = { plan, listPaise, discountPaise: 0, finalPaise: listPaise, coupon: null };
    const code = normCode(couponCode);
    if (!code) return out;
    const invalid = (m) => bad('invalid_coupon', m);
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw invalid('That coupon code isn’t valid.');
    const c = await db.coupons.get(code);
    const now = Date.now();
    if (!c || !c.active) throw invalid('That coupon code isn’t valid.');
    if (c.startsAt && Date.parse(c.startsAt) > now) throw invalid('This coupon isn’t active yet.');
    if (c.expiresAt && Date.parse(c.expiresAt) <= now) throw invalid('This coupon has expired.');
    if (c.planIds && !c.planIds.includes(plan.id)) throw invalid('This coupon doesn’t apply to the selected plan.');
    // Percent coupons round down; flat coupons can never exceed the price.
    let discount = c.kind === 'percent' ? Math.floor((listPaise * c.value) / 100) : Math.min(c.value, listPaise);
    let final = listPaise - discount;
    // Keep a paid order at least the provider minimum.
    if (final > 0 && final < MIN_CHARGE) { final = MIN_CHARGE; discount = listPaise - final; }       // the card network's minimum charge is ₹1
    // A buyer who reopens their own unpaid order already holds the coupon's slot — don't count it against them.
    // (A returning buyer's own unpaid order already holds the coupon slot, so do not count it twice.)
    const held = final > 0 && userId && await db.payments.openOrder({ userId, planId: plan.id, amountPaise: final, couponCode: c.code, provider: 'razorpay' });
    if (!held) {
      if (c.maxRedemptions != null && (await db.coupons.usage(c.code)) >= c.maxRedemptions) throw invalid('This coupon has been fully redeemed.');
      if (userId && (await db.coupons.usage(c.code, userId)) >= c.perUserLimit) throw invalid('You have already used this coupon.');
    }
    return { ...out, discountPaise: discount, finalPaise: final, coupon: c };
  }
  // The subset of a quote that is shown to the buyer.
  const quoteView = (q) => ({ planId: q.plan.id, listPaise: q.listPaise, discountPaise: q.discountPaise, finalPaise: q.finalPaise, coupon: q.coupon && { code: q.coupon.code, description: q.coupon.description } });

  /* ---------------- billing details ---------------- */
  /** Validates the buyer's billing details. With GST on, the place of supply (state) is mandatory; a valid GSTIN fixes it and gets the invoice in the business's name. */
  function billingDetails(input, user) {
    const i = input && typeof input === 'object' ? input : {};
    const gstin = String(i.gstin || '').trim().toUpperCase();
    let state = resolveState(i.state), name = String(i.name || user.name || '').trim().slice(0, 100);
    if (gstin) {
      if (!config.gstEnabled) throw bad('gstin_not_supported', 'GST invoices aren’t enabled on this service.');
      if (!isValidGstin(gstin)) throw bad('invalid_gstin', 'That GSTIN doesn’t look right. Please check it (15 characters).');
      if (!String(i.name || '').trim()) throw bad('business_name_required', 'Enter your business name to get an invoice with your GSTIN.');
      state = gstinState(gstin);
    } else if (config.gstEnabled && !state) throw bad('billing_state_required', 'Select your state — it decides how GST is shown on your invoice.');
    return { name, email: user.email, state, stateName: state ? stateName(state) : null, gstin: gstin || null };
  }

  /* ---------------- invoices ---------------- */
  // Builds the invoice document for a paid order: tax split, seller/buyer details, line item, discount and payment reference.
  // The returned `doc` is stored as JSON so an invoice never changes later even if settings do.
  function invoiceFields(p) {
    const plan = paidPlan(p.planId), b = p.billing || {};
    // Prices are GST-inclusive; this splits them into taxable value + CGST/SGST (same state) or IGST (different state).
    const amounts = computeTax({ totalPaise: p.amountPaise, rate: config.rate, intraState: !!(config.gstEnabled && b.state && b.state === seller.stateCode) });
    return {
      prefix: config.invoicePrefix, amounts, gstRate: config.rate,
      doc: {
        title: config.gstEnabled ? 'TAX INVOICE' : 'PAYMENT RECEIPT', seller: { ...seller, sac: config.sac },
        buyer: { name: b.name || b.email, email: b.email, gstin: b.gstin || null, stateCode: b.state || null, stateName: b.stateName || null },
        placeOfSupply: b.state ? `${b.stateName} (${b.state})` : null,
        lines: [{ description: `${plan?.name || p.planId} — ${plan?.days ?? ''} days of premium video access`, sac: config.sac }],
        listPricePaise: p.listPricePaise, discount: p.discountPaise ? { code: p.couponCode, paise: p.discountPaise } : null,
        reverseCharge: config.gstEnabled ? 'No' : null, paymentRef: { provider: 'Razorpay', paymentId: p.paymentId || '' }, footer: config.footer,
      },
    };
  }
  // A credit note copies the original invoice document and refers to it by number/date.
  function creditNoteFields({ invoice, refund }) {
    const d = invoice.doc;
    return {
      prefix: config.creditNotePrefix,
      doc: { ...d, title: 'CREDIT NOTE', discount: null, refers: { number: invoice.number, date: invoice.issuedAt }, reason: refund.reason || null, lines: [{ description: `Refund — ${d.lines[0].description}`, sac: d.lines[0].sac }] },
    };
  }

  /* ---------------- purchase ---------------- */
  /** Razorpay checkout: prices the order (coupon + GST details), then creates or reopens the Razorpay order. */
  async function checkout({ user, planId, couponCode, billing: input }) {
    const q = await quote(user.id, planId, couponCode);
    const billing = billingDetails(input, user);
    const plan = q.plan, couponRow = q.coupon;
    const base = { userId: user.id, planId: plan.id, listPricePaise: q.listPaise, discountPaise: q.discountPaise, couponCode: couponRow?.code || null, billing };
    // Translates a coupon-limit error raised inside the transaction into a friendly 400.
    const wrapCoupon = async (fn) => { try { return await fn(); } catch (e) { if (e.code === 'coupon_exhausted' || e.code === 'coupon_used') throw bad('invalid_coupon', e.message); throw e; } };

    // A 100%-off coupon: nothing to pay, so access is granted immediately and no gateway order is created.
    if (q.finalPaise === 0) {                              // 100%-off coupon: grant without a payment
      const id = crypto.randomUUID();
      await wrapCoupon(() => db.payments.create({ ...base, id, provider: 'coupon', orderId: `coupon_${id}`, amountPaise: 0 }, { coupon: couponRow }));
      const pay = await db.payments.byId(id);
      const r = await db.payments.settle(pay, `coupon_${id}`, plan.days);
      const subscription = await db.subscriptions.get(user.id);
      if (r.applied) track(mailer.send({ to: user.email, ...mail.accessGrantedEmail({ ...mailOpts, name: user.name, couponCode: couponRow.code, planName: plan.name, validUntil: subscription.expiresAt }) }));
      return { provider: 'coupon', subscription, quote: quoteView(q) };
    }

    // If the buyer already has an unpaid order for the same purchase, reopen it instead of creating a duplicate.
    const reuse = await db.payments.openOrder({ userId: user.id, planId: plan.id, amountPaise: q.finalPaise, couponCode: base.couponCode, provider: 'razorpay' });
    let orderId, amount = q.finalPaise, currency = 'INR';
    if (reuse) { await db.payments.setBilling(reuse.id, billing); orderId = reuse.orderId; }
    else {
      const id = crypto.randomUUID();
      const order = await payments.createOrder({ amountPaise: q.finalPaise, receipt: `ab_${id.slice(0, 30)}`, notes: { userId: user.id, planId: plan.id, ...(couponRow ? { coupon: couponRow.code } : {}) } });
      await wrapCoupon(() => db.payments.create({ ...base, id, provider: 'razorpay', orderId: order.orderId, amountPaise: order.amountPaise }, { coupon: couponRow }));
      orderId = order.orderId; amount = order.amountPaise; currency = order.currency;
    }
    return { provider: 'razorpay', keyId: payments.keyId, orderId, amount, currency, plan: { id: plan.id, name: plan.name }, quote: quoteView(q), prefill: { name: user.name, email: user.email } };
  }

  /** Marks an order paid (idempotent), issues its invoice and emails the receipt — used by /payments/verify and the webhook. */
  // (see JSDoc above) Called by both the browser confirmation and the webhook; `db.payments.settle` makes sure access is only granted once.
  async function settle(payment, providerPaymentId) {
    const plan = paidPlan(payment.planId);
    const r = await db.payments.settle(payment, providerPaymentId, plan.days, { invoice: invoiceFields });
    if (r.applied && r.invoice && payment.userId) track(sendReceipt(payment, r.invoice));
    return r;
  }
  // Receipt e-mail with the invoice PDF attached.
  async function sendReceipt(payment, invoice) {
    const user = await db.users.byId(payment.userId); if (!user) return;
    const sub = await db.subscriptions.get(user.id);
    await mailer.send({
      to: user.email, attachments: [await pdf(invoice)],
      ...mail.receiptEmail({ ...mailOpts, name: user.name, planName: planName(payment.planId), invoice, amountPaise: payment.amountPaise, validUntil: sub.expiresAt || new Date(), couponCode: payment.couponCode, discountPaise: payment.discountPaise }),
    });
  }

  /** Razorpay `payment.failed`: tell the buyer once per order. Does NOT close the order — the buyer may retry on the same order. */
  async function onPaymentFailed(entity) {
    const p = entity?.order_id ? await db.payments.byOrder('razorpay', entity.order_id) : null;
    if (!p || !p.userId || p.status !== 'created') return;
    if (!(await db.payments.claimFailedNotice(p.id))) return;
    const user = await db.users.byId(p.userId); if (!user) return;
    const release = () => db.payments.releaseFailedNotice(p.id).catch((releaseError) => log.error('[billing] failed-notice claim release failed:', releaseError?.message || releaseError));
    track(mailer.send({ to: user.email, ...mail.paymentFailedEmail({ ...mailOpts, name: user.name, planName: planName(p.planId), reason: String(entity.error_description || '').slice(0, 120), retryUrl: `${config.siteUrl}/#/plans` }) }).then(async (r) => {
      if (!r?.sent) await release();
    }).catch(async (e) => { await release(); throw e; }));
  }

  /* ---------------- refunds ---------------- */
  // After a refund completes: e-mail the buyer the credit note (only the first time it becomes processed).
  async function afterRefund(payment, rec) {
    if (!rec.becameProcessed || !payment.userId) return;
    const user = await db.users.byId(payment.userId); if (!user) return;
    const attachments = rec.creditNote ? [await pdf(rec.creditNote)] : [];
    await mailer.send({
      to: user.email, attachments,
      ...mail.refundEmail({ ...mailOpts, name: user.name, amountPaise: rec.refund.amountPaise, creditNote: rec.creditNote, accessRevoked: rec.revoked, fullRefund: rec.fullRefund, reason: rec.refund.reason }),
    });
  }
  // Stores a refund event, then (best effort) sends the e-mail.
  async function record(payment, args) {
    const rec = await db.refunds.record({ paymentId: payment.id, days: paidPlan(payment.planId)?.days ?? 0, creditNote: creditNoteFields, ...args });
    const all = await db.refunds.forPayment(payment.id);
    rec.fullRefund = all.filter((r) => r.status !== 'failed').reduce((n, r) => n + r.amountPaise, 0) >= payment.amountPaise;
    track(afterRefund(payment, rec));
    return rec;
  }
  /** Operator-initiated refund through the payment provider. `amountPaise` omitted = refund whatever is left. */
  async function refund({ paymentId, amountPaise, reason, revokeAccess = false }) {
    // Validate: it must be a paid Razorpay payment, and the refund may not exceed what is still refundable.
    const p = await db.payments.byId(paymentId);
    if (!p) throw new BillingError(404, 'not_found', 'Unknown payment.');
    if (p.provider !== 'razorpay' || p.status !== 'paid' || !p.paymentId) throw new BillingError(409, 'not_refundable', 'Only paid Razorpay payments can be refunded here.');
    const existing = await db.refunds.forPayment(p.id);
    const left = p.amountPaise - existing.filter((r) => r.status !== 'failed').reduce((n, r) => n + r.amountPaise, 0);
    if (left <= 0) throw new BillingError(409, 'refund_exceeds_payment', 'This payment has already been fully refunded.');
    const amount = amountPaise ?? left;
    if (!Number.isInteger(amount) || amount < 100) throw bad('invalid_amount', 'Refund amount must be a whole number of paise, at least 100 (₹1).');
    if (amount > left) throw new BillingError(409, 'refund_exceeds_payment', `Only ${left} paise is left to refund on this payment.`);
    const r = await payments.createRefund({ paymentId: p.paymentId, amountPaise: amount, notes: { reason: String(reason || '').slice(0, 200), paymentRef: p.id } });
    return record(p, { providerRefundId: r.refundId, amountPaise: amount, status: r.status, reason: reason || null, source: 'admin', revokeAccess });
  }
  /** Razorpay `refund.created | processed | failed` (also fires for refunds made in the Razorpay dashboard). */
  async function onRefundEvent(entity) {
    if (!entity?.id || !entity.payment_id) return null;
    // Refund events also arrive for refunds made directly in the Razorpay dashboard; map them to our payment (ignore foreign ones).
    const p = await db.payments.byProviderPayment('razorpay', entity.payment_id);
    if (!p) return null;                                  // not one of ours
    const status = entity.status === 'processed' ? 'processed' : entity.status === 'failed' ? 'failed' : 'pending';
    try { return await record(p, { providerRefundId: entity.id, amountPaise: entity.amount, status, reason: entity.notes?.reason || null, source: 'provider' }); }
    catch (e) { if (e.code === 'refund_exceeds_payment') { log.error('[billing] ignoring refund larger than the payment', entity.id); return null; } throw e; }
  }

  /* ---------------- reading ---------------- */
  // The buyer's own payment history for the Billing page.
  async function history(userId) {
    return (await db.payments.listForUser(userId)).map((p) => {
      const inv = p.invoices.find((i) => i.kind === 'invoice');
      return {
        id: p.id, planId: p.planId, planName: planName(p.planId), provider: p.provider, amountPaise: p.amountPaise, listPricePaise: p.listPricePaise, discountPaise: p.discountPaise,
        couponCode: p.couponCode, paidAt: p.paidAt, refundedPaise: p.refundedPaise,
        invoice: inv ? { id: inv.id, number: inv.number, title: inv.doc.title } : null,
        creditNotes: p.invoices.filter((i) => i.kind === 'credit_note').map((i) => ({ id: i.id, number: i.number, totalPaise: i.total, issuedAt: i.issuedAt })),
        refunds: p.refunds.map((r) => ({ amountPaise: r.amountPaise, status: r.status, createdAt: r.createdAt })),
      };
    });
  }
  // Security check: a user may only open their own documents.
  async function ownedInvoice(userId, invoiceId) {
    const inv = typeof invoiceId === 'string' ? await db.invoices.byId(invoiceId) : null;
    if (!inv || !inv.userId || inv.userId !== userId) throw new BillingError(404, 'not_found', 'Invoice not found.');
    return inv;
  }
  // Admins can open any document; users only their own.
  async function adminInvoicePdf(invoiceId) { const inv = typeof invoiceId === 'string' ? await db.invoices.byId(invoiceId) : null; if (!inv) throw new BillingError(404, 'not_found', 'Invoice not found.'); return pdf(inv); }
  async function invoicePdf(userId, invoiceId) { const inv = await ownedInvoice(userId, invoiceId); return { ...(await pdf(inv)), invoice: inv }; }
  async function emailInvoice(user, invoiceId) {
    const inv = await ownedInvoice(user.id, invoiceId);
    if (mailer.provider === 'none' && process.env.NODE_ENV === 'production') throw new BillingError(503, 'email_not_configured', 'Email isn’t set up on this server.');
    await mailer.send({ to: user.email, attachments: [await pdf(inv)], subject: `${inv.doc.title === 'CREDIT NOTE' ? 'Credit note' : 'Invoice'} ${inv.number} — ADDABAAZ`, text: `Hi ${user.name.split(' ')[0]},\n\nAs requested, ${inv.number} is attached.\n\n— ADDABAAZ`, html: undefined });
    return inv;
  }

  /* ---------------- expiry reminders ---------------- */
  /** Emails everyone whose paid plan ends within `reminderDays`, once per expiry date. Safe to run on every instance. */
  async function sendExpiryReminders() {
    if (!(config.reminderDays > 0)) return 0;
    let sent = 0;
    for (const s of await db.subscriptions.dueForReminder(config.reminderDays)) {
      if (!(await db.subscriptions.claimReminder(s.userId, s.expiresAt))) continue;
      sent++;
      const release = () => db.subscriptions.releaseReminder(s.userId, s.expiresAt).catch((releaseError) => log.error('[billing] reminder claim release failed:', releaseError?.message || releaseError));
      track(mailer.send({ to: s.email, ...mail.expiringEmail({ ...mailOpts, name: s.name, planName: planName(s.planId), expiresAt: s.expiresAt, renewUrl: `${config.siteUrl}/#/plans` }) }).then(async (r) => {
        if (!r?.sent) await release();
      }).catch(async (e) => { await release(); throw e; }));
    }
    return sent;
  }

  /* ---------------- accounting export ---------------- */
  /** CSV sales register (invoices positive, credit notes negative) for [from, to) — hand it to your accountant / use for GSTR-1. */
  async function registerCsv(from, to) {
    const rows = await db.invoices.register(from, to);
    // CSV escaping: quote any value containing a comma, quote or newline.
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    // Credit notes are written as negative numbers so column totals net out correctly.
    const r2 = (p, k) => ((k === 'credit_note' ? -p : p) / 100).toFixed(2);
    const head = ['Document', 'Number', 'Date (IST)', 'Against', 'Customer', 'Customer GSTIN', 'Place of supply', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total', 'GST rate %'];
    const lines = rows.map((i) => [i.kind === 'credit_note' ? 'Credit note' : i.doc.title === 'TAX INVOICE' ? 'Tax invoice' : 'Receipt', i.number,
      new Date(Date.parse(i.issuedAt) + 5.5 * 3600_000).toISOString().slice(0, 10), i.doc.refers?.number || '', i.doc.buyer.name, i.doc.buyer.gstin || '', i.doc.placeOfSupply || '',
      r2(i.taxable, i.kind), r2(i.cgst, i.kind), r2(i.sgst, i.kind), r2(i.igst, i.kind), r2(i.total, i.kind), i.gstRate]);
    return [head, ...lines].map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  // Public surface of the billing module.
  return { config, quote, quoteView, billingDetails, checkout, settle, onPaymentFailed, refund, onRefundEvent, history, invoicePdf, adminInvoicePdf, emailInvoice, sendExpiryReminders, registerCsv, idle: async () => { while (pending.size) await Promise.all([...pending]); } };
}
