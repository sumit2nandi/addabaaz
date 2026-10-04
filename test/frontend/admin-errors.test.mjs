import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Admin Errors shows account context and copies a complete individual report', () => {
  const view = read('admin/js/views/errors.js');
  const ui = read('admin/js/ui.js');
  const css = read('admin/admin.css');

  assert.match(view, /<div><b>Account ID:<\/b> <code>\$\{e\.userId \|\| 'unknown \/ anonymous'\}<\/code><\/div>/,
    'recent errors show the associated account ID or that it was not resolved');
  assert.match(view, /<div><b>Account name:<\/b> \$\{e\.accountName \|\| '\(not available\)'\}<\/div>/);
  assert.match(view, /<div><b>Account email:<\/b> \$\{e\.accountEmail \|\| '\(not available\)'\}<\/div>/);
  assert.match(view, /`Account name: \$\{e\.accountName \|\| '\(not available\)'\}`/);
  assert.match(view, /`Account email: \$\{e\.accountEmail \|\| '\(not available\)'\}`/);
  assert.match(view, /data-copy-error="\$\{e\.id\}"/, 'every recent report gets its own compact Copy button');
  assert.match(view, /`User ID: \$\{e\.userId \|\| 'unknown \/ anonymous'\}`/, 'the copied report includes the account ID');
  assert.match(view, /`User agent: \$\{e\.userAgent \|\| '\(not recorded\)'\}`[\s\S]*'Stack:'/,
    'the copied report includes device and stack diagnostics');
  assert.match(view, /Failed SQL template/,
    'database errors display the failed parameterized SQL separately from the stack');
  assert.match(view, /bound parameter\(s\); values omitted/,
    'the page clearly states that bound values are not stored');
  assert.match(view, /SQL template \(bound values omitted; \$\{e\.sqlParamCount \?\? 'unknown'\} parameter\(s\)\):/,
    'copy includes the SQL template and safe parameter count');
  assert.match(view, /SQL exception details/,
    'the screen explicitly displays structured SQL driver exception details');
  assert.match(view, /\['SQL exception:', JSON\.stringify\(e\.sqlException, null, 2\)\]/,
    'the copied report includes the SQL exception metadata');
  assert.match(view, /navigator\.clipboard\?\.writeText/, 'copy uses the secure clipboard API when available');
  assert.match(view, /document\.execCommand\?\.\('copy'\)/, 'older browsers have a selection-based fallback');
  assert.match(ui, /copy: '<rect/, 'the button has a clipboard icon');
  assert.match(css, /\.error-detail-bar \{[^}]*justify-content: space-between/,
    'the copy action stays compact beside the diagnostic details');
});
