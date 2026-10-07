import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchRoute } from '../../app/js/routes.js';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('signed-in header hides account contact details and offers accessible editing', () => {
  const account = read('app/js/views/account.js');
  assert.doesNotMatch(account, /u.account.email|u.account.providers/);
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
  assert.match(source, /href="#\/support">Request a phone-number change/);
  assert.doesNotMatch(source, /verifyOtp|requestOtp/);
  assert.match(source, /href="#\/profiles\?manage=1"/);
});
