import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const appCss = read('app/css/styles.css');
const adminCss = read('admin/admin.css');

test('mobile app dialogs keep multiple actions in one equal-width row', () => {
  assert.match(appCss, /\.dialog \.dlg-body \.row\.end \{ flex-wrap: nowrap; align-items: stretch; gap: 8px; width: 100%; \}/,
    'dialog action rows never wrap on phones');
  assert.match(appCss, /\.dialog \.dlg-body \.row\.end > \.btn \{ flex: 1 1 0; min-width: 0; padding: 10px 8px; font-size: 14px; line-height: 1\.25; white-space: normal; \}/,
    'buttons share the row evenly and long labels can wrap inside their buttons');
  assert.match(appCss, /\.dialog \.dlg-body \.row\.end > \.btn:only-child \{ flex: 0 1 auto; \}/,
    'single-action dialogs keep their existing compact button size');
  assert.match(read('app/js/views/account-extra.js'), /Set a password[\s\S]*?class="row end"[\s\S]*?Email me the link/,
    'the Set a password popup uses the shared action-row layout');
  assert.match(read('app/js/ui/dialog.js'), /class="row end"[\s\S]*?Cancel[\s\S]*?id="ok"/,
    'shared confirmation popups use the same layout');
});

test('mobile Admin dialogs keep multiple actions in one equal-width row', () => {
  assert.match(adminCss, /dialog\.modal \.modal-body \.row\.end \{ flex-wrap: nowrap; align-items: stretch; gap: 8px; width: 100%; \}/,
    'Admin modal action rows never wrap on phones');
  assert.match(adminCss, /dialog\.modal \.modal-body \.row\.end > \.btn \{ flex: 1 1 0; min-width: 0; padding: 10px 8px; white-space: normal; \}/,
    'Admin modal buttons share the row evenly and long labels wrap');
  assert.match(adminCss, /dialog\.modal \.modal-body \.row\.end > \.btn:only-child \{ flex: 0 1 auto; \}/,
    'single-action Admin dialogs keep compact buttons');
});
