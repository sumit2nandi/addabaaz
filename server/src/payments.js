import crypto from 'node:crypto';

/**
 * Payments. Real money goes through Razorpay (INR, UPI/cards/netbanking/wallets):
 *   1. API creates an order            POST /api/v1/payments/checkout  → { orderId, keyId, amount }
 *   2. Browser opens Razorpay Checkout with that order; the viewer pays
 *   3. Browser sends the result        POST /api/v1/payments/verify    → API checks the HMAC signature, activates the plan
 *   4. Razorpay also calls our webhook POST /api/v1/payments/webhook   → same activation (idempotent) if the browser never came back
 * The secret key never leaves the server; a plan is only ever activated after a signature check.
 *
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET   (dashboard → Settings → API Keys / Webhooks)
 * Without Razorpay keys a clearly-labelled demo provider is used in development only (never in production
 * unless ALLOW_MOCK_PAYMENTS=true).
 */
const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEqualHex = (a, b) => { const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8'); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export class PaymentError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

export function createRazorpay({ keyId, keySecret, webhookSecret = '', fetchImpl = fetch }) {
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  return {
    provider: 'razorpay', keyId,
    async createOrder({ amountPaise, receipt, notes }) {
      let r;
      try { r = await fetchImpl('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }) }); }
      catch { throw new PaymentError(503, 'provider_unavailable', 'Could not reach the payment provider. Please try again.'); }
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.id) { console.error('[razorpay] order failed', r.status, body?.error?.description); throw new PaymentError(r.status >= 500 ? 503 : 502, 'provider_error', 'The payment provider rejected the request.'); }
      return { orderId: body.id, amountPaise: body.amount, currency: body.currency };
    },
    /** Refunds (part of) a captured payment. Razorpay answers { id: 'rfnd_…', status: 'pending' | 'processed' | 'failed' }; the final state also arrives by webhook. */
    async createRefund({ paymentId, amountPaise, notes, receipt }) {
      let r;
      try { r = await fetchImpl(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amountPaise, speed: 'normal', notes, receipt }) }); }
      catch { throw new PaymentError(503, 'provider_unavailable', 'Could not reach the payment provider. Please try again.'); }
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.id) {
        const why = body?.error?.description || `HTTP ${r.status}`;
        console.error('[razorpay] refund failed', r.status, why);
        throw new PaymentError(r.status >= 500 ? 503 : 502, 'provider_error', `The payment provider rejected the refund: ${why}`);
      }
      return { refundId: body.id, amountPaise: body.amount, status: body.status === 'processed' ? 'processed' : body.status === 'failed' ? 'failed' : 'pending' };
    },
    /** Checkout callback signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
    verifyPayment({ orderId, paymentId, signature }) { return typeof orderId === 'string' && typeof paymentId === 'string' && safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature); },
    /** Webhook signature: HMAC_SHA256(raw request body, webhook secret) in X-Razorpay-Signature. */
    verifyWebhook(rawBody, signature) { return !!webhookSecret && !!rawBody && safeEqualHex(hmacHex(webhookSecret, rawBody), signature); },
    webhookConfigured: !!webhookSecret,
  };
}

export const createMock = () => ({ provider: 'mock' });

export function paymentsFromEnv(env = process.env) {
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) return createRazorpay({ keyId: env.RAZORPAY_KEY_ID.trim(), keySecret: env.RAZORPAY_KEY_SECRET.trim(), webhookSecret: (env.RAZORPAY_WEBHOOK_SECRET || '').trim() });
  if (env.NODE_ENV !== 'production' || /^(1|true)$/i.test(env.ALLOW_MOCK_PAYMENTS || '')) return createMock();
  return { provider: 'none' };
}
