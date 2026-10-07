// SEO tests: page metadata, JSON-LD structured data, server-rendered HTML for crawlers, status codes, robots.txt and sitemap.xml.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { dbConfigFromEnv } from '../src/config.js';
import { Catalog } from '../../app/js/data/catalog.js';
import { pageMeta, clip, videoIndexable } from '../../app/js/seo/meta.js';
import { matchRoute } from '../../app/js/routes.js';

// Database for the tests: TEST_DATABASE_URL or a local MySQL. Each file creates its own throw-away database (unique name) and drops it at the end, so tests never touch real data.
const cfg0 = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...cfg0, database: `addabaaz_seo_${process.pid}_${Date.now().toString(36)}` };
const SITE = 'https://addabaaz.example';
// Shared state for the tests in this file (database, HTTP server, base URL).
let db, live, staging, liveUrl, stagingUrl; const servers = [];
const listen = async (app) => { const s = app.listen(0); await new Promise((r) => s.once('listening', r)); servers.push(s); return `http://127.0.0.1:${s.address().port}`; };
// Runs once before the tests: create + migrate the database and start the app on a random free port.
test.before(async () => {
  db = await createDb({ config, ensureDatabase: true }); await migrate(db);
  live = createApp({ db, jwtSecret: 't', rate: false, seo: { siteUrl: SITE, indexable: true } });
  staging = createApp({ db, jwtSecret: 't', rate: false, seo: { siteUrl: SITE, indexable: false } });
  liveUrl = await listen(live); stagingUrl = await listen(staging);
});
// Clean up: stop the server and drop the temporary database.
test.after(async () => { servers.forEach((s) => s.close()); if (db) { await db.dropDatabase(); await db.close(); } });

const get = (p, base = liveUrl, headers = {}) => fetch(base + p, { redirect: 'manual', headers });
const catalogJson = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
const studioJson = JSON.parse(fs.readFileSync(new URL('../../data/studio.json', import.meta.url), 'utf8'));
const cat = new Catalog(catalogJson);
const meta = (path) => pageMeta({ path, cat, studio: studioJson, origin: SITE });
const attr = (html, re) => (html.match(re) || [])[1];
const ld = (html) => JSON.parse(attr(html, /<script type="application\/ld\+json" id="ld-page">([\s\S]*?)<\/script>/));

test('routes: shared matcher', () => {
  assert.deepEqual(matchRoute('/show/shahid').params, { id: 'shahid' });
  assert.equal(matchRoute('/show/shahid/').view, 'show');
  assert.equal(matchRoute('/youtube'), null);
  assert.equal(meta('/youtube').status, 404);
  assert.equal(matchRoute('/nope'), null);
  assert.equal(matchRoute('/show/%E0%A4%A'), null);          // malformed escape → no match, no throw
});

test('pageMeta: titles, descriptions, canonical, robots', () => {
  for (const p of ['/', '/shows', '/show/shahid', '/upcoming', '/soon/trap', '/plans', '/about', '/services', '/contact', '/delete-account']) {
    const m = meta(p);
    assert.equal(m.status, 200, p); assert.match(m.robots, /^index,follow/, p);
    assert.ok(m.title.length >= 10 && m.title.length <= 75, `${p} title length ${m.title.length}: ${m.title}`);
    assert.ok(m.description.length >= 50 && m.description.length <= 165, `${p} description length ${m.description.length}`);
    assert.equal(m.canonical, p); assert.ok(m.image.startsWith(SITE) || m.image.startsWith('https://'), p);
  }
  const ep = cat.episodes('shahid')[0], m = meta(`/watch/${ep.id}`);
  assert.match(m.title, /EP 1 \| ADDABAAZ$/); assert.equal(m.canonical, `/watch/${ep.id}`); assert.equal(m.ogType, 'video.episode');
  // /gallery is hidden (docs/CONTENT.md): a permanent redirect home, and crawlers are told not to keep it.
  const g = meta('/gallery');
  assert.equal(g.status, 301); assert.equal(g.redirect, '/'); assert.equal(g.robots, 'noindex,nofollow');
  // private pages are never indexed and have no canonical
  for (const p of ['/search', '/signin', '/signup', '/account', '/account/security', '/profiles', '/billing', '/list']) assert.match(meta(p).robots, /^noindex/, p);
  assert.equal(meta('/account').canonical, null);
  // unknown → 404; upcoming id under /show → redirect
  assert.equal(meta('/nope').status, 404); assert.equal(meta('/show/zzz').status, 404); assert.equal(meta('/watch/zzz').status, 404);
  assert.deepEqual([meta('/show/trap').status, meta('/show/trap').redirect], [301, '/soon/trap']);
});

test('pageMeta: reels are indexed only with a real description; /reels/:id canonicalises to /watch/:id', () => {
  const reel = cat.videos.find((v) => v.kind === 'reel'); assert.ok(reel);
  assert.equal(videoIndexable(reel), false); assert.match(meta(`/watch/${reel.id}`).robots, /^noindex/);
  assert.equal(meta(`/reels/${reel.id}`).canonical, `/watch/${reel.id}`);
  const documented = { ...reel, description: 'A short Bengali comedy sketch from the Laugh Bite series about a very confused landlord.' };
  const c2 = new Catalog({ ...catalogJson, videos: catalogJson.videos.map((v) => (v.id === reel.id ? documented : v)) });
  assert.match(pageMeta({ path: `/watch/${reel.id}`, cat: c2, origin: SITE }).robots, /^index/);
  assert.match(pageMeta({ path: `/watch/${reel.id}`, cat: c2, origin: SITE }).description, /landlord/);
});

test('pageMeta: JSON-LD for home, show, watch, listings', () => {
  const home = meta('/').jsonld; assert.ok(home.some((n) => n['@type'] === 'WebSite' && n.potentialAction['@type'] === 'SearchAction')); assert.ok(home.some((n) => n['@type'] === 'Organization' && n.email));
  const show = meta('/show/shahid').jsonld; const tv = show.find((n) => n['@type'] === 'TVSeries'); assert.equal(tv.alternateName, 'Shahid'); assert.equal(tv.url, `${SITE}/show/shahid`);
  assert.equal(show.find((n) => n['@type'] === 'BreadcrumbList').itemListElement.length, 3);
  const ep = cat.episodes('shahid')[0]; const v = meta(`/watch/${ep.id}`).jsonld.find((n) => n['@type'] === 'VideoObject');
  assert.equal(v.duration, undefined, 'public structured data must not publish content length'); assert.equal(v.embedUrl, `https://www.youtube.com/embed/${ep.source.id}`); assert.ok(v.uploadDate && v.thumbnailUrl[0] && v.name && v.description);
  assert.equal(v.interactionStatistic, undefined, 'search metadata must not publish the public view count');
  assert.equal(meta('/shows').jsonld.find((n) => n['@type'] === 'ItemList').numberOfItems, cat.shows.length);
  const premium = new Catalog({ ...catalogJson, videos: catalogJson.videos.map((x) => (x.id === ep.id ? { ...x, access: 'premium', source: { type: 'r2', key: 'premium/a/master.m3u8' } } : x)) });
  const pv = pageMeta({ path: `/watch/${ep.id}`, cat: premium, origin: SITE }).jsonld.find((n) => n['@type'] === 'VideoObject');
  assert.equal(pv.isAccessibleForFree, false); assert.equal(pv.embedUrl, undefined); assert.equal(pv.contentUrl, undefined);   // never expose a private stream URL
});

test('clip(): word boundary, sentence end, no overflow', () => {
  assert.equal(clip('short', 20), 'short');
  const c = clip('First sentence here. Second sentence goes on for a long while and gets cut somewhere.', 45); assert.ok(c.length <= 45); assert.equal(c, 'First sentence here.');
  assert.ok(clip('word '.repeat(100), 30).length <= 30);
});

test('server: page HTML carries per-page metadata for crawlers that do not run JavaScript', async () => {
  const r = await get('/show/shahid'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.match(html, /<title>Shahid \(শহীদ\)[^<]*ADDABAAZ<\/title>/);
  assert.equal(attr(html, /<link rel="canonical" href="([^"]+)"/), `${SITE}/show/shahid`);
  assert.equal(attr(html, /<meta property="og:url" content="([^"]+)"/), `${SITE}/show/shahid`);
  assert.match(attr(html, /<meta property="og:image" content="([^"]+)"/), /^https:\/\/addabaaz\.example\/media\//);
  assert.match(html, /<meta name="ab:routing" content="history">/); assert.match(html, /<base href="\/">/);
  assert.ok(html.indexOf('<base') < html.indexOf('app/css/styles.css'), '<base> must precede relative URLs');
  assert.equal(ld(html).find((n) => n['@type'] === 'TVSeries').name, 'শহীদ');
  assert.match(html, /<h1>Shahid \(শহীদ\)<\/h1>/); assert.match(html, /<a href="\/watch\/[\w-]{11}">/);   // real, crawlable links to episodes
  assert.doesNotMatch(html, /href="#\//, 'footer links are rewritten to real URLs');
  assert.equal((html.match(/<title>/g) || []).length, 1); assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.equal(r.headers.get('x-robots-tag'), null);
  assert.match(r.headers.get('cache-control'), /must-revalidate/);
  const etag = r.headers.get('etag'); assert.ok(etag); const status304 = await new Promise((res) => http.get(liveUrl + '/show/shahid', { headers: { 'If-None-Match': etag } }, (rr) => { rr.resume(); res(rr.statusCode); }));   // (fetch() adds Cache-Control: no-cache to conditional requests)
  assert.equal(status304, 304);
});

test('server: every public page renders for a direct visit, including the Reels feed (/reels) and a single reel', async () => {
  // Regression: /reels (no :id) used to crash the renderer -> 503 -> a reload or shared link of Reels showed the home page instead.
  for (const path of ['/', '/shows', '/reels', '/upcoming', '/plans', '/about', '/search', '/account', '/delete-account']) {
    const r = await get(path); assert.equal(r.status, 200, path);
    assert.match(await r.text(), /<meta name="ab:routing" content="history">/, path + ' must be served with real-URL routing');
  }
  // /gallery is hidden: old links, bookmarks and Google results land on the home page (the app does the same).
  const gallery = await get('/gallery');
  assert.equal(gallery.status, 301); assert.equal(gallery.headers.get('location'), '/');
  assert.doesNotMatch(await (await get('/')).text(), /Behind the scenes/i);
  const deletion = await get('/delete-account'); assert.equal(deletion.status, 200);
  const deletionHtml = await deletion.text(); assert.match(deletionHtml, /Delete your ADDABAAZ account/); assert.match(deletionHtml, /mailto:office@addabaaz\.in\?subject=/); assert.match(deletionHtml, /target account email\/ID/); assert.match(deletionHtml, /Privacy Policy/);
  const reel = cat.reels()[0]; assert.equal((await get('/reels/' + reel.id)).status, 200);
  assert.equal((await get('/reels/zzzzzzzzzzz')).status, 404);
});

test('server: watch page has VideoObject and a crawlable episode list on the show page', async () => {
  const ep = cat.episodes('shahid')[0];
  const html = await (await get(`/watch/${ep.id}`)).text();
  assert.equal(ld(html).find((n) => n['@type'] === 'VideoObject').uploadDate, ep.publishedAt);
  assert.equal(attr(html, /<link rel="canonical" href="([^"]+)"/), `${SITE}/watch/${ep.id}`);
});

test('server: status codes — 404 for unknown pages, 301 for duplicates, noindex for private pages', async () => {
  for (const p of ['/nothing-here', '/youtube', '/show/nope', '/watch/nope', '/soon/nope']) { const r = await get(p); assert.equal(r.status, 404, p); assert.match(await r.text(), /noindex/); assert.equal(r.headers.get('x-robots-tag'), 'noindex'); }
  assert.equal((await get('/app/js/missing.js')).status, 404); assert.equal((await get('/whatever.php')).status, 404);
  assert.equal((await get('/api/nothing')).status, 404);
  const t = await get('/shows/'); assert.equal(t.status, 301); assert.equal(t.headers.get('location'), '/shows');
  const q = await get('/shows/?view=episodes'); assert.equal(q.headers.get('location'), '/shows?view=episodes');
  const i = await get('/index.html'); assert.equal(i.status, 301); assert.equal(i.headers.get('location'), '/');
  const u = await get('/show/trap'); assert.equal(u.status, 301); assert.equal(u.headers.get('location'), '/soon/trap');
  for (const p of ['/signin', '/search?q=x', '/account', '/account/security']) { const r = await get(p); assert.equal(r.status, 200, p); assert.match(attr(await r.text(), /<meta name="robots" content="([^"]+)"/), /^noindex/, p); assert.equal(r.headers.get('x-robots-tag'), 'noindex'); }
  assert.equal((await get('/api/v1/catalog')).headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await get('/admin/')).headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('server: user-controlled values are escaped in HTML and JSON-LD', async () => {
  const evil = '</script><script>alert(1)</script>"\'&<img src=x>';
  await db.catalog.put('shows', 'evil', { ...catalogJson.shows[0], id: 'evil', title: evil, titleEn: evil, tagline: evil, description: evil, featured: false }, { create: true });
  live.locals.catalog.invalidate();
  await get('/'); const r = await get('/show/evil'); assert.equal(r.status, 200);
  const html = await r.text();
  assert.doesNotMatch(html, /<script>alert\(1\)/); assert.doesNotMatch(html, /<img src=x>/); assert.doesNotMatch(html, /<\/script><script>/);
  assert.equal(ld(html).find((n) => n['@type'] === 'TVSeries').name, evil);         // still round-trips correctly through JSON
  assert.match(html, /&lt;script&gt;alert\(1\)/);
  assert.match(await (await get('/sitemap.xml')).text(), /<loc>[^<]*\/show\/evil<\/loc>/);
});

test('robots.txt and sitemap.xml', async () => {
  const robots = await (await get('/robots.txt')).text();
  assert.match(robots, /Disallow: \/admin/); assert.match(robots, /Disallow: \/api\//); assert.match(robots, new RegExp(`Sitemap: ${SITE}/sitemap.xml`)); assert.doesNotMatch(robots, /Disallow: \/\s*$/m);
  const sm = await get('/sitemap.xml'); assert.match(sm.headers.get('content-type'), /xml/);
  const xml = await sm.text(); const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(new Set(locs).size, locs.length, 'no duplicate URLs'); assert.ok(locs.every((l) => l.startsWith(SITE + '/') && !l.includes('#')));
  for (const p of ['/', '/shows', '/show/shahid', '/soon/trap', '/about', '/contact', '/plans', '/upcoming', '/delete-account']) assert.ok(locs.includes(SITE + p), p);
  assert.ok(!locs.includes(SITE + '/gallery'), 'the hidden gallery is not in the sitemap');
  for (const p of ['/search', '/signin', '/account', '/billing', '/admin', '/youtube', '/gallery']) assert.ok(!locs.includes(SITE + p), `${p} must not be in the sitemap`);
  const reel = cat.videos.find((v) => v.kind === 'reel'), ep = cat.episodes('shahid')[0];
  assert.ok(!locs.includes(`${SITE}/watch/${reel.id}`), 'undescribed reels stay out of the sitemap'); assert.ok(locs.includes(`${SITE}/watch/${ep.id}`));
  assert.match(xml, /<video:video><video:thumbnail_loc>https:\/\/i\.ytimg\.com/); assert.doesNotMatch(xml, /<video:duration>/, 'video sitemap metadata must not publish content length');
  assert.ok(locs.every((l) => !l.includes('/show/central-calcutta-boarding')), 'upcoming ids live under /soon/');
});

test('non-production copies tell search engines to stay away', async () => {
  assert.match(await (await get('/robots.txt', stagingUrl)).text(), /Disallow: \/\s*$/m);
  const r = await get('/show/shahid', stagingUrl); assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.match(attr(await r.text(), /<meta name="robots" content="([^"]+)"/), /^noindex,nofollow/);
});

test('origin falls back to the request host when PUBLIC_SITE_URL is unset; manifest opens on /; media is cached', async () => {
  const app = createApp({ db, jwtSecret: 't', rate: false, seo: { siteUrl: '', indexable: true } }); const url = await listen(app);
  assert.match(attr(await (await get('/about', url)).text(), /rel="canonical" href="([^"]+)"/), /^http:\/\/127\.0\.0\.1:\d+\/about$/);
  const m = await (await get('/manifest.webmanifest')).json(); assert.equal(m.start_url, '/'); assert.equal(m.scope, '/');
  assert.match((await get('/media/icons/icon-192.png')).headers.get('cache-control'), /max-age=604800/);
});

test('responses are compressed', async () => {
  const r = await fetch(liveUrl + '/sitemap.xml', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.headers.get('content-encoding'), 'gzip'); assert.ok((await r.text()).includes('<urlset'));
});
