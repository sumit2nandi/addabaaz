// Redirect and page-delivery hardening, with no database.
//
// A canonicalisation redirect repeats part of the request path back in `Location`. Browsers (and
// `new URL()`) resolve `//host` and even `///host` as "this scheme, that authority", so `///evil.com/`
// turned the site's own 301 into a jump to https://evil.com — an open redirect on the public site.
// The same file also pins two neighbouring guarantees the fix depends on: the `Host` header can only ever
// contribute a bare origin to canonical/OG URLs, and the maintenance page's inline script stays allowed by
// hash so the site CSP never has to carry 'unsafe-inline'.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeRedirectLocation } from '../src/http.js';
import { createSeo, siteOrigin } from '../src/seo.js';
import { cspForInlineScripts } from '../src/web.js';
import { SITE_CSP } from '../src/middleware/security.js';
import { Catalog } from '../../app/js/data/catalog.js';
import { PLANS } from '../src/plans.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = 'https://addabaaz.in';

/* ---------- safeRedirectLocation ---------- */

test('safeRedirectLocation: normal internal targets pass through', () => {
  for (const ok of ['/', '/show/shahid', '/show/shahid/', '/soon/trap?ref=AB12', '/watch/x#a', '/a%2Fb']) {
    assert.equal(safeRedirectLocation(ok, ''), ok, `${ok} is a same-origin path`);
  }
});

test('safeRedirectLocation: cross-origin and header-injecting targets are refused', () => {
  const evil = [
    '//evil.com',                 /// /host → same scheme, attacker authority
    '///evil.com',                // three slashes resolve to an authority too
    '////evil.com/x',
    '\\\\evil.com',               // backslashes are collapsed to slashes by the URL parser
    '/\\evil.com',
    'https://evil.com',
    'http://evil.com',
    'javascript:alert(1)',
    '/a\r\nX-Injected: 1',        // CRLF would add response headers
    '/a\nLocation: //evil.com',
    '/a b',                       // a space lets a proxy/browser reinterpret the target
    'evil.com',
  ];
  for (const bad of evil) {
    assert.notEqual(safeRedirectLocation(bad, ''), bad, `${JSON.stringify(bad)} must not be used as a Location`);
  }
  assert.equal(safeRedirectLocation('//evil.com', '/'), '/');      // the fallback is what callers get
});

test('safeRedirectLocation: a rejected target is never a cross-origin URL when resolved', () => {
  for (const raw of ['///evil.com/', '//evil.com/\\', '/\\evil.com', '//evil.com?a=b']) {
    const to = safeRedirectLocation(raw, '');
    if (to) assert.equal(new URL(to, SITE).origin, SITE, `${JSON.stringify(raw)} → ${JSON.stringify(to)} must stay on ${SITE}`);
  }
});

/* ---------- the SEO renderer that produces the redirects ---------- */

const cat = new Catalog(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog.json'), 'utf8')));
const studio = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/studio.json'), 'utf8'));
// A stub catalog store: the renderer only needs `get()`, so no database is involved.
const seo = createSeo({ catalog: { get: async () => ({ catalog: cat, studio, version: 1 }) }, root: ROOT, plans: PLANS, origin: '', indexable: false });
const req = (url, host = 'addabaaz.in') => ({
  url, path: url.split('?')[0], protocol: 'https', query: {}, headers: { host },
  get: (name) => (String(name).toLowerCase() === 'host' ? host : undefined),
});

test('render(): the trailing-slash redirect is refused for a host-looking path', async () => {
  for (const url of ['///evil.com/', '//evil.com/', '/\\/evil.com/']) {
    const r = await seo.render(req(url));
    assert.ok(!r.redirect, `${url} must not produce a redirect (got ${JSON.stringify(r.redirect)})`);
    if (r.status) assert.ok(r.status === 404 || r.status === 503, `${url} is answered as an unknown page, got ${r.status}`);
  }
});

test('render(): genuine canonicalisation still redirects, and only within the site', async () => {
  const r = await seo.render(req('/show/shahid/?x=1'));
  assert.equal(r.redirect, '/show/shahid?x=1');
  assert.equal(new URL(r.redirect, SITE).origin, SITE);
  const index = await seo.render(req('/index.html'));
  assert.equal(index.redirect, '/');
});

test('render(): a metadata redirect (/show/x → /soon/x) is kept and stays internal', async () => {
  const soon = cat.upcoming.find((u) => !cat.show(u.id)) || cat.upcoming[0];
  const r = await seo.render(req(`/show/${soon.id}/`));
  if (r.redirect) assert.equal(new URL(r.redirect, SITE).origin, SITE, `${r.redirect} leaves the site`);
});

/* ---------- Host header handling ---------- */

test('siteOrigin(): a configured PUBLIC_SITE_URL always wins over the request', () => {
  assert.equal(siteOrigin(req('/x', 'evil.example'), 'https://addabaaz.in/'), 'https://addabaaz.in');
});

test('siteOrigin(): a malformed Host header contributes no origin at all', () => {
  for (const host of ['evil.example/', 'evil.example/x', 'user:pass@evil.example', 'a b', 'evil.example:abc', '', '../x', 'evil.example#x']) {
    assert.equal(siteOrigin(req('/x', host), ''), '', `Host "${host}" must not become an origin`);
  }
  // Ordinary hosts (production, a Render preview, a port, IPv6-free names) keep working.
  for (const host of ['addabaaz.in', 'localhost:3000', 'addabaazott.onrender.com', '127.0.0.1:3000']) {
    assert.equal(siteOrigin(req('/x', host), ''), `https://${host}`);
  }
});

test('a hostile Host header cannot inject a foreign origin into the rendered page', async () => {
  const html = (await seo.render(req('/show/shahid', 'evil.example/x'))).body || '';
  assert.ok(html.includes('<title>'), 'the page still renders');
  const canonical = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || '';
  assert.ok(!/evil\.example/.test(canonical), `canonical must not carry the Host header (got "${canonical}")`);
});

/* ---------- maintenance page CSP ---------- */

test('cspForInlineScripts(): the maintenance page script is allowed by hash, not by unsafe-inline', () => {
  const file = fs.readFileSync(path.join(ROOT, 'maintenance.html'), 'utf8');
  const body = file.replace('{{message}}', 'Upgrading').replace('{{until}}', () => crypto.createHash('sha1').update('x').digest('hex'));
  const csp = cspForInlineScripts(body);
  const inline = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(inline.length >= 1, 'maintenance.html is expected to carry one inline script');
  for (const script of inline) {
    const hash = `sha256-${crypto.createHash('sha256').update(script, 'utf8').digest('base64')}`;
    assert.ok(csp.includes(`'${hash}'`), `the CSP must hash the inline script (${hash})`);
  }
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src must not be widened to 'unsafe-inline'");
  for (const directive of SITE_CSP.split('; ').filter((d) => !d.startsWith('script-src'))) {
    assert.ok(csp.includes(directive), `every other directive must survive: ${directive}`);
  }
});

test('cspForInlineScripts(): a page with no inline script keeps the site policy untouched', () => {
  assert.equal(cspForInlineScripts('<p>hello</p>'), SITE_CSP);
  assert.equal(cspForInlineScripts('<script src="/app/js/main.js"></script>'), SITE_CSP);
});
