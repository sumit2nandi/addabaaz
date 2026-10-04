import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
  assert.match(css, /\.card\.flush \{[^}]*overflow-x: auto/,
    'wide admin tables scroll inside their cards instead of widening the page');
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.card\.flush > \.tbl \{ min-width: max-content; \}/,
    'table columns remain readable and swipeable on phones');
  assert.match(css, /dialog\.modal\.wide \.modal-body \.fields \{ grid-template-columns: 1fr; \}/,
    'wide edit dialogs collapse to one form column on mobile');
  assert.match(css, /\.page-head > \.row > \.btn \{ flex: 1 1 auto; min-width: 0; white-space: normal; \}/,
    'page actions wrap rather than being clipped on narrow screens');
  assert.match(css, /\.icon-btn \{ width: 44px; height: 44px; \}/,
    'small icon actions have phone-friendly touch targets');
  assert.match(css, /env\(safe-area-inset-bottom\)/,
    'bottom controls and dialogs respect mobile safe areas');
});
