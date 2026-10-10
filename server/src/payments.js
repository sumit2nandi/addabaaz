import crypto from 'node:crypto';
import { withTimeout, OUTBOUND_TIMEOUT_MS } from './http.js';

/**
 * Payments. Real money goes through Razorpay (INR, UPI/cards/netbanking/wallets):
 *   1. API creates an order            POST /api/v1/payments/checkout  → { orderId, keyId, amount }
 *   2. Browser opens Razorpay Checkout with that order; the viewer pays
 *   3. Browser sends the result        POST /api/v1/payments/verify    → API checks the HMAC signature, activates the plan
 *   4. Razorpay also calls our webhook POST /api/v1/payments/webhook   → same activation (idempotent) if the browser never came back
 * The secret key never leaves the server; a plan is only ever activated after a signature check.
 *
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET   (dashboard → Settings → API Keys / Webhooks)
 * Every provider call carries a request budget (HTTP_TIMEOUT_MS, default 15 s): a hung Razorpay must not
 * leave checkout requests open forever.
 * Without Razorpay keys a clearly-labelled demo provider is used in development only (never in production
 * unless ALLOW_MOCK_PAYMENTS=true).
 */
// HMAC helpers for signature checks. `safeEqualHex` compares in constant time so timing cannot leak the signature.
const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEqualHex = (a, b) => { const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8'); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Error for provider problems (503 unreachable, 502 provider rejected the request).
export class PaymentError extends Error { constructor(status, code, message, options = {}) { super(message, options); this.name = new.target.name; this.status = status; this.code = code; } }

// Razorpay client (plain HTTPS calls, no SDK). `fetchImpl` is injectable so tests can simulate Razorpay without network access.
export function createRazorpay({ keyId, keySecret, webhookSecret = '', fetchImpl = fetch, timeoutMs = OUTBOUND_TIMEOUT_MS }) {
  // Razorpay uses HTTP Basic auth with key id + secret.
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  return {
    provider: 'razorpay', keyId,
    // Creates a payment order for the amount; the browser then opens Razorpay Checkout with the returned order id.
    async createOrder({ amountPaise, receipt, notes }) {
      let r;
      try { r = await fetchImpl('https://api.razorpay.com/v1/orders', withTimeout({ method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }) }, timeoutMs)); }
      catch (cause) { throw new PaymentError(503, 'provider_unavailable', 'Could not reach the payment provider. Please try again.', { cause }); }
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.id) {
        const cause = Object.assign(new Error(`Razorpay order request failed (HTTP ${r.status}): ${body?.error?.description || 'no provider detail'}`), { statusCode: r.status });
        throw new PaymentError(r.status >= 500 ? 503 : 502, 'provider_error', 'The payment provider rejected the request.', { cause });
      }
      return { orderId: body.id, amountPaise: body.amount, currency: body.currency };
    },
    /** Refunds (part of) a captured payment. Razorpay answers { id: 'rfnd_…', status: 'pending' | 'processed' | 'failed' }; the final state also arrives by webhook. */
    async createRefund({ paymentId, amountPaise, notes, receipt }) {
      let r;
      try { r = await fetchImpl(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, withTimeout({ method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amountPaise, speed: 'normal', notes, receipt }) }, timeoutMs)); }
      catch (cause) { throw new PaymentError(503, 'provider_unavailable', 'Could not reach the payment provider. Please try again.', { cause }); }
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.id) {
        const why = body?.error?.description || `HTTP ${r.status}`;
        const cause = Object.assign(new Error(`Razorpay refund request failed (HTTP ${r.status}): ${why}`), { statusCode: r.status });
        throw new PaymentError(r.status >= 500 ? 503 : 502, 'provider_error', `The payment provider rejected the refund: ${why}`, { cause });
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

// Development-only stand-in: checkout succeeds instantly without money.
export const createMock = () => ({ provider: 'mock' });

// Chooses the provider: real Razorpay when keys are set; the mock in development (or if ALLOW_MOCK_PAYMENTS=true);
// otherwise "none" (checkout returns 501 in production without keys).
export function paymentsFromEnv(env = process.env) {
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) return createRazorpay({ keyId: env.RAZORPAY_KEY_ID.trim(), keySecret: env.RAZORPAY_KEY_SECRET.trim(), webhookSecret: (env.RAZORPAY_WEBHOOK_SECRET || '').trim() });
  if (env.NODE_ENV !== 'production' || /^(1|true)$/i.test(env.ALLOW_MOCK_PAYMENTS || '')) return createMock();
  return { provider: 'none' };
}
