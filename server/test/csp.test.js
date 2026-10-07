// CSP tests: the website's Content-Security-Policy must allow everything the Razorpay checkout
// popup needs. Regression test for the blank-white-screen bug: checkout.razorpay.com (script host)
// was allowed but api.razorpay.com (payment-form iframe host) was missing from frame-src, so the
// popup opened empty. Needs no MySQL: headers are set by middleware on every response.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

// Stub database: the requests below never reach a route that touches the db.
const db = new Proxy({}, { get: () => async () => null });

let server, base;
test.before(async () => {
  const app = createApp({ db, jwtSecret: 'test-secret', rate: false, serveStatic: false });
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

const cspOf = async (path) => (await fetch(`${base}${path}`)).headers.get('content-security-policy') || '';

// Razorpay Checkout = script from checkout.razorpay.com + payment iframe from api.razorpay.com.
// Block either and paying breaks (a blocked iframe renders as a blank white popup).
test('website CSP allows the Razorpay checkout script and payment iframe', async () => {
  const csp = await cspOf('/api/v1/health');
  assert.ok(csp, 'expected a Content-Security-Policy header on responses');
  assert.match(csp, /script-src[^;]*https:\/\/checkout\.razorpay\.com/, `script-src must allow checkout.razorpay.com (got "${csp}")`);
  assert.match(csp, /frame-src[^;]*https:\/\/checkout\.razorpay\.com/, `frame-src must allow checkout.razorpay.com (got "${csp}")`);
  assert.match(csp, /frame-src[^;]*https:\/\/api\.razorpay\.com/, `frame-src must allow api.razorpay.com — the payment iframe host (got "${csp}")`);
});

// The policy must stay restrictive everywhere else: no wildcards in script/frame directives.
test('website CSP keeps script-src and frame-src restrictive', async () => {
  const csp = await cspOf('/api/v1/health');
  const dir = (name) => (csp.match(new RegExp(`${name}([^;]*)`)) || [])[1] || '';
  for (const name of ['script-src', 'frame-src']) {
    assert.ok(!/(^|\s)\*(;|$)/.test(dir(name)), `${name} must not contain a bare * (got "${dir(name).trim()}")`);
  }
});
