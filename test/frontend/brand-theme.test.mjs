import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('public and admin themes use a darker logo red with stronger button gradients', () => {
  const appCss = read('app/css/styles.css');
  const adminCss = read('admin/admin.css');

  for (const [name, css] of [['public', appCss], ['admin', adminCss]]) {
    assert.match(css, /--accent: #b80000; --accent-2: #d00000; --accent-rgb: 184,0,0;/,
      `${name} theme uses a darker logo red and its brighter red highlight`);
    assert.match(css, /--accent-gradient: linear-gradient\(180deg, rgba\(255,255,255,\.18\)/,
      `${name} theme defines a stronger highlight gradient`);
  }

  assert.match(appCss, /\.btn-primary \{[^}]*background-image: var\(--accent-gradient\)/,
    'public primary buttons use the branded gradient');
  assert.match(appCss, /\.btn-danger \{[^}]*background-image: var\(--accent-gradient\)/,
    'public filled danger buttons use the same gradient');
  assert.match(appCss, /\.subscribe-banner \{[^}]*background-image: var\(--gold-gradient\)/,
    'the Subscribe banner wears the gold gradient');
  assert.match(adminCss, /\.btn\.primary \{[^}]*background-image: var\(--accent-gradient\)/,
    'admin primary buttons use the branded gradient too');
  assert.match(appCss, /\.account-page \.btn-ghost \{[^}]*background-image: var\(--accent-gradient\)/,
    'secondary Account & Settings actions such as Copy stay red');
  assert.match(read('app/js/views/account.js'), /class="page page-narrow account-page profile-page"/,
    'the red account-action styling stays scoped to Account & Settings');
  assert.match(read('app/js/views/account.js'), /<button class="logout-link" id="signout">Sign Out<\/button>/,
    'Sign out is a brand-red footer line, outside the red button styling');
  assert.match(read('app/js/views/account-extra.js'), /class="btn btn-primary" id="refShare" data-referral-share type="button"/,
    'the referral Share action uses the branded primary button');
  assert.doesNotMatch(appCss, /#e50914|#ff2a36|#ff5a5f/, 'the old, louder reds are removed from the public theme');
  assert.doesNotMatch(adminCss, /#e50914|#ff2a36|#ff5a5f/, 'the old, louder reds are removed from the admin theme');
});

test('web-facing branded controls use the updated logo red', () => {
  assert.match(read('app/js/data/user.js'), /PALETTE = \['#b80000'/, 'the default profile color matches the site accent');
  assert.match(read('app/js/payments.js'), /theme: \{ color: '#b80000' \}/, 'Razorpay checkout uses the site accent');
  assert.match(read('maintenance.html'), /--brand: #b80000; --brand-2: #d00000;/, 'the maintenance page uses the same red range');
  assert.match(read('server/src/routes/unsubscribe.js'), /color:#d00000/, 'the unsubscribe page uses the brighter logo-red highlight for legible text');
});
