import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchRoute } from '../../app/js/routes.js';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('signed-in header shows only email beneath the name and offers accessible editing', () => {
  const account = read('app/js/views/account.js');
  assert.doesNotMatch(account, /u.account.providers|Google sign-in/);
  assert.match(account, /u.account && !u.account.emailIsPlaceholder/);
  assert.match(account, /class="muted profile-email">\$\{u.account.email\}/);
  assert.match(account, /aria-label="Edit account details"/);
  assert.match(account, /!u.account \? html`<p class="muted">\$\{identity\}/);
  assert.equal(matchRoute('/account/details').view, 'account-details');
});

test('details editor uses authenticated name updates and verified email flow; phone changes do not misuse sign-in OTP', () => {
  const source = read('app/js/views/account-details.js');
  assert.match(source, /if \(!account\).*go\('\/signin\?next=\/account\/details'/);
  assert.match(source, /updateAccountName\(name\)/);
  assert.match(source, /requestAccountEmail/);
  assert.match(source, /resendVerification/);
  assert.match(source, /href="#\/support" aria-label="Request a phone-number change"/);
  assert.doesNotMatch(source, /verifyOtp|requestOtp/);
  assert.match(source, /href="#\/profiles\?manage=1"/);
});


test('account editor has paired name fields, inline contact editing, and dirty-state save', () => {
  const source = read('app/js/views/account-details.js');
  assert.match(source, /name="firstName" autocomplete="given-name"/);
  assert.match(source, /name="lastName" autocomplete="family-name"/);
  assert.match(source, /id="saveAccount" disabled>Save Changes/);
  assert.match(source, /name === savedName/);
  assert.match(source, /id="editEmail" aria-label="Edit email address"/);
  assert.doesNotMatch(source, /class="card-panel"/);
  assert.match(read('app/css/styles.css'), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});
