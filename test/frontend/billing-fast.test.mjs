// Billing & invoices (#/billing) was the slowest page in the app: it waited for the payment history and
// only then asked for the refund window (two round trips in a row), and the server answered the history
// with two extra document queries per payment.
//
// Now: both client requests go out TOGETHER, the server attaches the documents with one batched query
// each (server/test/billing-batch.test.js), and the last answer is remembered for a few seconds so
// stepping away to Plan details and straight back paints instantly. The cache is keyed to the account
// and the plan, so a purchase — or a different account — can never show a stale list.
//
// Run: node --test test/frontend/billing-fast.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.document = document;
globalThis.window = window;
window.matchMedia = () => ({ matches: false });

const { app } = await import('../../app/js/app.js');
const { default: billing } = await import('../../app/js/views/billing.js');

const payment = (id) => ({
  id, planId: 'plus-yearly', planName: 'ADDABAAZ Premium (Yearly)', provider: 'razorpay',
  amountPaise: 79900, listPricePaise: 79900, discountPaise: 0, couponCode: null, creditAppliedPaise: 0,
  paidAt: '2026-01-02T10:00:00.000Z', refundedPaise: 0,
  invoice: { id: `inv-${id}`, number: `INV/2025-26/7`, title: 'TAX INVOICE' }, creditNotes: [], refunds: [],
});

function fakeUser({ id = 'acc-1', subscription = { planId: 'plus-yearly', startedAt: '2026-01-02T10:00:00.000Z', expiresAt: '2027-01-02T10:00:00.000Z' }, history, refunds } = {}) {
  return {
    supportsAuth: true,
    account: { id, email: 'viewer@example.com', emailIsPlaceholder: false },
    subscription,
    billingHistory: history,
    remote: { refundRequests: refunds },
  };
}

async function render() {
  const root = document.createElement('main');
  await billing({ root, query: {}, path: '/billing', setTitle() {}, onCleanup() {} });
  return root;
}

test('the history and the refund window are fetched together, and the next visit paints from the cache', async () => {
  const calls = [];
  let historyDone = false, refundsStartedBeforeHistoryAnswered = null;
  app.user = fakeUser({
    id: 'acc-parallel',
    history: async () => { calls.push('history'); await new Promise((r) => setTimeout(r, 25)); historyDone = true; return [payment('p1')]; },
    refunds: async () => { calls.push('refunds'); refundsStartedBeforeHistoryAnswered = !historyDone; return { requests: [], windowDays: 7 }; },
  });

  const root = await render();
  assert.equal(refundsStartedBeforeHistoryAnswered, true, 'the refund window is already in flight while the history is still coming back (one round trip, not two in a row)');
  assert.deepEqual(calls, ['history', 'refunds']);
  assert.match(root.textContent, /Tax invoice INV\/2025-26\/7/, 'the page still renders the payment and its document');

  // Straight back to Billing: served from the short cache, with no second round trip.
  const again = await render();
  assert.deepEqual(calls, ['history', 'refunds'], 'no further requests inside the cache window');
  assert.match(again.textContent, /Tax invoice INV\/2025-26\/7/);

  // Buying a plan changes the cache key, so the new payment is fetched instead of the cached list.
  app.user = { ...app.user, subscription: { planId: 'plus-monthly', startedAt: '2026-02-01T09:00:00.000Z', expiresAt: '2026-03-01T09:00:00.000Z' } };
  await render();
  assert.deepEqual(calls, ['history', 'refunds', 'history', 'refunds'], 'a new plan is never served from the cache');

  // A different account (sign-out / sign-in) is a different key too.
  app.user = fakeUser({
    id: 'acc-other',
    history: async () => { calls.push('history'); return []; },
    refunds: async () => { calls.push('refunds'); return { requests: [], windowDays: 7 }; },
  });
  await render();
  assert.equal(calls.filter((c) => c === 'history').length, 3);
});

test('a failed history still shows the error card and the way back to plan details', async () => {
  app.user = fakeUser({
    id: 'acc-fail',
    history: async () => { throw new Error('server exploded'); },
    refunds: async () => { throw new Error('server exploded'); },
  });
  const root = await render();
  assert.match(root.textContent, /Couldn’t load your billing history/, 'the viewer is told, plainly');
    assert.ok(root.querySelector('.page-head-title-row a.page-back[href="#/plans"]'), 'with the plain-arrow back link beside the title');
});

test('the view keeps one parallel fetch, one cache and no per-payment requests', () => {
  const view = read('app/js/views/billing.js');
  assert.match(view, /const \[history, refunds\] = await Promise\.allSettled\(\[u\.billingHistory\(\), u\.remote\.refundRequests\(\)\]\)/,
    'both reads are awaited together');
  assert.doesNotMatch(view, /await u\.billingHistory\(\)/, 'the history is never awaited on its own before the refund window');
  assert.match(view, /const CACHE_MS = 30_000;/, 'the answer is reused for half a minute');
  assert.match(view, /const cacheKey = \(\) => \{/, 'keyed to the account and the plan');
  assert.match(view, /cache = \{ key, at: Date\.now\(\), items, rr \};/);
  // Sending a refund request clears it, so the outcome is never read from a cached list.
  assert.match(read('app/js/views/billing.js'), /close\(\); cache = null;/);
});
