// The welcome letter: what a new account actually receives. Pure string building, so this needs no MySQL and
// no mail server — the wiring around it (the one-time token, the promo credit, the send budget) is covered by
// auth.test.js / promos.test.js; here we check the letter itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { welcomeEmail, welcomeStyle } from '../src/welcome-email.js';
import { welcomeEmail as viaMail } from '../src/emails.js';

const PREVIEW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../preview');

// A normal email sign-up: promos on, address not yet confirmed, a referral code minted for the account.
const signup = welcomeEmail({
  name: 'Riya Sen', siteUrl: 'https://addabaaz.in', creditPaise: 10000, balancePaise: 10000,
  verifyUrl: 'https://addabaaz.in/verify?token=abc123', inviteCode: 'AB12CD34', supportEmail: 'office@addabaaz.in',
});

test('the letter is one {subject,text,html} mail, and the mailer reaches it through emails.js', () => {
  assert.equal(viaMail, welcomeEmail, 'mail.welcomeEmail is the same function — one door for every template');
  assert.match(signup.subject, /^Welcome to ADDABAAZ/);
  assert.ok(signup.subject.length <= 78, `the subject survives a phone inbox: ${signup.subject.length} chars`);
  for (const part of ['text', 'html']) assert.ok(signup[part].includes('ADDABAAZ'), `${part} is not empty`);
  assert.match(signup.text, /Hi Riya,/);
});

test('the confirmation link is IN this mail — sign-up does not send a second one', () => {
  assert.match(signup.html, /href="https:\/\/addabaaz\.in\/verify\?token=abc123"/, 'the button points at /verify');
  assert.match(signup.html, /Confirm\u00a0my\u00a0email/, 'and says what it does');
  assert.ok(signup.text.includes('https://addabaaz.in/verify?token=abc123'), 'a text client gets the raw link');
  assert.match(signup.html, /works once and expires in three days/, 'and the reader is told the rules');
});

test('money follows the offer, not the invoice — and disappears when there is no offer', () => {
  assert.match(signup.subject, /Rs\. 100 is in your account/, 'no .00 on a round amount');
  assert.match(signup.html, /Rs\. 100\.00/, 'the balance strip is a ledger line: it matches receipts');
  const noPromos = welcomeEmail({ name: 'Riya', siteUrl: 'https://a.in', verifyUrl: 'https://a.in/verify?token=t' });
  assert.ok(!noPromos.html.includes('New-account credit'), 'PROMO_ENABLED=false sends no ticket at all');
  assert.ok(!/Rs\. 0/.test(noPromos.html + noPromos.text), 'and never promises Rs. 0');
  assert.match(noPromos.subject, /your account is ready/);
  // Credit granted, balance lookup failed → the amount stays, the total is left out rather than guessed.
  const noBalance = welcomeEmail({ name: 'Riya', siteUrl: 'https://a.in', creditPaise: 10000, balancePaise: 0 });
  assert.match(noBalance.html, /New-account credit/);
  assert.ok(!noBalance.html.includes('>Balance</p>'), 'no balance strip without a real number');
});

test('an address the provider already vouched for gets a welcome without a verify link', () => {
  const social = welcomeEmail({ name: 'Riya', siteUrl: 'https://a.in', creditPaise: 10000, balancePaise: 10000 });
  assert.ok(!social.html.includes('verify?token='), 'nothing to confirm, so no half-broken link is offered');
  assert.match(social.html, /Start\u00a0watching/, 'the primary button becomes watching');
  assert.match(social.html, /already confirmed by your provider/);
});

test('every string a person typed is escaped, and the mail carries no script', () => {
  const hostile = welcomeEmail({
    name: '"><script>alert(1)</script>', siteUrl: 'https://a.in', creditPaise: 10000, balancePaise: 500,
    verifyUrl: 'https://a.in/verify?token=t', inviteCode: "' onmouseover='x", supportEmail: 'a@b.c" onload="y',
  });
  const { html } = hostile;
  // A raw quote would close the attribute and let the handler out; esc() turns every one into `&quot;`, so the
  // only way `onload="` can appear in the document is a missing escape. (`<img>` itself is legal — the posters.)
  assert.doesNotMatch(html, /<script|javascript:|\son\w+=["']/i, 'no event handler ever becomes an attribute');
  assert.ok(!html.includes('"><script>') && !html.includes('<img src=x'), 'a typed name stays text, never markup');
  assert.match(html, /&lt;script&gt;|&quot;&gt;/, 'it arrives escaped');
  // `=` must be followed by a quote for this to be a real attribute: the escaped text of a hostile support
  // address legitimately contains the words `onload=` and they must not frighten this check.
  assert.doesNotMatch(html, /<script|javascript:|\son\w+=["']/i, 'no event handler survives as an attribute');
});

test('links are absolute and images always have alt text', () => {
  const hrefs = [...signup.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 8, `the letter is full of links (${hrefs.length})`);
  for (const href of hrefs) assert.match(href, /^(https?:|mailto:)/, `${href} is absolute — a mail is never opened from the site`);
  assert.doesNotMatch(signup.html, /href="\/#/, 'no root-relative app links either: a mail client has no base');
  for (const img of signup.html.matchAll(/<img[^>]*>/g)) assert.match(img[0], /\balt="[^"]+"/, 'every image is described');
  assert.match(signup.html, /\/media\/shows\/[a-z-]+-sm\.webp/, 'posters come from the site, not a hard-coded host');
});

test('the phone rules that ship are the rules that were reviewed', () => {
  // The harness (preview/welcome-email.html) is the design a human checked at 390px; the mailer must send the
  // same layout, so the <style> block is shared verbatim instead of being copy-pasted and left to drift.
  const preview = fs.readFileSync(path.join(PREVIEW, 'welcome-email.html'), 'utf8');
  assert.ok(preview.includes(welcomeStyle), 'the preview and server/src/welcome-email.js disagree about the phone rules');
  const shipped = /<style type="text\/css">([\s\S]*?)<\/style>/.exec(signup.html)?.[1] || '';
  const oneLine = (t) => t.replace(/\s+/g, ' ').trim();
  assert.equal(oneLine(shipped), oneLine(welcomeStyle), 'the mail carries exactly the phone rules that were reviewed');

  // And the invariant the preview file is checked against is checked here too — on the generated markup, which
  // is what a phone actually renders. `display:block`/`width:100%` on a <td> breaks the row's box; only
  // <table>s (the buttons) may reflow.
  const rules = new Map();
  for (const [, sel, body] of welcomeStyle.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    for (const one of sel.split(',')) {
      const cls = /^\s*\.([\w-]+)\s*$/.exec(one)?.[1];
      if (cls) rules.set(cls, (rules.get(cls) || '') + body);
    }
  }
  assert.ok(rules.size >= 8, `the phone query styles the layout (saw ${rules.size} classes)`);
  for (const [cls, body] of rules) {
    const count = (re) => [...signup.html.matchAll(new RegExp(re, 'g'))].length;
    assert.ok(count(`class="[^"]*\\b${cls}\\b`) > 0, `.${cls} is styled for phones but never used`);
    if (/display:\s*block/.test(body) || /width:\s*100%/.test(body)) {
      assert.equal(count(`<td[^>]*class="[^"]*\\b${cls}\\b`), 0, `.${cls} sits on a <td> and would restack it`);
    }
  }
});

test('the buttons survive a phone: they are never inside a cell that hides', () => {
  // `.hide` is display:none at 520px. Applying it to the cell wrapping the calls to action deletes the whole
  // point of the mail on exactly the devices most viewers use.
  assert.doesNotMatch(signup.html, /<td[^>]*class="[^"]*\bhide\b[^>]*>\s*<table[^>]*class="cta/, 'the CTA row is not hidden on phones');
  assert.match(signup.html, /class="pad" style="padding:26px 28px 0">\s*\n?\s*<table role="presentation"[^>]*class="cta"/, 'the pills sit directly in a full-width cell');
});

test('a referral code turns the letter into an invite; none, and the strip is simply absent', () => {
  assert.match(signup.html, /AB12CD34/);
  assert.match(signup.html, /href="https:\/\/addabaaz\.in\/#\/account"/, 'with a way to open Refer & earn');
  assert.match(signup.text, /Your invite code is AB12CD34/);
  const noCode = welcomeEmail({ name: 'Riya', siteUrl: 'https://a.in', creditPaise: 10000 });
  assert.ok(!noCode.html.includes('Pass it on'), 'nothing is promised about referrals without a code');
});

test('the letter closes with a real person, the address and the marketing rule', () => {
  assert.match(signup.html, /mailto:office@addabaaz\.in/);
  assert.match(signup.text, /283 Lake Gardens/);
  // One line the reader needs before unsubscribing is offered: this is a transactional letter, not a campaign —
  // and the confirm link inside it may not be made optional.
  assert.match(signup.html, /not marketing and cannot be turned off/);
  assert.match(signup.html, /#\/privacy/);
});
