// Unit tests for the pure GST helpers (state codes, GSTIN checksum, tax split, financial year, amounts in words). No database needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, resolveState, stateName, isValidGstin, gstinCheckChar, computeTax, creditNoteSplit, financialYear, invoiceNumber, amountInWords, rupees } from '../src/gst.js';
import { billingConfigFromEnv } from '../src/billing.js';

const GSTIN = '27AAPFU0939F1ZV';          // well-known sample GSTIN (Maharashtra)

test('states: codes and lookups', () => {
  assert.equal(STATES.length, 37); assert.equal(new Set(STATES.map((s) => s.code)).size, 37);
  assert.equal(resolveState('29'), '29'); assert.equal(resolveState(7), '07'); assert.equal(resolveState('karnataka'), '29'); assert.equal(resolveState('  West   Bengal'.replace(/\s+/, ' ')), '19');
  assert.equal(resolveState('Jammu and Kashmir'), '01'); assert.equal(resolveState('99'), null); assert.equal(resolveState('Narnia'), null); assert.equal(resolveState(''), null); assert.equal(resolveState(null), null);
  assert.equal(stateName('27'), 'Maharashtra');
});

test('GSTIN: format, state and checksum', () => {
  assert.equal(isValidGstin(GSTIN), true);
  assert.equal(gstinCheckChar(GSTIN.slice(0, 14)), 'V');
  assert.equal(isValidGstin('27AAPFU0939F1ZX'), false, 'bad checksum');
  assert.equal(isValidGstin('99AAPFU0939F1Z' + gstinCheckChar('99AAPFU0939F1Z')), false, 'unknown state code');
  assert.equal(isValidGstin('27aapfu0939f1zv'), false, 'must be upper-case (callers normalise)');
  assert.equal(isValidGstin('27AAPFU0939F1Z'), false); assert.equal(isValidGstin(null), false); assert.equal(isValidGstin(''), false);
});

test('tax: inclusive prices split into taxable + GST, always summing exactly', () => {
  const intra = computeTax({ totalPaise: 9900, rate: 18, intraState: true });
  assert.deepEqual(intra, { taxable: 8390, cgst: 755, sgst: 755, igst: 0, total: 9900 });
  const inter = computeTax({ totalPaise: 9900, rate: 18, intraState: false });
  assert.deepEqual(inter, { taxable: 8390, cgst: 0, sgst: 0, igst: 1510, total: 9900 });
  assert.deepEqual(computeTax({ totalPaise: 79900, rate: 18, intraState: false }), { taxable: 67712, cgst: 0, sgst: 0, igst: 12188, total: 79900 });
  assert.deepEqual(computeTax({ totalPaise: 5000, rate: 0, intraState: true }), { taxable: 5000, cgst: 0, sgst: 0, igst: 0, total: 5000 });
  for (let p = 100; p <= 200000; p += 137) for (const intraState of [true, false]) {
    const t = computeTax({ totalPaise: p, rate: 18, intraState }); assert.equal(t.taxable + t.cgst + t.sgst + t.igst, p); assert.equal(t.cgst, t.sgst);
    assert.ok(Math.abs(t.cgst + t.sgst + t.igst - (p * 18) / 118) <= 1, 'tax within one paisa of the exact figure');
  }
});

test('credit notes: partial refunds are proportional, the last one takes the exact remainder', () => {
  const inv = computeTax({ totalPaise: 9900, rate: 18, intraState: true });
  const a = creditNoteSplit(inv, [], 3000);
  assert.equal(a.total, 3000); assert.equal(a.taxable + a.cgst + a.sgst + a.igst, 3000); assert.equal(a.cgst, a.sgst);
  const b = creditNoteSplit(inv, [a], 6900);          // everything that's left
  assert.equal(a.total + b.total, 9900); assert.equal(a.taxable + b.taxable, inv.taxable); assert.equal(a.cgst + b.cgst, inv.cgst); assert.equal(a.sgst + b.sgst, inv.sgst);
  assert.deepEqual(creditNoteSplit(inv, [], 9900), inv);
});

test('financial year runs 1 Apr – 31 Mar in IST; numbers fit the 16-character legal limit', () => {
  assert.deepEqual(financialYear(new Date('2026-03-31T18:29:59Z')), { code: '2526', label: '2025-26' });      // 23:59:59 IST on 31 Mar
  assert.deepEqual(financialYear(new Date('2026-03-31T18:30:00Z')), { code: '2627', label: '2026-27' });      // midnight IST on 1 Apr
  assert.deepEqual(financialYear(new Date('2026-12-31T00:00:00Z')), { code: '2627', label: '2026-27' });
  assert.deepEqual(financialYear(new Date('2099-06-01T00:00:00Z')), { code: '9900', label: '2099-00' });
  assert.equal(invoiceNumber('AB', '2627', 1), 'AB/2627/000001'); assert.equal(invoiceNumber('ABCD', '2627', 999999).length, 16);
});

test('amounts: rupees and words', () => {
  assert.equal(rupees(9900), '99.00'); assert.equal(rupees(123456789), '12,34,567.89');
  assert.equal(amountInWords(9900), 'Indian Rupees Ninety Nine Only');
  assert.equal(amountInWords(12345), 'Indian Rupees One Hundred Twenty Three and Forty Five Paise Only');
  assert.equal(amountInWords(10_000_000), 'Indian Rupees One Lakh Only');
  assert.equal(amountInWords(250_000_000_00), 'Indian Rupees Twenty Five Crore Only');
  assert.equal(amountInWords(100), 'Indian Rupees One Only'); assert.equal(amountInWords(5), 'Indian Rupees Zero and Five Paise Only');
});

test('billing config from the environment', () => {
  const off = billingConfigFromEnv({});
  assert.equal(off.gstEnabled, false); assert.equal(off.rate, 0); assert.equal(off.invoicePrefix, 'AB'); assert.equal(off.seller.gstin, null);
  const on = billingConfigFromEnv({ GSTIN: GSTIN.toLowerCase(), GST_LEGAL_NAME: 'Adda Media LLP', BUSINESS_ADDRESS: 'Line 1\\nLine 2', INVOICE_PREFIX: 'adda', SUPPORT_EMAIL: 'help@addabaaz.in', PUBLIC_SITE_URL: 'https://addabaaz.in/' });
  assert.equal(on.gstEnabled, true); assert.equal(on.rate, 18); assert.equal(on.sac, '998439'); assert.equal(on.seller.stateCode, '27'); assert.equal(on.seller.stateName, 'Maharashtra');
  assert.equal(on.invoicePrefix, 'ADDA'); assert.equal(on.seller.address, 'Line 1\nLine 2'); assert.equal(on.siteUrl, 'https://addabaaz.in');
  assert.equal(billingConfigFromEnv({ BUSINESS_STATE: 'Kerala' }).seller.stateCode, '32');
  assert.throws(() => billingConfigFromEnv({ GSTIN: '27AAPFU0939F1ZX' }), /not a valid GSTIN/);
  assert.throws(() => billingConfigFromEnv({ BUSINESS_STATE: 'Atlantis' }), /BUSINESS_STATE/);
  assert.throws(() => billingConfigFromEnv({ INVOICE_PREFIX: 'TOOLONG' }), /INVOICE_PREFIX/);
  assert.throws(() => billingConfigFromEnv({ GSTIN, GST_RATE: '99' }), /GST_RATE/);
});
