#!/usr/bin/env node
/* Fills the merge fields in preview/welcome-email.html and writes preview/email.html — the rendered copy of
 * the welcome e-mail that /preview frames. One source, two files: the template carries {{fields}} for the
 * mailer, the rendered one shows a reviewer what a subscriber actually gets. Run it after editing the
 * template (`npm run email:preview`); `--check` only verifies the rendered copy is up to date, which is what
 * the test suite does.
 *
 * `preview/email-shipped.html` is the other half: the document `server/src/welcome-email.js` actually returns,
 * with demo numbers passed in (numbers, not merge fields, because which sections appear depends on them). The
 * harness can show either, and a test fails if the two stop agreeing on structure — so the design that was
 * reviewed is the design that is sent.
 */
import fs from 'node:fs';
import { welcomeEmail } from '../server/src/welcome-email.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'preview', 'welcome-email.html');
const OUT = path.join(root, 'preview', 'email.html');
const OUT_SHIPPED = path.join(root, 'preview', 'email-shipped.html');

// Demo values a reviewer sees: the amount is the .env default (PROMO_SIGNUP_CREDIT_INR), and the link is the
// shape of the real one-time /verify link.
export const DEMO = {
  first_name: 'Riya',
  site_url: 'https://addabaaz.in',
  verify_url: 'https://addabaaz.in/verify?token=6aQ1mFhT2sY9pLdK0vNcE7rXbZ3iWuJf1tgHnMqA5oE',
  credit_rupees: '100',
  support_email: 'office@addabaaz.in',
};

/* The template is generated from the letter itself: welcomeEmail() is called with merge-field placeholders, so
 * the design a reviewer sees is the markup the mailer sends, with only the values left open. */
export function templateFromLetter() {
  const letter = welcomeEmail({
    name: '{{first_name}}', siteUrl: '{{site_url}}', creditPaise: 10000,
    verifyUrl: '{{verify_url}}', supportEmail: '{{support_email}}',
  });
  return letter.html.replace('Rs. 100 new-account', 'Rs. {{credit_rupees}} new-account');
}

export function render(source, values = DEMO) {
  const out = source.replace(/\{\{(\w+)\}\}/g, (all, key) => (key in values ? String(values[key]) : all));
  const left = [...out.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  if (left.length) throw new Error(`unknown merge field(s): ${[...new Set(left)].join(', ')}`);
  return out;
}

// What the mailer is called with in production comes from the promo module and the account row.
export const SHIPPED = {
  name: DEMO.first_name + ' Sen', siteUrl: DEMO.site_url, verifyUrl: DEMO.verify_url,
  creditPaise: 10000, supportEmail: DEMO.support_email,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = templateFromLetter();
  const built = render(source);
  const shipped = welcomeEmail(SHIPPED).html;
  if (process.argv.includes('--check')) {
    const onDiskTemplate = fs.existsSync(SRC) ? fs.readFileSync(SRC, 'utf8') : '';
    if (onDiskTemplate !== source) { console.error('preview/welcome-email.html is out of date — run `npm run email:preview`.'); process.exit(1); }
    const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (onDisk !== built) { console.error('preview/email.html is out of date — run `npm run email:preview`.'); process.exit(1); }
    const onDiskShipped = fs.existsSync(OUT_SHIPPED) ? fs.readFileSync(OUT_SHIPPED, 'utf8') : '';
    if (onDiskShipped !== shipped) { console.error('preview/email-shipped.html is out of date — run `npm run email:preview`.'); process.exit(1); }
    console.log('✔ preview/email.html matches preview/welcome-email.html');
    console.log('✔ preview/email-shipped.html matches server/src/welcome-email.js');
  } else {
    fs.writeFileSync(SRC, source);
    fs.writeFileSync(OUT, built);
    fs.writeFileSync(OUT_SHIPPED, shipped);
    console.log(`✔ preview/email.html written (${(built.length / 1024).toFixed(1)} kB) · merge fields filled with the demo values`);
    console.log(`✔ preview/email-shipped.html written (${(shipped.length / 1024).toFixed(1)} kB) · the mailer's own output`);
  }
}
