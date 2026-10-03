// Payment-provider webhook adapter. Signature verification is delegated to the payment port.
import { bad, wrap } from '../http.js';

export function registerPaymentWebhook(api, { db, billing, payments }) {
  /** Razorpay → us. Public but signed: activates the plan even if the buyer closed the tab after paying. */
  api.post('/payments/webhook', wrap(async (req, res) => {
    if (payments.provider !== 'razorpay') return res.sendStatus(404);
    if (!payments.verifyWebhook(req.rawBody, req.headers['x-razorpay-signature'])) throw bad('Bad signature.', 'invalid_signature');
    // Razorpay sends several event types; each one is routed to the billing module.
    const ev = req.body?.event, pe = req.body?.payload?.payment?.entity, re = req.body?.payload?.refund?.entity;
    // Payment succeeded: match our order, check amount and currency, then grant access (idempotent, so retries are harmless).
    if ((ev === 'payment.captured' || ev === 'order.paid') && pe?.order_id && pe?.id && (pe.status === 'captured' || ev === 'order.paid')) {
      const pay = await db.payments.byOrder('razorpay', pe.order_id);
      if (pay && pay.amountPaise === pe.amount && pe.currency === 'INR') await billing.settle(pay, pe.id);
      else console.warn('[payments] webhook for unknown order or amount mismatch', pe.order_id);
    } else if (ev === 'payment.failed') await billing.onPaymentFailed(pe);
    else if (/^refund\.(created|processed|failed)$/.test(ev || '')) await billing.onRefundEvent(re);
    res.json({ ok: true });                                               // always 200 for valid signatures so Razorpay doesn't retry forever
  }));

}
