// The accounting CSV export, with no database: the sales register is opened in a spreadsheet by the
// operator, and several of its columns are text a buyer typed at checkout (billing name, GSTIN). A cell
// that begins with `=`, `+`, `-`, `@` or a tab is *evaluated* by Excel/Sheets/Numbers, so an account whose
// name is `=HYPERLINK(...)` turns a routine export into payload execution on the admin's machine
// (CWE-1236). Neutralising must not break the numbers: credit notes are deliberately written as negative
// amounts so an accountant's column totals net out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilling, billingConfigFromEnv } from '../src/billing.js';

const quiet = { error() {}, warn() {}, log() {} };

const invoiceRow = (buyer, over = {}) => ({
  kind: 'invoice', number: 'AB-1', issuedAt: '2026-04-01T09:30:00.000Z',
  doc: { title: 'TAX INVOICE', buyer: { name: buyer, gstin: null }, placeOfSupply: 'West Bengal (19)' },
  taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, total: 118000, gstRate: 18, ...over,
});

/** Renders the register for these invoice rows (only `db.invoices.register` is touched). */
async function exportCsv(rows) {
  const billing = createBilling({
    db: { invoices: { register: async () => rows } },
    payments: { provider: 'none' },
    mailer: { provider: 'none', send: async () => ({ sent: false }) },
    config: billingConfigFromEnv({}),
    log: quiet,
  });
  return billing.registerCsv(new Date('2026-04-01T00:00:00+05:30'), new Date('2026-05-01T00:00:00+05:30'));
}

/** One CSV line → its raw cells, quotes intact (a quoted cell keeps its "" doubling). */
function rawCells(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      cur += ch;
      if (ch === '"') { if (line[i + 1] === '"') cur += line[++i]; else quoted = false; }
      continue;
    }
    if (ch === '"') { quoted = true; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
/** The value a spreadsheet actually shows for a raw cell (outer quotes removed, "" folded to "). */
const shown = (cell) => (cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell);
const dataCells = (csv, row = 1) => rawCells(csv.split('\r\n').filter((l) => l !== '')[row]);

// Columns: Document, Number, Date, Against, Customer, Customer GSTIN, Place of supply, Taxable, CGST, SGST, IGST, Total, Rate
const CUSTOMER = 4, MONEY = 7;

test('csv: a formula in the buyer name is neutralised but still readable', async () => {
  for (const evil of ["=cmd|'/C calc'!A0", '=1+1', '+1+1', '@SUM(1,2)', '\t=1', '\r=1', '-1+1']) {
    const cell = dataCells(await exportCsv([invoiceRow(evil)]))[CUSTOMER];
    const value = shown(cell);
    assert.ok(value.startsWith("'"), `${JSON.stringify(evil)} must carry the spreadsheet "literal text" marker (got ${JSON.stringify(cell)})`);
    assert.equal(value.slice(1), evil, 'the typed value is preserved, so the operator can still read who paid');
  }
});

test('csv: no exported cell can trigger the formula engine', async () => {
  const hostile = `=cmd|'/C calc'!A0`;
  const rows = [
    invoiceRow(hostile),
    invoiceRow('Acme', { doc: { title: 'TAX INVOICE', buyer: { name: 'Acme', gstin: `=HYPERLINK("http://evil/","x")` }, placeOfSupply: hostile } }),
    invoiceRow('+1'), invoiceRow('@SUM(A1:A9)'),
  ];
  const out = await exportCsv(rows);
  const lines = out.split('\r\n').filter((l) => l !== '');
  for (const line of lines.slice(1)) {
    for (const cell of rawCells(line)) {
      const value = shown(cell);
      // A number may legitimately begin with '-' (credit notes); nothing else may look like a formula.
      const numeric = /^[+-]?\d*\.?\d+$/.test(value);
      assert.ok(numeric || !/^[=+\-@\t\r]/.test(value), `unsafe cell ${JSON.stringify(cell)} in ${JSON.stringify(line)}`);
    }
  }
});

test('csv: ordinary names are untouched', async () => {
  const out = await exportCsv([invoiceRow('Shahid Traders')]);
  assert.equal(shown(dataCells(out)[CUSTOMER]), 'Shahid Traders');
  assert.ok(!out.includes("'Shahid"), 'a plain name must not gain a marker');
});

test('csv: numbers keep their sign so credit notes still net out', async () => {
  const rows = [
    invoiceRow('Regular Buyer'),
    invoiceRow('Refunded Buyer', {
      kind: 'credit_note',
      doc: { title: 'CREDIT NOTE', refers: { number: 'AB-1' }, buyer: { name: 'Refunded Buyer', gstin: null }, placeOfSupply: 'West Bengal (19)' },
      taxable: 50000, cgst: 4500, sgst: 4500, igst: 0, total: 59000,
    }),
  ];
  const out = await exportCsv(rows);
  const [paid, credited] = [dataCells(out, 1), dataCells(out, 2)];
  assert.deepEqual(paid.slice(MONEY, MONEY + 5).map(Number), [1000, 90, 90, 0, 1180]);
  assert.deepEqual(credited.slice(MONEY, MONEY + 5).map(Number), [-500, -45, -45, 0, -590]);
  assert.ok(credited.slice(MONEY, MONEY + 5).every((c) => !c.includes("'")), 'amounts must not be marked as text, or the accountant totals break');
});

test('csv: quoting and the marker combine correctly', async () => {
  // Starts with '=' AND contains a comma and quotes: neutralised first, then CSV-quoted.
  const cell = dataCells(await exportCsv([invoiceRow('=1,"x"')]))[CUSTOMER];
  assert.ok(cell.startsWith('"'), `a cell holding a comma and quotes must be quoted, got ${JSON.stringify(cell)}`);
  assert.equal(shown(cell), `'=1,"x"`);
});

test('csv: an invoice number built from a hostile INVOICE_PREFIX cannot escape as a formula', async () => {
  // The prefix is validated (1–4 letters/digits) in billingConfigFromEnv; the export must stay inert
  // even if a row was written before that validation existed.
  const out = await exportCsv([invoiceRow('Acme', { number: '=AB-1' })]);
  assert.equal(shown(dataCells(out)[1]), `'=AB-1`);
});

test('csv: the header row is unchanged', async () => {
  const out = await exportCsv([]);
  assert.equal(out.split('\r\n')[0], 'Document,Number,Date (IST),Against,Customer,Customer GSTIN,Place of supply,Taxable value,CGST,SGST,IGST,Total,GST rate %');
  assert.ok(out.endsWith('\r\n'), 'the file ends with a line break, as spreadsheets and `wc -l` expect');
});
