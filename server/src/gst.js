/**
 * GST helpers (India). Pure functions — no I/O — so they are easy to test and audit.
 * All money is in integer paise. Prices shown to viewers are GST-INCLUSIVE; the tax is carved out of the amount paid.
 */

/** GST state / UT codes (first two digits of a GSTIN). */
export const STATES = [
  ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'],
  ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'],
  ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'],
  ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar Islands'], ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory'],
].map(([code, name]) => ({ code, name }));

// Lookup tables built from STATES: by code, and by normalised name (so "west bengal", "West-Bengal" etc. all match).
const BY_CODE = new Map(STATES.map((s) => [s.code, s]));
const norm = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const BY_NAME = new Map(STATES.map((s) => [norm(s.name), s]));

export const stateName = (code) => BY_CODE.get(code)?.name || null;
/** Accepts "29", 29 or "Karnataka" (any case) → "29", or null. */
export function resolveState(input) {
  if (input == null || input === '') return null;
  const s = String(input).trim();
  if (/^\d{1,2}$/.test(s)) { const c = s.padStart(2, '0'); return BY_CODE.has(c) ? c : null; }
  return BY_NAME.get(norm(s))?.code || null;
}

/* ---------- GSTIN ---------- */
// GSTIN = 15 characters: 2-digit state code, 10-character PAN, entity number, 'Z', and a checksum character.
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_RE = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
// Computes the checksum character (mod-36 weighted sum) that must end a valid GSTIN.
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) { const v = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(v / 36) + (v % 36); }
  return CHARS[(36 - (sum % 36)) % 36];
}
/** Format + state code + checksum. */
export function isValidGstin(g) {
  if (typeof g !== 'string') return false;
  const m = GSTIN_RE.exec(g);
  return !!m && BY_CODE.has(m[1]) && gstinCheckChar(g.slice(0, 14)) === g[14];
}
// The first two digits of a GSTIN are the state code.
export const gstinState = (g) => g.slice(0, 2);

/* ---------- tax ---------- */
/**
 * Splits a GST-inclusive amount. Intra-state → CGST + SGST (equal halves), inter-state → IGST.
 * taxable + cgst + sgst + igst always equals `totalPaise` exactly.
 */
// Intra-state sales (buyer in the seller's state) split tax equally into CGST + SGST; inter-state sales charge IGST.
// Rounding differences are pushed into the taxable value so the parts always add up to the exact total.
export function computeTax({ totalPaise, rate, intraState }) {
  if (!(rate > 0)) return { taxable: totalPaise, cgst: 0, sgst: 0, igst: 0, total: totalPaise };
  const tax = (totalPaise * rate) / (100 + rate);
  if (intraState) { const half = Math.round(tax / 2); return { taxable: totalPaise - 2 * half, cgst: half, sgst: half, igst: 0, total: totalPaise }; }
  const igst = Math.round(tax);
  return { taxable: totalPaise - igst, cgst: 0, sgst: 0, igst, total: totalPaise };
}

/** Tax split of a credit note for `amountPaise` against an invoice; the final credit note takes the exact remainder so the sums match. */
export function creditNoteSplit(invoice, prior, amountPaise) {
  // Amounts already credited by earlier credit notes; the final credit note takes the remainder so nothing is over- or under-credited.
  const sum = (k) => prior.reduce((n, c) => n + c[k], 0);
  const left = (k) => Math.max(0, invoice[k] - sum(k));
  if (amountPaise >= left('total')) return { taxable: left('taxable'), cgst: left('cgst'), sgst: left('sgst'), igst: left('igst'), total: left('total') };
  const ratio = amountPaise / invoice.total;
  const cgst = Math.round(invoice.cgst * ratio), sgst = invoice.cgst === invoice.sgst ? cgst : Math.round(invoice.sgst * ratio), igst = Math.round(invoice.igst * ratio);
  return { taxable: amountPaise - cgst - sgst - igst, cgst, sgst, igst, total: amountPaise };
}

/* ---------- financial year & numbering ---------- */
/** Indian financial year (1 Apr – 31 Mar, judged in IST) → { code: '2627', label: '2026-27' }. */
// India's financial year runs 1 April to 31 March; the code (e.g. "2627") is part of every invoice number.
export function financialYear(date = new Date()) {
  const ist = new Date(date.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear(), start = ist.getUTCMonth() >= 3 ? y : y - 1;
  const a = String(start % 100).padStart(2, '0'), b = String((start + 1) % 100).padStart(2, '0');
  return { code: a + b, label: `${start}-${b}` };
}
/** GST rule 46: an invoice number is at most 16 characters (letters, digits, "/" and "-"). PREFIX(≤4)/2627/000001 = 16. */
export const invoiceNumber = (prefix, fyCode, n) => `${prefix}/${fyCode}/${String(n).padStart(6, '0')}`;

/* ---------- money formatting ---------- */
// Formats paise as rupees with Indian digit grouping, e.g. 1234567 -> "12,345.67".
export const rupees = (paise) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Number-to-words (Indian system: thousand, lakh, crore) for the "amount in words" line that invoices need.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const below1000 = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + below100(n % 100) : '') : below100(n));
function words(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  for (const [div, name] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']]) { if (n >= div) { parts.push(words(Math.floor(n / div)) + ' ' + name); n %= div; } }
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}
/** 12345 paise → "Indian Rupees One Hundred Twenty Three and Forty Five Paise Only" */
export function amountInWords(paise) {
  const r = Math.floor(paise / 100), p = paise % 100;
  return `Indian Rupees ${words(r)}${p ? ` and ${below100(p)} Paise` : ''} Only`;
}
