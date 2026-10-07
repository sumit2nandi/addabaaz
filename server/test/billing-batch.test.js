// The Billing page's read path, without a database.
//
// `db.payments.listForUser()` used to run two extra queries for EVERY payment (its invoices and its
// refunds), so a viewer with a dozen payments waited on 25 queries before the page could paint anything.
// The documents are now fetched with one batched query each and grouped in memory; this test proves the
// grouping (and the empty/short-circuit cases) against a fake query function, and pins the callers so the
// per-row loop cannot quietly come back.
//
// Run: node --test server/test/billing-batch.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { billingDb } from '../src/db-billing.js';

// The real module maps dates through `iso` (db.js); the fake keeps the Date objects as they are.
const iso = (d) => (d instanceof Date ? d.toISOString() : d == null ? null : d);

function fakeDb(rows) {
  const calls = [];
  const q = async (sql, params) => { calls.push({ sql, params }); return rows(sql, params); };
  return { calls, db: billingDb({ q, tx: () => {}, self: {}, iso }) };
}

const invoiceRow = (over = {}) => ({
  id: 'inv1', number: 'INV/2025-26/1', kind: 'invoice', payment_id: 'p1', refund_id: null, parent_id: null, user_id: 'u1',
  fy: '2526', issued_at: new Date('2026-01-02T10:00:00Z'), taxable_paise: 100, cgst_paise: 9, sgst_paise: 9, igst_paise: 0,
  total_paise: 118, gst_rate: '18', doc: '{"title":"TAX INVOICE"}', ...over,
});
const refundRow = (over = {}) => ({
  id: 'r1', payment_id: 'p1', provider_refund_id: 'rfnd_1', amount_paise: 118, status: 'processed', reason: null,
  source: 'admin', revoked_access: 0, created_at: new Date('2026-01-03T10:00:00Z'), updated_at: new Date('2026-01-03T10:00:00Z'), ...over,
});

test('invoices.forPayments takes every payment\'s documents in ONE query, grouped by payment', async () => {
  const rows = [
    invoiceRow(),
    invoiceRow({ id: 'inv2', number: 'INV/2025-26/2', payment_id: 'p2' }),
    invoiceRow({ id: 'inv3', number: 'CN/2025-26/1', kind: 'credit_note', payment_id: 'p1' }),
  ];
  const { calls, db } = fakeDb(() => rows);

  const out = await db.invoices.forPayments(['p1', 'p2']);
  assert.equal(calls.length, 1, 'one query for the whole page of payments');
  assert.match(calls[0].sql, /WHERE payment_id IN \(\?,\?\)/);
  assert.deepEqual(calls[0].params, ['p1', 'p2'], 'parameterised, one placeholder per payment');
  assert.deepEqual([...out.keys()], ['p1', 'p2'], 'every requested payment gets an (empty) list');
  assert.deepEqual(out.get('p1').map((i) => i.number), ['INV/2025-26/1', 'CN/2025-26/1'], 'invoices and credit notes stay together, in order');
  assert.deepEqual(out.get('p2').map((i) => i.number), ['INV/2025-26/2']);
  assert.equal(out.get('p1')[0].doc.title, 'TAX INVOICE', 'the JSON document snapshot is parsed');
});

test('refunds.forPayments does the same, and an empty page costs no query at all', async () => {
  const { calls, db } = fakeDb(() => [refundRow(), refundRow({ id: 'r2', payment_id: 'p2', status: 'pending' })]);

  const out = await db.refunds.forPayments(['p1', 'p2']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM refunds WHERE payment_id IN \(\?,\?\)/);
  assert.deepEqual(out.get('p1').map((r) => r.status), ['processed']);
  assert.deepEqual(out.get('p2').map((r) => r.status), ['pending']);
  assert.equal(out.get('p1')[0].paymentId, 'p1', 'grouped by the payment the refund belongs to');

  const none = await db.refunds.forPayments([]);
  assert.equal(calls.length, 1, 'no payments on the page, no query');
  assert.equal(none.size, 0);
});

test('the payment lists attach documents with the batched lookups, never one query per payment', () => {
  const source = fs.readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
  assert.match(source, /async function attachDocuments\(rows\) \{/);
  assert.match(source, /Promise\.all\(\[self\.invoices\.forPayments\(ids\), self\.refunds\.forPayments\(ids\)\]\)/, 'one batched lookup each, in parallel');
  assert.match(source, /for \(const p of rows\) \{ p\.invoices = invoices\.get\(p\.id\) \|\| \[\]; p\.refunds = refunds\.get\(p\.id\) \|\| \[\]; \}/, 'then grouped in memory');
  assert.doesNotMatch(source, /for \(const p of rows\) \{ p\.invoices = await/, 'the per-payment queries are gone');
  assert.doesNotMatch(source, /forPayment\(p\.id\)/, 'no caller is left looping over rows');
  assert.equal((source.match(/return attachDocuments\(rows\);/g) || []).length, 2, 'the viewer history and the admin list both use it');
});
