// Sign-up never waits on the mail server.
//
// A hanging or dead SMTP server used to freeze the sign-up screen behind the confirmation email. The server
// now answers as soon as the account exists: the verification mail gets a short budget (SIGNUP_EMAIL_WAIT_MS)
// inside the request and otherwise finishes in the background, reported as `verificationEmailPending`; the mail
// that is sent is the welcome letter, which carries the confirmation link *and* the credit the account just
// earned, so `promos` is told not to add a second note. Referral and admin-granted credit mails are still
// dispatched without being awaited. The browser side must say "on its way"
// for a pending mail and keep the resend hint for a real failure — and the Account page really has the resend
// button the message points to. The behavioural test with a hanging transport lives in
// server/test/engagement.test.js; these are source pins for the contract between the two sides.
// Run: node --test test/frontend/signup-mail-pending.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const auth = read('app/js/views/auth.js');
const routes = read('server/src/routes/auth.js');
const promos = read('server/src/promos.js');
const app = read('server/src/app.js');
const accountExtras = read('app/js/views/account-extra.js');

test('the sign-up page tells a pending confirmation mail apart from a failed one', () => {
  assert.match(auth, /result\.verificationEmailPending/, 'the page reads the pending flag');
  assert.match(auth, /confirmation email is on its way/, 'a pending mail says so instead of freezing or failing');
  assert.match(auth, /result\.verificationEmailSent === false/, 'a real failure keeps the resend hint');
  assert.match(auth, /Resend link from Account/, 'and points at the Account page resend');
});

test('the Account page has the resend control the sign-up message points to', () => {
  assert.match(accountExtras, /id="resendVerify"/, 'the resend button exists');
  assert.match(accountExtras, /Resend Link/, 'and is labelled');
});

test('the server budgets the verification mail inside the sign-up request', () => {
  assert.match(routes, /Promise\.race\(\[settled, new Promise/, 'the mail send races a time budget');
  assert.match(routes, /verificationEmailPending = true/, 'an expired budget is reported as pending');
  assert.match(routes, /verificationEmailPending,/, 'and the response always carries the flag');
  assert.match(routes, /settled\.then\(\(ok\) => \{ if \(!ok\) warnMail/, 'a background failure is still logged, never unhandled');
  assert.match(app, /signupMailWaitMs = Number\(process\.env\.SIGNUP_EMAIL_WAIT_MS\) \|\| 5000/, 'the budget is SIGNUP_EMAIL_WAIT_MS, 5 s by default');
});

// One message per sign-up is the point of the welcome letter: pin the swap, so a future edit cannot quietly put
// the bare confirmation note back and give a new account two e-mails again.
test('the confirmation link travels inside the welcome letter', () => {
  assert.match(routes, /features\.sendWelcome\(\{ \.\.\.created, emailVerifiedAt: null \}, \{ strict: true/, 'the greeting is the mail that carries the link');
  assert.doesNotMatch(routes, /features\.sendVerification\(/, 'sign-up sends no separate confirmation note');
  assert.match(routes, /mail: 'welcome'/, 'and promos is told the credit is already announced');
  assert.match(promos, /mail !== 'welcome'/, 'the credit note is skipped on exactly that path');
  assert.match(read('server/src/features.js'), /db\.authTokens\.issue\(user\.id, 'verify', sha256\(token\), 3 \* 24 \* HOUR\)/, 'the token is the same kind /auth/verify accepts');
  assert.match(read('server/src/welcome-email.js'), /welcomeStyle/, 'and the phone rules are the reviewed ones');
});

test('promo mails are handed to the transport without being awaited', () => {
  assert.match(promos, /Promise\.resolve\(mailer\.send\(\{ to, \.\.\.built \}\)\)\.catch/, 'the send starts but is not awaited');
  assert.match(promos, /must never stall the request that earned it/, 'and the reason is written down');
});
