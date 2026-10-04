// The two console complaints from the same message:
//
//   "Admin pages should show loaders while loading the page in background" — the router used to clear the
//   page before running the page module, so a page that fetched its data first showed an empty column;
//   pages that paint their frame first showed an empty frame.
//   "Why is SMS not showing in admin system status" — MSG91 was invisible in the setup checklist.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------------------------------------------------------------- the loaders */

test('the console shows a named loader until the page has painted', () => {
  const console_ = read('admin/js/console.js');
  assert.match(console_, /import \{ html, \$, \$\$, icon, errMsg, guard, loadingPage, applyResponsiveTableLabels \} from '\.\/ui\.js';/);
  assert.match(console_, /const pageLabel = \(id\) => \{ for \(const \[, items\] of nav\)/, 'the loader can name the page');
  assert.match(console_, /main\.innerHTML = loadingPage\(pageLabel\(path\.split\('\/'\)\[0\]\)\)\.s;/, 'it is set before the page module is even fetched');
  // The old code emptied the column before running the page — that is what caused the blank screen.
  assert.doesNotMatch(console_, /main\.innerHTML = '';\s*await mod\.default/, 'the placeholder is left for the page to replace');
  assert.match(console_, /\/\/ No clearing here: whatever the page paints replaces the placeholder\./, 'and the reason is written down');
});

test('placeholder pieces exist and shimmer (with a reduced-motion escape)', () => {
  const ui = read('admin/js/ui.js');
  assert.match(ui, /export const loadingPage = \(what = ''\)/, 'a whole-page spinner');
  assert.match(ui, /role="status" aria-live="polite"/, 'announced to screen readers');
  assert.match(ui, /export const loadingLines = \(n = 4, \{ card = true \} = \{\}\)/, 'shimmering lines for content');
  assert.match(ui, /export const loadingTable = \(rows = 6, cols = 4\)/, 'placeholder rows for a list');
  const css = read('admin/admin.css');
  assert.match(css, /\.sk-line \{ display: block; height: 12px; border-radius: 6px;/, 'the shimmer bar is styled');
  assert.match(css, /@keyframes sk-shimmer/, 'and animated');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.sk-line \{ animation: none; \}/, 'motion-sensitive viewers get a still placeholder');
});

test('pages that paint their frame before fetching show placeholders inside it', () => {
  const users = read('admin/js/views/users.js');
  assert.match(users, /<div id="list">\$\{loadingTable\(8, 4\)\}<\/div>/, 'Users: rows until the first page arrives');
  assert.match(read('admin/js/views/audit.js'), /<div id="list">\$\{loadingTable\(10, 3\)\}<\/div>/, 'Audit log too');
  assert.match(read('admin/js/views/comments.js'), /<div id="list">\$\{loadingLines\(4\)\}<\/div>/, 'Comments: shimmering cards');
  // The content overview already had a hand-written spinner; it now uses the shared one.
  const overview = read('admin/js/views/content-overview.js');
  assert.match(overview, /root\.innerHTML = loadingPage\('the content overview'\)\.s;/);
  assert.doesNotMatch(overview, /class="loading"><span class="spin"/, 'no second copy of the markup');
});

test('the placeholders render the markup the pages then replace', async () => {
  const { parseHTML } = await import('linkedom');
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.window = window; globalThis.document = document; window.location = globalThis.location;
  const { loadingPage, loadingLines, loadingTable } = await import('../../admin/js/ui.js');
  const box = document.createElement('div');
  box.innerHTML = loadingPage('Payments & refunds').s;
  assert.equal(box.querySelector('.loading')?.textContent.trim(), 'Loading Payments & refunds…', 'the loader names the page');
  assert.ok(box.querySelector('.spin'), 'with the spinner');
  box.innerHTML = loadingTable(3, 2).s;
  assert.equal(box.querySelectorAll('tr.sk-row').length, 3, 'three placeholder rows');
  assert.equal(box.querySelectorAll('tr.sk-row:first-child td').length, 2, 'each with the right number of cells');
  assert.equal(box.querySelector('.card').getAttribute('aria-label'), 'Loading', 'and a label for screen readers');
  box.innerHTML = loadingLines(2).s;
  assert.equal(box.querySelectorAll('.sk-line').length, 2);
  assert.ok(box.querySelector('.card .sk'), 'lines sit inside a card by default');
  box.innerHTML = loadingLines(2, { card: false }).s;
  assert.equal(box.querySelector('.card'), null, 'or bare, for a container that is already a card');
});

/* ---------------------------------------------------------------- the SMS row */

test('SMS sign-in is visible in the admin console instead of only in the server log', () => {
  // The server side (row + test endpoint) is covered by server/test/sms-health.test.js; this pins the
  // console side, which is what the operator actually looks at.
  const dashboard = read('admin/js/views/dashboard.js');
  assert.match(dashboard, /const smsConfigured = health\.checks\.find\(\(c\) => c\.id === 'sms'\)\?\.ok;/);
  assert.match(dashboard, /id="smsTest">Send test SMS…</, 'a way to prove delivery works');
  assert.match(dashboard, /formModal\(\{\n    title: 'Send a test SMS',/, 'it asks for a number');
  assert.match(dashboard, /standard SMS charges apply/, 'and says that it costs money');
  // The row's own text comes from the server, so the console just prints every check in order.
  assert.match(dashboard, /\$\{health\.checks\.some\(\(c\) => c\.level === 'info' \|\| c\.ok\) \? html`<details class="card sys">/, 'the System status panel is shown when there is anything to report');
  assert.match(dashboard, /health\.checks\.map\(\(c\) => html`<li class="\$\{c\.level\}">\$\{icon\(c\.ok \? 'check' : c\.level === 'info' \? 'info' : 'alert', 16\)\}/);
});

test('the SMS row cannot leak secrets and the docs say where to configure it', () => {
  const admin = read('server/src/admin.js');
  assert.doesNotMatch(admin, /MSG91_AUTH_KEY \|\| ''\)\.slice|env\.MSG91_AUTH_KEY \}/, 'never prints the key');
  const doc = read('docs/MSG91.md');
  assert.match(doc, /Admin → Dashboard → System status/, 'the doc points at the new row');
  assert.match(doc, /Send test SMS/, 'and at the diagnostic');
});
