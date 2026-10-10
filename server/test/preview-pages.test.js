// The /preview design pages for the welcome e-mail (preview/README.md). They are not viewer pages: never
// cached, noindex so they stay out of search results, and the harness page's single inline script is allowed
// by CSP hash exactly like maintenance.html's — the site policy has no 'unsafe-inline' for scripts.
// Needs no MySQL: only static delivery is exercised, and no route here touches the database.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';

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
    assert.match(r.text, /ADDA/, 'the wordmark is in the header');
    // /preview (no trailing slash) is the URL people actually type, and from there a relative asset path
    // resolves to /email.html — so nothing in the page may be referenced relatively.
    assert.doesNotMatch(r.text, /(?:src|href)="(?!\/|#|mailto:|https?:)[^"]*\.html"/, 'every asset path is root-absolute');
    assert.equal((await s.get('/preview/')).status, 200, 'with or without the trailing slash');
  } finally { await s.close(); }
});

test('the harness inline script is allowed by its CSP hash', async () => {
  const s = await boot();
  try {
    const r = await s.get('/preview');
    const csp = r.headers.get('content-security-policy') || '';
    assert.ok(!/'unsafe-inline'/.test(csp.split(';').find((d) => d.trim().startsWith('script-src')) || ''), 'never weaken the site policy for one page');
    // Every inline <script> in the response must be present as a sha256 hash, or the browser blocks it.
    const bodies = [...r.text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    assert.equal(bodies.length, 1, 'one inline script (the width/images toggles)');
    for (const body of bodies) {
      const hash = `'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`;
      assert.ok(csp.includes(hash), `CSP must carry ${hash} or the page has no controls`);
    }
  } finally { await s.close(); }
});

// What a mail must look like: no script of any kind, tables for layout, merge fields intact for the mailer.
test('the e-mail documents carry no script, and the template keeps its merge fields', async () => {
  const s = await boot();
  try {
    const rendered = await s.get('/preview/email.html');
    assert.equal(rendered.status, 200);
    assert.match(rendered.text, /<table role="presentation"/, 'table-based layout, as every client needs');
    assert.doesNotMatch(rendered.text, /<script|onclick=|javascript:/i, 'no script, no inline handlers — mail clients strip or block them');
    const template = await s.get('/preview/template.html');
    assert.equal(template.status, 200);
    for (const field of ['{{first_name}}', '{{site_url}}', '{{credit_rupees}}', '{{invite_code}}', '{{support_email}}'])
      assert.ok(template.text.includes(field), `the sendable template still carries ${field}`);
    assert.doesNotMatch(template.text, /href="\/#/, 'links are absolute: a mail is not opened from the site');
  } finally { await s.close(); }
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
    for (const p of ['/preview/email.html', '/preview/template.html']) assert.equal((await off.get(p)).status, 404, `${p} is gone`);
  } finally { await off.close(); }
});
