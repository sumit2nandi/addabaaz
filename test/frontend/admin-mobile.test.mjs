import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyResponsiveTableLabels } from '../../admin/js/ui.js';
import { parseHTML } from 'linkedom';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the shared Admin shell and page components stay usable at phone widths', () => {
  const html = read('admin/index.html');
  const shell = read('admin/js/console.js');
  const css = read('admin/admin.css');

  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/,
    'mobile browsers use the device width rather than a desktop layout viewport');
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.side \{ position: fixed/,
    'the shared navigation becomes a dismissible off-canvas menu');
  assert.match(shell, /layout\.classList\.toggle\('nav-open', open\)/,
    'the mobile menu state is wired in the shared shell');
  assert.doesNotMatch(css, /overflow-x\s*:\s*(?:auto|scroll)\b/,
    'no Admin page or inner panel creates a horizontal scroll area');
  assert.doesNotMatch(css, /min-width\s*:\s*max-content/,
    'tables never force their parent wider than the viewport');
  assert.match(css, /\.card\.flush \{ min-width: 0; padding: 0; overflow-x: clip; \}/,
    'wide tables are contained rather than swipeable');
  assert.match(css, /@media \(max-width: 1200px\)[\s\S]*\.tbl tbody tr \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    'narrow-screen tables reflow into compact cards');
  assert.match(css, /\.tbl tbody td::before \{[\s\S]*content: attr\(data-label\)/,
    'each card value keeps its column heading');
  assert.match(shell, /applyResponsiveTableLabels/,
    'shared Admin and Content shells label table cells after each render');
  assert.match(css, /dialog\.modal\.wide \.modal-body \.fields \{ grid-template-columns: 1fr; \}/,
    'wide edit dialogs collapse to one form column on mobile');
  assert.match(css, /\.page-head > \.row > \.btn \{ flex: 1 1 auto; min-width: 0; white-space: normal; \}/,
    'page actions wrap rather than being clipped on narrow screens');
  assert.match(css, /\.icon-btn \{ width: 44px; height: 44px; \}/,
    'small icon actions have phone-friendly touch targets');
  assert.match(css, /env\(safe-area-inset-bottom\)/,
    'bottom controls and dialogs respect mobile safe areas');
});

test('narrow-screen table cards retain labels from their semantic headers', () => {
  const { document } = parseHTML(`<main><table class="tbl">
    <thead><tr><th>Name</th><th><input aria-label="Actions"></th><th></th></tr></thead>
    <tbody><tr><td>Ada</td><td><button>Open</button></td><td>Active</td></tr>
      <tr><td colspan="3">Loading</td></tr></tbody>
  </table></main>`);
  const root = document.querySelector('main');
  applyResponsiveTableLabels(root);
  const cells = [...root.querySelectorAll('tbody tr:first-child td')];
  assert.deepEqual(cells.map((cell) => cell.getAttribute('data-label')), ['Name', 'Actions', null]);
  assert.equal(root.querySelector('tbody tr:last-child td').getAttribute('data-label'), 'Name / Actions');
});
