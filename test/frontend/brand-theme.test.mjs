import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('public and admin themes use the logo red with a soft gradient on filled buttons', () => {
  const appCss = read('app/css/styles.css');
  const adminCss = read('admin/admin.css');

  for (const [name, css] of [['public', appCss], ['admin', adminCss]]) {
    assert.match(css, /--accent: #c90000; --accent-2: #dc0000; --accent-rgb: 201,0,0;/,
      `${name} theme uses the logo’s deeper red and its brighter red highlight`);
    assert.match(css, /--accent-gradient: linear-gradient\(180deg, rgba\(255,255,255,\.12\)/,
      `${name} theme defines a restrained highlight gradient`);
  }

  assert.match(appCss, /\.btn-primary \{[^}]*background-image: var\(--accent-gradient\)/,
    'public primary buttons use the branded gradient');
  assert.match(appCss, /\.btn-danger \{[^}]*background-image: var\(--accent-gradient\)/,
    'public filled danger buttons use the same gradient');
  assert.match(adminCss, /\.btn\.primary \{[^}]*background-image: var\(--accent-gradient\)/,
    'admin primary buttons use the branded gradient too');
  assert.doesNotMatch(`${appCss}\n${adminCss}`, /#e50914|#ff2a36|#ff5a5f/,
    'the old, louder reds are removed from the site themes');
});

test('web-facing branded controls use the updated logo red', () => {
  assert.match(read('app/js/data/user.js'), /PALETTE = \['#c90000'/, 'the default profile color matches the site accent');
  assert.match(read('app/js/payments.js'), /theme: \{ color: '#c90000' \}/, 'Razorpay checkout uses the site accent');
  assert.match(read('maintenance.html'), /--brand: #c90000; --brand-2: #dc0000;/, 'the maintenance page uses the same red range');
  assert.match(read('server/src/routes/unsubscribe.js'), /color:#c90000/, 'the unsubscribe page uses the same logo red');
});
