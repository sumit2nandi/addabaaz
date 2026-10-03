// Checks the Razorpay setup the way the server sees it:  npm run razorpay:check
//
//   node --env-file=.env scripts/razorpay-check.mjs               # verify the keys (no money moves)
//   node --env-file=.env scripts/razorpay-check.mjs --order       # also create a ₹1 order — proves order creation works
//   node --env-file=.env scripts/razorpay-check.mjs --order 79900 # ...for ₹799 (the amount is in paise)
//
// Reads the same RAZORPAY_* / NODE_ENV / ALLOW_MOCK_PAYMENTS variables as the server (export them, or run with
// `node --env-file=.env`), then reports exactly what POST /api/v1/payments/checkout would do in this environment.
// An order is a payment intent, not a charge: nothing is debited and an unpaid order simply expires. To be safe
// this refuses to create an order with live keys unless you add --yes.
import { paymentsFromEnv } from '../server/src/payments.js';

const env = process.env;
const args = process.argv.slice(2);
const wantOrder = args.includes('--order');
const amountArg = args.find((a) => /^\d+$/.test(a));
const amountPaise = amountArg ? Number(amountArg) : 100;
let failed = false;
const ok = (m) => console.log(`✔ ${m}`);
const warn = (m) => console.log(`▲ ${m}`);
const bad = (m) => { failed = true; console.error(`✖ ${m}`); };
const info = (m) => console.log(`  ${m}`);

console.log('Razorpay check — what this environment would do\n');

/* Which provider the server picks (server/src/payments.js). */
const provider = paymentsFromEnv(env).provider;
if (provider === 'razorpay') ok('Payment provider: razorpay — real payments are possible.');
else if (provider === 'mock') {
  warn('Payment provider: mock — the labelled demo checkout; nobody is really charged.');
  info('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test keys first) and re-run this check to collect real money.');
  if (env.NODE_ENV === 'production') bad('ALLOW_MOCK_PAYMENTS=true in production lets anyone grant themselves a plan. Unset it.');
  process.exit(1);
} else {
  bad('Payment provider: none — in production /payments/checkout answers 501 and no plan can be bought.');
  info('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (Razorpay dashboard → Settings → API Keys), restart, re-run.');
  process.exit(1);
}

const keyId = (env.RAZORPAY_KEY_ID || '').trim();
const keySecret = (env.RAZORPAY_KEY_SECRET || '').trim();
const webhookSecret = (env.RAZORPAY_WEBHOOK_SECRET || '').trim();
const mode = keyId.startsWith('rzp_test_') ? 'test' : keyId.startsWith('rzp_live_') ? 'live' : 'unknown';
if (mode === 'test') ok('Key mode: test (rzp_test_…) — cards/UPI are simulated and no money moves.');
else if (mode === 'live') ok('Key mode: live (rzp_live_…) — real money.');
else warn('Key id does not start with rzp_test_ or rzp_live_ — is it really a Razorpay key?');
if (mode === 'test' && env.NODE_ENV === 'production') warn('Production is running TEST keys: viewers can "buy" but nobody is charged.');
if (/^(1|true)$/i.test(env.ALLOW_MOCK_PAYMENTS || '') && mode === 'live') bad('ALLOW_MOCK_PAYMENTS=true disables the mock only when keys are missing, but it is set on a live account setup — unset it.');

if (webhookSecret) ok(`Webhook secret: set (${webhookSecret.length} chars).`);
else warn('RAZORPAY_WEBHOOK_SECRET is not set: a payment still activates the plan when the buyer returns to the site, but one who closes the tab before the redirect is only settled when they come back. Set it: dashboard → Settings → Webhooks.');
if (env.GSTIN) ok('GSTIN is set — invoices are issued as tax invoices.');
else info('GSTIN is not set — purchases are invoiced as plain receipts without GST (fine if you are not GST-registered).');

const base = (env.PUBLIC_API_URL || env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
info(`Webhook URL to add in Razorpay: ${base ? `${base}/api/v1/payments/webhook` : 'https://<your-domain>/api/v1/payments/webhook'}`);
info('Events: payment.captured, payment.failed, refund.created, refund.processed, refund.failed');

/* Verify the key pair against the real API. An order listing is a read; creating one is a write that costs nothing. */
const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
const call = async (path, init = {}) => {
  let r;
  try { r = await fetch(`https://api.razorpay.com/v1${path}`, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) } }); }
  catch (e) { return { network: e.message }; }
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
};

console.log('\nContacting api.razorpay.com…');
const who = await call('/orders?count=1');
if (who.network) {
  bad(`Could not reach Razorpay: ${who.network}`);
  info('Check the machine’s network/proxy. The server needs api.razorpay.com reachable at checkout time.');
} else if (who.status === 200) {
  ok(`Credentials accepted — ${who.body.count ?? 0} existing order(s) on this account.`);
} else if (who.status === 401) {
  bad('Razorpay rejected the key id/secret pair (401). Regenerate them in Settings → API Keys and paste both again.');
} else if (who.status === 403) {
  bad('The key is valid but this account cannot take payments yet (403) — finish KYC / activate payments in the Razorpay dashboard.');
} else {
  bad(`Razorpay answered HTTP ${who.status}: ${who.body?.error?.description || 'no details'}`);
}

if (wantOrder && !failed) {
  if (amountPaise < 100) { bad('Razorpay’s minimum order is ₹1 (100 paise).'); }
  else if (mode === 'live' && !args.includes('--yes')) {
    warn(`Refusing to create a live order for ₹${(amountPaise / 100).toFixed(2)} without --yes (it would show up in your live dashboard).`);
  } else {
    const made = await call('/orders', { method: 'POST', body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: `check_${Date.now()}`, notes: { source: 'razorpay-check' } }) });
    if (made.network) bad(`Could not reach Razorpay: ${made.network}`);
    else if (made.status >= 200 && made.status < 300 && made.body?.id) ok(`Order created: ${made.body.id} · ₹${(made.body.amount / 100).toFixed(2)} · status ${made.body.status} (nothing charged).`);
    else bad(`Order creation failed (HTTP ${made.status}): ${made.body?.error?.description || 'no details'}`);
  }
}

if (failed) {
  console.error('\nNot ready to collect payments. Fix the ✖ items above and re-run.');
  process.exit(1);
}
console.log('\nReady. On the website, POST /api/v1/payments/checkout will create real orders and Checkout will open.');
console.log('Do one end-to-end test-mode purchase, then read docs/PAYMENTS.md before changing keys or selling in the apps.');
