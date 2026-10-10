// The /preview design pages for the welcome e-mail (preview/README.md). They are not viewer pages: never
// cached, noindex so they stay out of search results, and the harness page's single inline script is allowed
// by CSP hash exactly like maintenance.html's — the site policy has no 'unsafe-inline' for scripts.
// Needs no MySQL: only static delivery is exercised, and no route here touches the database.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { render, DEMO, SHIPPED } from '../../scripts/build-email-preview.mjs';
import { welcomeEmail } from '../src/welcome-email.js';

const PREVIEW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../preview');

// Every db method answers null: the pages are read from disk, and an unknown path never gets this far.
const stubDb = () => new Proxy({}, { get: () => async () => null });

/** Boots the real app with the real static delivery, on a random port. */
async function boot({ previewPages } = {}) {
  const saved = process.env.PREVIEW_PAGES;
  if (previewPages !== undefined) process.env.PREVIEW_PAGES = previewPages;
  const app = createApp({ db: stubDb(), jwtSecret: 'preview-test-secret', rate: false, serveStatic: true, uploadDir: '/tmp/addabaaz-preview-uploads' });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    async get(p) { const r = await fetch(base + p); return { status: r.status, headers: r.headers, text: await r.text() }; },
    async close() { await new Promise((r) => server.close(r)); if (saved === undefined) delete process.env.PREVIEW_PAGES; else process.env.PREVIEW_PAGES = saved; },
  };
}

test('the e-mail preview is served unlisted: no-store, noindex, no viewer chrome', async () => {
  const s = await boot();
  try {
    const r = await s.get('/preview');
    assert.equal(r.status, 200, 'the harness answers');
    assert.match(r.headers.get('cache-control') || '', /no-store/, 'a reviewer edits the file and reloads — nothing may be cached');
    assert.match(r.headers.get('x-robots-tag') || '', /noindex/, 'a design page must never be indexed');
    assert.match(r.text, /<iframe[^>]+src="\/preview\/email\.html"/, 'it frames the e-mail document, by absolute path');
    // /preview (no trailing slash) is the URL people actually type, and from there a relative asset path
    // resolves to /email.html — so nothing in the page may be referenced relatively.
    assert.doesNotMatch(r.text, /(?:src|href)="(?!\/|#|mailto:|https?:)[^"]*\.html"/, 'every asset path is root-absolute');
    assert.equal((await s.get('/preview/')).status, 200, 'with or without the trailing slash');
    // The mailer's own document, for comparison (see `Mailer output` in the harness) — same rules apply.
    const shipped = await s.get('/preview/email-shipped.html');
    assert.equal(shipped.status, 200);
    assert.match(shipped.headers.get('cache-control') || '', /no-store/);
    assert.match(shipped.headers.get('x-robots-tag') || '', /noindex/);
  } finally { await s.close(); }
});

test('the harness inline script is allowed by its CSP hash', async () => {
  const s = await boot();
  try {
    const r = await s.get('/preview');
    const csp = r.headers.get('content-security-policy') || '';
    const scripts = (csp.match(/script-src([^;]*)/) || [])[1] || '';
    assert.ok(!/'unsafe-inline'/.test(scripts), 'never weaken the site policy for one page');
    // Every inline <script> in the response must be present as a sha256 hash, or the browser blocks it.
    const bodies = [...r.text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    assert.equal(bodies.length, 1, 'one inline script (the width and images-off toggles)');
    for (const body of bodies) {
      const hash = `'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`;
      assert.ok(csp.includes(hash), `CSP must carry ${hash} or the page has no controls`);
    }
  } finally { await s.close(); }
});

// What a mail must look like: no script of any kind, tables for layout, merge fields intact for the mailer.
test('the e-mail document carries no script, and the template keeps its merge fields', async () => {
  const s = await boot();
  try {
    const rendered = await s.get('/preview/email.html');
    assert.equal(rendered.status, 200);
    assert.match(rendered.text, /<table role="presentation"/, 'table-based layout, as every client needs');
    // (A bare /on\w+=/ would match `content=` — the point is event handlers, not CSS-looking attributes.)
    assert.doesNotMatch(rendered.text, /<script|javascript:|\son(click|mouse\w+|key\w+|focus|blur|load|error|submit|change)=/i,
      'no script and no inline event handlers — mail clients strip or block them');
    // The palette is the site's own: near-black panels, studio red, premium gold. A white card here would be
    // the design drifting back to a generic SaaS template.
    assert.match(rendered.text, /background:#0e0e12/, 'the message card stays dark');
    assert.match(rendered.text, /#d00000/, 'the studio red is used for the wordmark, the rules and the CTA');
    assert.match(rendered.text, /#f5c518/, 'gold marks the credit, as it does on the plans page');
    assert.doesNotMatch(rendered.text, /\{\{\w+\}\}/, 'nothing unreplaced is left for the reader to see');

    const template = await s.get('/preview/welcome-email.html');
    assert.equal(template.status, 200);
    for (const field of ['{{first_name}}', '{{site_url}}', '{{verify_url}}', '{{media_url}}', '{{credit_rupees}}', '{{balance_rupees}}', '{{invite_code}}', '{{support_email}}'])
      assert.ok(template.text.includes(field), `the sendable template still carries ${field}`);
    assert.doesNotMatch(template.text, /href="\/#/, 'links are absolute: a mail is never opened from the site');
    // The primary button of the letter is that link; if the harness ever loses it, the design a reviewer
    // approved is no longer the design that ships.
    assert.match(template.text, /<a href="\{\{verify_url\}\}"/, 'the confirmation link is the primary CTA');
  } finally { await s.close(); }
});

// The reviewer's copy is generated, so it can never drift away from the template it came from.
// The phone media query may only resize, repad and hide things — it must never RESTACK a cell. A
// `display:block` (or `width:100%`) on a <td> breaks the row's box: the panel's border then wraps one cell while
// the others overflow it, and a cell widened to 100% squeezes its neighbour into ten words per line. Both
// looked fine at 600px, which is how this slipped past a desktop review twice.
test('nothing is restacked at phone width — only tables reflow', () => {
  const src = fs.readFileSync(path.join(PREVIEW, 'welcome-email.html'), 'utf8');
  const mq = /@media only screen and \(max-width:\d+px\)\{([\s\S]*?)\n  \}/.exec(src)?.[1] || '';
  assert.ok(mq, 'the template has a phone media query');
  const rules = new Map();                                                 // class → its phone declarations
  for (const [, sel, body] of mq.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    for (const one of sel.split(',')) {
      const cls = /^\s*\.([\w-]+)\s*$/.exec(one)?.[1];
      if (cls) rules.set(cls, (rules.get(cls) || '') + body);
    }
  }
  assert.ok(rules.size >= 8, `expected the phone rules to cover the layout (saw ${rules.size} classes)`);
  for (const [cls, body] of rules) {
    const on = (pattern) => [...src.matchAll(new RegExp(pattern, 'g'))].length;
    assert.ok(on(`class="[^"]*\\b${cls}\\b`) > 0, `.${cls} is styled at phone width but used nowhere — dead rule`);
    if (/display:\s*block/.test(body) || /width:\s*100%/.test(body)) {
      // Legal on a <table> (a table shrink-wraps, so going full width stretches the whole widget), fatal on a cell.
      const cells = on(`<td[^>]*class="[^"]*\\b${cls}\\b`);
      assert.equal(cells, 0, `.${cls} is on a <td> and the phone query restacks it — build the section so it never needs restacking`);
    }
  }
});

test('preview/email.html is exactly the template with the demo values filled in', () => {
  const built = render(fs.readFileSync(path.join(PREVIEW, 'welcome-email.html'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(PREVIEW, 'email.html'), 'utf8'), built, 'run `npm run email:preview` after editing the template');
  for (const [field, value] of Object.entries(DEMO)) assert.ok(!built.includes(`{{${field}}}`), `${field} was not filled in`);
});

// The harness shows two documents: the tuned template and the letter `welcomeEmail()` actually builds. The
// second one is generated too, and the two are compared part by part — a design change that never reaches the
// mailer (or a mailer edit that the review never saw) fails here rather than in somebody's inbox.
test('the mailer output shown in the harness is the mailer output, part for part with the design', () => {
  const design = fs.readFileSync(path.join(PREVIEW, 'email.html'), 'utf8');
  const shipped = fs.readFileSync(path.join(PREVIEW, 'email-shipped.html'), 'utf8');
  assert.equal(shipped, welcomeEmail(SHIPPED).html, 'preview/email-shipped.html is stale — run `npm run email:preview`');
  assert.doesNotMatch(shipped, /<script|<iframe|\{\{\w+\}\}/, 'a standalone document: no script, no leftover field');
  const parts = (doc) => new Set([...doc.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
  assert.deepEqual([...parts(shipped)].sort(), [...parts(design)].sort(), 'the letter and the reviewed design use the same parts');
  for (const label of ['New-account credit', 'Confirm', 'Start with these three', 'Four things worth knowing', 'Pass it on', 'Lake Gardens']) {
    assert.ok(shipped.includes(label) && design.includes(label), `“${label}” is in one document but not the other`);
  }
});

test('preview/README.md is never served, and PREVIEW_PAGES=0 takes the whole area down', async () => {
  const s = await boot();
  try {
    assert.equal((await s.get('/preview/README.md')).status, 404, 'repository notes stay off the web');
  } finally { await s.close(); }
  // Off means off: the folder is not mounted at all, so these paths fall through to the ordinary 404 for an
  // unknown file (no database, no SEO render) instead of answering with the design page.
  const off = await boot({ previewPages: '0' });
  try {
    for (const p of ['/preview/email.html', '/preview/email-shipped.html', '/preview/welcome-email.html']) assert.equal((await off.get(p)).status, 404, `${p} is gone`);
  } finally { await off.close(); }
});
