import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('SMS-only Account offers a verification step without changing the email at request time', () => {
  const view = read('app/js/views/account-extra.js');
  const adapter = read('app/js/data/adapters.js');
  const api = read('server/src/features.js');

  assert.match(view, /acc\.phoneVerified \? html`[\s\S]*?id="contactEmailForm"/,
    'phone-verified accounts can add or update an address without exposing the placeholder');
  assert.match(view, /Your current address remains active for account and billing emails until you confirm the replacement/,
    'updates keep the current verified address active until the new one is confirmed');
  assert.match(view, /won’t be used for billing or account emails until you confirm it/,
    'the UI does not promise delivery to an unverified address');
  assert.match(view, /requestAccountEmail\(email\)/);
  assert.match(adapter, /requestAccountEmail\(email\) \{ return this\.api\.post\('\/me\/email', \{ email \}\); \}/);
  assert.match(api, /api\.post\('\/me\/email'[\s\S]*?db\.emailChanges\.issue[\s\S]*?sendMailStrict/,
    'server issues the one-time token and requires successful confirmation-mail delivery');
  assert.match(api, /api\.post\('\/auth\/email-change\/verify'/);
  assert.match(api, /db\.emailChanges\.confirm\(sha256\(token\)\)/,
    'only the hashed single-use token can promote the pending address');
});

test('the email link selects the contact-email confirmation flow and keeps billing status honest', () => {
  const recover = read('app/js/views/recover.js');
  const billing = read('app/js/views/billing.js');
  const billingServer = read('server/src/billing.js');

  assert.match(recover, /ctx\.query\.emailChange === '1'/);
  assert.match(recover, /verifyAccountEmail\(token\)/);
  assert.match(recover, /SMS sign-in stays the same/);
  assert.match(billing, /u\.account\.emailIsPlaceholder \? 'Refund requested — check this page for updates'/);
  assert.match(billing, /Confirm an email in Account to send documents by email/);
  assert.match(billingServer, /if \(isPhoneEmail\(user\.email\)\) throw new BillingError\(409, 'email_not_verified'/);
  assert.match(billingServer, /if \(isPhoneEmail\(s\.email\)\) continue/);
});

test('Play Data safety guidance lists actual collection and makes the Console update explicit', () => {
  const mobile = read('docs/MOBILE.md');
  const compliance = read('docs/COMPLIANCE.md');
  const policy = read('app/js/legal-text.js');

  assert.doesNotMatch(mobile, /Declare: email \+ name \(account\), watch history \(app functionality\), no tracking/);
  assert.match(mobile, /Google Play Data safety/);
  assert.match(mobile, /must be updated by the Play Console owner/);
  assert.match(compliance, /## Google Play Data safety/);
  for (const item of ['verified phone number', 'purchase history', 'support tickets', 'push tokens', 'Google Analytics', 'pending email-change links', 'rate-limit timestamps'])
    assert.ok(compliance.includes(item), `Data safety/retention guidance includes ${item}`);
  assert.match(policy, /pending address and a hash of a one-time link token/);
  assert.match(policy, /If your account has a confirmed contact email, we email you the decision; otherwise, check Billing & invoices/);
});
