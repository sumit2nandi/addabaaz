#!/usr/bin/env node
/* Fills the merge fields in preview/welcome-email.html and writes preview/email.html — the rendered copy of
 * the welcome e-mail that /preview frames. One source, two files: the template carries {{fields}} for the
 * mailer, the rendered one shows a reviewer what a subscriber actually gets. Run it after editing the
 * template (`npm run email:preview`); `--check` only verifies the rendered copy is up to date, which is what
 * the test suite does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'preview', 'welcome-email.html');
const OUT = path.join(root, 'preview', 'email.html');

// Demo values a reviewer sees: the amounts are the .env defaults (PROMO_SIGNUP_CREDIT_INR / _REFERRAL_), the
// code is the shape the console prints, the media host is left empty so the preview reads the site's own
// /media instead of reaching out to production.
export const DEMO = {
  first_name: 'Riya',
  site_url: 'https://addabaaz.in',
  media_url: '',
  credit_rupees: '100',
  balance_rupees: '100',
  invite_code: 'AB12CD34',
  support_email: 'office@addabaaz.in',
};

export function render(source, values = DEMO) {
  const out = source.replace(/\{\{(\w+)\}\}/g, (all, key) => (key in values ? String(values[key]) : all));
  const left = [...out.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  if (left.length) throw new Error(`unknown merge field(s): ${[...new Set(left)].join(', ')}`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = fs.readFileSync(SRC, 'utf8');
  const built = render(source);
  if (process.argv.includes('--check')) {
    const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (onDisk !== built) { console.error('preview/email.html is out of date — run `npm run email:preview`.'); process.exit(1); }
    console.log('✔ preview/email.html matches preview/welcome-email.html');
  } else {
    fs.writeFileSync(OUT, built);
    console.log(`✔ preview/email.html written (${(built.length / 1024).toFixed(1)} kB) · merge fields filled with the demo values`);
  }
}
