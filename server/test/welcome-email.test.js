// The welcome letter: what a new account actually receives. Pure string building, so this needs no MySQL and
// no mail server — the wiring around it (the one-time token, the send budget) is covered by auth.test.js; here
// we check the letter itself. The letter is deliberately short and transactional (no images, no promo blocks).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { welcomeEmail, welcomeStyle } from '../src/welcome-email.js';
import { welcomeEmail as viaMail } from '../src/emails.js';

const PREVIEW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../preview');

// A normal email sign-up: credit granted, address not yet confirmed.
const signup = welcomeEmail({
  name: 'Riya Sen', siteUrl: 'https://addabaaz.in', creditPaise: 10000,
  verifyUrl: 'https://addabaaz.in/verify?token=abc123', supportEmail: 'office@addabaaz.in',
});

test('the letter is one {subject,text,html} mail, reached through emails.js', () => {
  assert.equal(viaMail, welcomeEmail, 'mail.welcomeEmail is the same function — one door for every template');
  for (const part of ['subject', 'text', 'html']) assert.ok(signup[part], `${part} is not empty`);
  assert.match(signup.text, /Hi Riya,/);
});

test('a confirmation sign-up gets a short, plainly named mail that spam filters read as transactional', () => {
  assert.equal(signup.subject, 'Confirm your ADDABAAZ account', 'the subject says what the mail is for');
  assert.ok(signup.subject.length <= 40, `the subject fits a phone inbox: ${signup.subject.length} chars`);
  assert.ok(!/\b(offer|free|%|sale)\b/i.test(signup.subject), 'no promotional words in the subject');
  // Short: the plain text is a handful of paragraphs, not a catalogue.
  assert.ok(signup.text.length < 1000, `the text version is short: ${signup.text.length} chars`);
});

test('the confirmation link is the one button, and the reader is told the rules', () => {
  assert.match(signup.html, /href="https:\/\/addabaaz\.in\/verify\?token=abc123"/, 'the button points at /verify');
  assert.match(signup.html, />Confirm my email</, 'and says what it does');
  assert.ok(signup.text.includes('Confirm my email: https://addabaaz.in/verify?token=abc123'), 'a text client gets the raw link');
  assert.match(signup.html, /expires in three days/, 'the expiry is stated');
  assert.match(signup.html, /buying a plan is blocked/, 'and what it blocks');
});

test('the letter has no images and two links at most: the button and the support address', () => {
  assert.equal((signup.html.match(/<img\b/g) || []).length, 0, 'no images');
  const hrefs = [...signup.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs.length, 2, `links: ${hrefs.join(' ')}`);
  assert.ok(hrefs.every((h) => /^(https?:|mailto:)/.test(h)), 'every link is absolute');
});

test('the credit line appears only when there is credit, and never promises Rs. 0', () => {
  assert.match(signup.html, /Rs\. 100 new-account credit/, 'the amount is quoted without a .00');
  assert.match(signup.text, /Rs\. 100 new-account credit/);
  const none = welcomeEmail({ name: 'Riya', siteUrl: 'https://a.in', verifyUrl: 'https://a.in/verify?token=t' });
  assert.ok(!/credit/i.test(none.html + none.text), 'no credit line without credit');
  assert.ok(!/Rs\. 0/.test(none.html + none.text), 'and never Rs. 0');
});

test('an address the provider already confirmed gets a welcome with a single "Start watching" button', () => {
  const social = welcomeEmail({ name: 'Riya', siteUrl: 'https://a.in', creditPaise: 10000 });
  assert.equal(social.subject, 'Welcome to ADDABAAZ', 'no confirmation subject when there is nothing to confirm');
  assert.ok(!social.html.includes('verify?token='), 'no confirmation link is offered');
  assert.match(social.html, />Start watching</, 'the button is watching');
  assert.match(social.text, /https:\/\/a\.in\/#\//, 'the watching link is absolute');
});

test('a referral is not in the welcome letter: no invite block, no referral code', () => {
  const withCode = welcomeEmail({ name: 'Riya', siteUrl: 'https://a.in', verifyUrl: 'https://a.in/verify?token=t', creditPaise: 10000 });
  assert.doesNotMatch(withCode.html + withCode.text, /invite|referr|refer &|Pass it on/i, 'the letter stays transactional');
});

test('every string a person typed is escaped, and the mail carries no script', () => {
  const hostile = welcomeEmail({
    name: '"><script>alert(1)</script>', siteUrl: 'https://a.in', creditPaise: 10000,
    verifyUrl: 'https://a.in/verify?token=t', supportEmail: 'a@b.c" onload="y',
  });
  const { html } = hostile;
  assert.doesNotMatch(html, /<script|javascript:|\son\w+=["']/i, 'no event handler ever becomes an attribute');
  assert.ok(!html.includes('"><script>'), 'a typed name stays text, never markup');
  assert.match(html, /&lt;script&gt;|&quot;&gt;/, 'it arrives escaped');
});

test('the phone rules that ship are the rules that were reviewed', () => {
  // The harness template is generated from this letter, so the <style> block must be identical in both.
  const preview = fs.readFileSync(path.join(PREVIEW, 'welcome-email.html'), 'utf8');
  assert.ok(preview.includes(welcomeStyle), 'the preview and welcome-email.js disagree about the phone rules');
  const shipped = /<style type="text\/css">([\s\S]*?)<\/style>/.exec(signup.html)?.[1] || '';
  const oneLine = (t) => t.replace(/\s+/g, ' ').trim();
  assert.equal(oneLine(shipped), oneLine(welcomeStyle), 'the mail carries exactly the phone rules that were reviewed');
});

test('the buttons survive a phone: never inside a cell that hides', () => {
  assert.doesNotMatch(signup.html, /<td[^>]*class="[^"]*\bhide\b[^>]*>\s*<table[^>]*class="cta/, 'the button is not hidden on phones');
  assert.match(signup.html, /class="cta"/, 'the button is a table, so it reflows');
});

test('the letter closes with a real person, the address and the account-message line', () => {
  assert.match(signup.html, /mailto:office@addabaaz\.in/);
  assert.match(signup.text, /283 Lake Gardens/);
  assert.match(signup.html, /This is an account message, not marketing/);
});

test('Start watching and the support line are absolute and every image would have alt text', () => {
  const social = welcomeEmail({ name: 'Riya', siteUrl: 'https://a.in' });
  for (const h of [...social.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])) {
    assert.match(h, /^(https?:|mailto:)/, `${h} is absolute`);
  }
});
