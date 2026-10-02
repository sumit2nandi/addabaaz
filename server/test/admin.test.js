// Admin console tests: who may enter, dashboard, user management, catalog CRUD and validation, uploads,
// messages, coupons/payments views and the audit log.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { dbConfigFromEnv } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { createMailer } from '../src/mailer.js';
import { createCatalogStore } from '../src/catalog.js';
import { validate, checkCatalog } from '../src/catalog-schema.js';
import { sniffImage, videoKey } from '../src/uploads.js';

/* The admin console API, against MySQL: access control, users, catalog CRUD (+ its effect on the public API), uploads, messages, audit. */
const SECRET = 'admin-test-secret', TOKEN = 't'.repeat(32);
const ROOT = new URL('../../', import.meta.url);
// Database for the tests: TEST_DATABASE_URL or a local MySQL. Each file creates its own throw-away database (unique name) and drops it at the end, so tests never touch real data.
const cfg0 = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...cfg0, database: `addabaaz_test_admin_${process.pid}_${Date.now().toString(36)}` };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-admin-'));
const uploadDir = path.join(tmp, 'uploads');
const seed = JSON.parse(fs.readFileSync(new URL('data/catalog.json', ROOT), 'utf8'));
fs.writeFileSync(path.join(tmp, 'catalog.json'), JSON.stringify(seed));
fs.copyFileSync(new URL('data/studio.json', ROOT), path.join(tmp, 'studio.json'));
const puts = [];
const fakeR2 = { configured: true, bucket: 'b', presignGet: (key) => `https://r2.test/${key}`, presignPut: (key) => { puts.push(key); return `https://r2.test/put/${key}?sig=1`; }, getText: async () => null };
const sent = [];
const mailer = createMailer({ transport: { sendMail: async (m) => { sent.push(m); } } });

// Shared state for the tests in this file (database, HTTP server, base URL).
let db, server, root, app, admin, viewer;
// Runs once before the tests: create + migrate the database and start the app on a random free port.
test.before(async () => {
  try { db = await createDb({ config, ensureDatabase: true }); } catch (e) { throw new Error(`MySQL is not reachable (${e.code || e.message}). Set TEST_DATABASE_URL.`); }
  await migrate(db);
  app = createApp({ db, jwtSecret: SECRET, rate: false, catalogPath: path.join(tmp, 'catalog.json'), uploadDir, r2: fakeR2, payments: { provider: 'mock' }, mailer, adminToken: TOKEN });
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
  admin = await signup('boss@example.com', 'Boss'); viewer = await signup('viewer@example.com', 'View Er');
  await db.adminUsers.setAdminByEmail('boss@example.com', true);
});
// Clean up: stop the server and drop the temporary database.
test.after(async () => { server?.close(); if (db) { await db.dropDatabase(); await db.close(); } });

// Tiny HTTP client: calls the running app's API and returns `{ status, body }`; pass a token to act as a signed-in user.
const call = async (method, p, body, token, { raw, headers } = {}) => {
  const r = await fetch(root + '/api/v1' + p, { method, headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: raw ?? (body === undefined || body === null ? undefined : JSON.stringify(body)) });
  const buf = Buffer.from(await r.arrayBuffer()); const text = buf.toString('utf8'); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, body: json, text, buf, headers: r.headers };
};
// Helper: register a new user and return their token (most tests start with this).
async function signup(email, name = 'Test User') { const r = await call('POST', '/auth/signup', { name, email, password: 'password123' }); return { ...r.body, email, token: r.body.token, id: r.body.user.id }; }
const A = (m, p, b, opts) => call(m, '/admin' + p, b, admin.token, opts);
const audit = async (action) => (await A('GET', `/audit?action=${encodeURIComponent(action)}`)).body.entries;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
const fakeJwt = (claims, secret = SECRET) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b(claims)}`; return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`; };

test('admin email diagnostic sends a real test message only to the signed-in administrator', async () => {
  const before = sent.length;
  const r = await A('POST', '/email/test');
  assert.equal(r.status, 200); assert.deepEqual(r.body, { sent: true, to: 'boss@example.com' });
  assert.equal(sent.length, before + 1); assert.equal(sent.at(-1).to, 'boss@example.com');
  assert.match(sent.at(-1).subject, /email delivery test/);
  assert.ok((await audit('email.test')).some((x) => x.actor === 'boss@example.com'));
  assert.equal((await call('POST', '/admin/email/test', {}, viewer.token)).status, 403);
  assert.equal((await call('POST', '/admin/email/test', {}, TOKEN)).body.error.code, 'email_test_requires_session');
});

test('schema: unit checks (ids, images, sources, unknown fields) and the shipped catalog is valid', () => {
  const studioSeed = JSON.parse(fs.readFileSync(new URL('data/studio.json', ROOT), 'utf8'));
  assert.deepEqual(checkCatalog(seed, studioSeed, { fileExists: (rel) => fs.existsSync(new URL(rel, ROOT)) }), []);
  const soonIds = new Set(seed.upcoming.map((u) => u.id));
  assert.deepEqual(validate('studio', { ...studioSeed, homePosters: { ...studioSeed.homePosters, releasingThisMonthId: seed.upcoming[0].id } }, { upcomingIds: soonIds }).errors, []);
  assert.ok(validate('studio', { ...studioSeed, homePosters: { ...studioSeed.homePosters, releasingThisMonthId: 'missing-title' } }, { upcomingIds: soonIds }).errors.some((e) => /releasingThisMonthId.*does not exist/.test(e)));
  const bad = (type, doc, re) => { const { errors } = validate(type, doc, {}); assert.ok(errors.some((e) => re.test(e)), `${JSON.stringify(doc)} → ${errors}`); };
  bad('show', { id: 'a b', title: 'x', description: 'd', poster: 'media/x.webp' }, /id may only/);
  const { category: _seedCategory, ...legacyUpcoming } = seed.upcoming.find((u) => u.id === 'mayer-golpo');
  assert.equal(validate('upcoming', legacyUpcoming, {}).doc.category, 'coming-soon', 'older and new catalog entries without a category safely default to Coming Soon');
  assert.equal(validate('upcoming', { ...legacyUpcoming, category: 'releasing-this-month' }, {}).doc.category, 'releasing-this-month');
  bad('upcoming', { ...legacyUpcoming, category: 'next-month' }, /category must be one of/);
  const parent = seed.shows[0], nonPrivateChild = seed.videos.find((v) => v.showId === parent.id && v.source?.type !== 'r2');
  assert.ok(nonPrivateChild, 'fixture has a public-source child episode');
  assert.deepEqual(validate('show', { ...parent, access: 'premium' }).errors, [], 'a Premium show can use non-R2 sources for its episodes');
  assert.deepEqual(validate('video', { ...nonPrivateChild, access: 'premium' }).errors, [], 'any video source may be marked Premium');
  bad('show', { id: 'a', title: 'x', description: 'd', poster: '../etc/passwd' }, /poster/);
  bad('show', { id: 'a', title: 'x', description: 'd', poster: 'javascript:alert(1)' }, /poster/);
  bad('show', { id: 'a', title: 'x', description: 'd', poster: 'https://x.test/p.webp', isAdmin: true }, /Unknown field "isAdmin"/);
  bad('video', { id: 'v', kind: 'reel', title: 't', source: { type: 'youtube', id: 'short' }, duration: 5, publishedAt: '2026-01-01', access: 'free' }, /11-character/);
  assert.deepEqual(validate('video', { id: 'v', kind: 'reel', title: 't', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 5, publishedAt: '2026-01-01', access: 'premium' }).errors, [], 'Premium access is allowed for YouTube videos');
  bad('video', { id: 'v', kind: 'reel', title: 't', source: { type: 'r2', key: 'premium/../x.mp4' }, thumbnail: 'https://x.test/t.jpg', duration: 5, publishedAt: '2026-01-01', access: 'premium' }, /safe R2 object key/);
  bad('video', { id: 'v', kind: 'reel', title: 't', source: { type: 'r2', key: 'premium/x.mp4' }, duration: 5, publishedAt: '2026-01-01', access: 'premium' }, /thumbnail/);
  bad('video', { id: 'v', kind: 'reel', title: 't', source: { type: 'mp4', url: 'ftp://x' }, duration: 5, publishedAt: 'nope', access: 'free' }, /source.url|publishedAt/);
  const ok = validate('video', { id: 'v', kind: 'trailer', episode: 3, showId: null, title: ' t ', source: { type: 'youtube', id: 'abcdefghijk' }, duration: '65', publishedAt: '2026-01-01', access: 'free', hidden: true }, {});
  assert.deepEqual(ok.errors, []); assert.equal(ok.doc.episode, null, 'only episodes carry an episode number'); assert.equal(ok.doc.duration, 65); assert.equal(ok.doc.title, 't'); assert.equal(ok.doc.views, 0); assert.equal(ok.doc.publishedAt, '2026-01-01T00:00:00Z'); assert.equal(ok.doc.hidden, true);
  assert.equal(validate('video', { id: 'v', kind: 'trailer', title: 't', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 0, publishedAt: '2026-01-01', access: 'free' }, {}).doc.hidden, false);
});

test('uploads helpers: magic-byte sniffing and R2 keys', () => {
  assert.equal(sniffImage(PNG).ext, 'png'); assert.equal(sniffImage(Buffer.from('<svg onload=alert(1)>')), null); assert.equal(sniffImage(Buffer.from('<html>')), null);
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])).ext, 'webp');
  const k = videoKey('My Film (Final).MP4', 'Shahid EP 6'); assert.match(k.key, /^premium\/shahid-ep-6\/[0-9a-f]{8}-my-film-final\.mp4$/); assert.equal(k.contentType, 'video/mp4');
  assert.equal(videoKey('evil.exe'), null); assert.equal(videoKey('a.mp4.html'), null);
});

test('access control: viewers and anonymous users are refused; sessions expire; disabled and demoted admins lose access at once', async () => {
  assert.equal((await call('GET', '/admin/stats')).status, 401);
  assert.equal((await call('GET', '/admin/stats', null, viewer.token)).status, 403);
  assert.equal((await call('GET', '/admin/stats', null, 'garbage')).status, 401);
  assert.equal((await A('GET', '/stats')).status, 200);
  assert.equal((await A('GET', '/session')).body.admin.email, 'boss@example.com');
  const me = (await call('GET', '/me', null, admin.token)).body; assert.equal(me.user.isAdmin, true); assert.equal((await call('GET', '/me', null, viewer.token)).body.user.isAdmin, undefined);
  // The ADMIN_TOKEN (scripts) works and is recorded as such.
  assert.equal((await call('GET', '/admin/session', null, TOKEN)).body.admin.via, 'token');
  assert.equal((await call('GET', '/admin/session', null, 'x'.repeat(32))).status, 401);
  // A media token or a token signed with another secret is not a session.
  assert.equal((await call('GET', '/admin/stats', null, fakeJwt({ sub: admin.id, aud: 'media', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 }))).status, 401);
  assert.equal((await call('GET', '/admin/stats', null, fakeJwt({ sub: admin.id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 }, 'other'))).status, 401);
  // Session older than 12h: still a valid login for the site, but not for the admin console.
  const old = fakeJwt({ sub: admin.id, iat: Math.floor(Date.now() / 1000) - 13 * 3600, exp: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal((await call('GET', '/me', null, old)).status, 200);
  const r = await call('GET', '/admin/stats', null, old); assert.equal(r.status, 401); assert.equal(r.body.error.code, 'admin_session_expired');
  // Demoting takes effect on the very next request, without waiting for the token to expire.
  const other = await signup('second@example.com', 'Second'); await db.adminUsers.setAdminByEmail('second@example.com', true);
  assert.equal((await call('GET', '/admin/stats', null, other.token)).status, 200);
  await db.adminUsers.setAdminByEmail('second@example.com', false); assert.equal((await call('GET', '/admin/stats', null, other.token)).status, 403);
  await db.adminUsers.setAdminByEmail('second@example.com', true); await db.adminUsers.update(other.id, { disabled: true });
  assert.equal((await call('GET', '/admin/stats', null, other.token)).status, 403);
  await db.users.remove(other.id);
});

test('dashboard numbers and the setup checklist', async () => {
  const s = (await A('GET', '/stats')).body;
  assert.ok(s.users.total >= 2); assert.equal(s.days.length, 30); assert.equal(s.revenue.totalPaise, 0); assert.equal(s.subscribers.active, 0); assert.equal(typeof s.openMessages, 'number'); assert.ok(Array.isArray(s.recentUsers));
  const h = (await A('GET', '/health')).body.checks; const by = Object.fromEntries(h.map((c) => [c.id, c]));
  assert.equal(by.db.ok, true); assert.equal(by.r2.ok, true); assert.equal(by.mail.ok, true); assert.equal(by.gst.ok, false); assert.equal(by.uploads.ok, true); assert.equal(by.admins.ok, true);
});

test('users: search, filters, detail, rename, complimentary access, revoke, disable/enable, delete — with lock-out guards', async () => {
  const list = (await A('GET', '/users?q=viewer')).body; assert.equal(list.total, 1); assert.equal(list.users[0].email, 'viewer@example.com'); assert.equal(list.users[0].planId, 'free'); assert.equal(list.users[0].profiles, 1);
  assert.equal((await A('GET', '/users?q=%25')).body.total, 0, 'LIKE wildcards are escaped');
  assert.equal((await A('GET', '/users?filter=admin')).body.users.map((u) => u.email).join(), 'boss@example.com');
  const d = (await A('GET', `/users/${viewer.id}`)).body; assert.equal(d.user.email, 'viewer@example.com'); assert.equal(d.subscription.planId, 'free'); assert.equal(d.profiles.length, 1); assert.deepEqual(d.payments, []);
  assert.equal((await A('GET', '/users/nope')).status, 404);
  assert.equal((await A('PATCH', `/users/${viewer.id}`, { name: 'Renamed' })).body.user.name, 'Renamed');
  assert.equal((await A('PATCH', `/users/${viewer.id}`, { name: '' })).status, 400);
  // complimentary access
  assert.equal((await A('POST', `/users/${viewer.id}/grant`, { days: 0 })).status, 400);
  assert.equal((await A('POST', `/users/${viewer.id}/grant`, { days: 30, planId: 'free' })).status, 400);
  const g = await A('POST', `/users/${viewer.id}/grant`, { days: 3, note: 'press' }); assert.equal(g.status, 200); assert.equal(g.body.subscription.planId, 'plus-monthly'); assert.equal(g.body.subscription.provider, 'admin');
  assert.equal((await A('GET', '/users?filter=paid')).body.total, 1); assert.equal((await A('GET', '/users?filter=expiring')).body.total, 1);
  assert.equal((await db.subscriptions.dueForReminder(30)).length, 0, 'comped access does not trigger "renew your plan" emails');
  assert.equal((await A('GET', '/stats')).body.subscribers.comped, 1);
  await A('POST', `/users/${viewer.id}/grant`, { days: 30 }); const ext = (await call('GET', '/subscription', null, viewer.token)).body.subscription; assert.ok(new Date(ext.expiresAt) - Date.now() > 32 * 86400_000, 'extends the running plan');
  assert.equal((await A('POST', `/users/${viewer.id}/revoke-plan`)).body.subscription.planId, 'free');
  // disable → cannot use the site with an old token, cannot log in; enable → works again
  assert.equal((await A('PATCH', `/users/${viewer.id}`, { disabled: true })).body.user.disabledAt !== null, true);
  assert.equal((await call('GET', '/me', null, viewer.token)).body.error.code, 'account_disabled');
  const lg = await call('POST', '/auth/login', { email: 'viewer@example.com', password: 'password123' }); assert.equal(lg.status, 403); assert.equal(lg.body.error.code, 'account_disabled');
  assert.equal((await A('GET', '/users?filter=disabled')).body.total, 1);
  await A('PATCH', `/users/${viewer.id}`, { disabled: false }); assert.equal((await call('GET', '/me', null, viewer.token)).status, 200);
  // guards
  assert.equal((await A('PATCH', `/users/${admin.id}`, { isAdmin: false })).body.error.code, 'cannot_lock_yourself_out');
  assert.equal((await A('PATCH', `/users/${admin.id}`, { disabled: true })).status, 409);
  assert.equal((await A('DELETE', `/users/${admin.id}`)).status, 409);
  const p = await A('PATCH', `/users/${viewer.id}`, { isAdmin: true }); assert.equal(p.body.user.isAdmin, true);
  assert.equal((await A('PATCH', `/users/${viewer.id}`, { isAdmin: false })).status, 200);
  // the token (no identity of its own) can not remove the last admin
  assert.equal((await call('PATCH', `/admin/users/${admin.id}`, { isAdmin: false }, TOKEN)).body.error.code, 'last_admin');
  assert.equal((await call('DELETE', `/admin/users/${admin.id}`, null, TOKEN)).body.error.code, 'last_admin');
  // delete
  const gone = await signup('gone@example.com'); assert.equal((await A('DELETE', `/users/${gone.id}`)).status, 204); assert.equal((await A('GET', `/users/${gone.id}`)).status, 404);
  assert.equal((await audit('user.')).length >= 6, true);
});

test('the catalog is seeded once from the JSON files and served by the public API', async () => {
  const pub = (await call('GET', '/catalog')).body;
  assert.equal(pub.shows.length, seed.shows.length); assert.equal(pub.videos.length, seed.videos.length); assert.equal(pub.upcoming.length, seed.upcoming.length); assert.equal(pub.gallery.length, seed.gallery.length);
  assert.deepEqual(pub.shows.map((s) => s.id), seed.shows.map((s) => s.id), 'order is preserved');
  assert.deepEqual(pub.shows[0], seed.shows[0]); assert.deepEqual(pub.videos.find((v) => v.id === seed.videos[5].id), seed.videos[5]);
  const studio = (await call('GET', '/studio')).body; assert.equal(studio.studio.name, 'ADDABAAZ'); assert.equal(studio.team.length, 9);
  // a second (and third) server on the same database never re-imports, even if the file changes
  const a = createCatalogStore({ db, catalogPath: path.join(tmp, 'catalog.json') }); const b = createCatalogStore({ db, catalogPath: path.join(tmp, 'catalog.json') });
  const [x, y] = await Promise.all([a.get(), b.get()]); assert.equal(x.catalog.videos.length, seed.videos.length); assert.equal(y.catalog.videos.length, seed.videos.length);
  assert.equal(await db.catalog.seed(seed, null), false);
});

test('catalog CRUD: validated writes show up in the public API immediately; ids are stable; deletes clean up after themselves', async () => {
  const show = { id: 'new-show', title: 'নতুন শো', titleEn: 'New Show', type: 'series', genres: ['Drama'], description: 'A brand new show.', cast: ['A', 'B'], year: 2026, status: 'ongoing', featured: false, poster: seed.shows[0].poster, access: 'free' };
  // validation
  assert.equal((await A('POST', '/catalog/shows', { ...show, poster: 'media/shows/does-not-exist.webp' })).status, 400);
  assert.match((await A('POST', '/catalog/shows', { ...show, title: '' })).body.error.message, /title is required/);
  assert.equal((await A('POST', '/catalog/shows', { ...show, isAdmin: 1 })).status, 400);
  assert.equal((await A('POST', '/catalog/nonsense', show)).status, 404);
  assert.equal((await call('POST', '/admin/catalog/shows', show, viewer.token)).status, 403);
  // create → public API sees it at once
  const c = await A('POST', '/catalog/shows', show); assert.equal(c.status, 201); assert.equal(c.body.item.id, 'new-show');
  assert.equal((await A('POST', '/catalog/shows', show)).status, 409);
  let pub = (await call('GET', '/catalog')).body; assert.equal(pub.shows.at(-1).id, 'new-show'); assert.equal(pub.shows.length, seed.shows.length + 1);
  // update (id can't change)
  const u = await A('PUT', '/catalog/shows/new-show', { ...show, title: 'Edited', featured: true }); assert.equal(u.status, 200);
  assert.equal((await call('GET', '/catalog')).body.shows.at(-1).title, 'Edited');
  assert.equal((await A('PUT', '/catalog/shows/new-show', { ...show, id: 'other' })).status, 400);
  assert.equal((await A('PUT', '/catalog/shows/missing', { ...show, id: 'missing' })).status, 404);
  // videos: reference checks, r2 rules, conflicting ids
  const vid = { id: 'nv-1', showId: 'new-show', kind: 'episode', episode: 1, title: 'Pilot', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 600, publishedAt: '2026-09-01T10:00:00Z', views: 0, access: 'free' };
  assert.equal((await A('POST', '/catalog/videos', { ...vid, showId: 'no-such-show' })).status, 400);
  assert.equal((await A('POST', '/catalog/videos', vid)).status, 201);
  assert.equal((await A('POST', '/catalog/videos', { ...vid, id: 'nv-2', source: { type: 'r2', key: 'premium/nv/e2.mp4' }, access: 'premium' })).status, 400, 'r2 needs a thumbnail');
  const prem = { ...vid, id: 'nv-2', episode: 2, title: 'Premium', source: { type: 'r2', key: 'premium/nv/e2.mp4' }, thumbnail: seed.shows[0].poster, access: 'premium' };
  assert.equal((await A('POST', '/catalog/videos', prem)).status, 201);
  // …and premium gating follows the database catalog straight away
  assert.equal((await call('POST', '/videos/nv-2/stream')).body.error.code, 'login_required');
  assert.equal((await call('POST', '/videos/nv-2/stream', null, viewer.token)).body.error.code, 'subscription_required');
  await A('POST', `/users/${viewer.id}/grant`, { days: 30 });
  const st = await call('POST', '/videos/nv-2/stream', null, viewer.token); assert.equal(st.status, 200); assert.equal(st.body.url, 'https://r2.test/premium/nv/e2.mp4');
  // Turning premium off (making it free) takes effect for everyone, and removing it makes streaming 404
  assert.equal((await A('PUT', '/catalog/videos/nv-2', { ...prem, access: 'free' })).status, 200); assert.equal((await call('POST', '/videos/nv-2/stream')).status, 200);
  // library entries pointing at a deleted item disappear with it
  const prof = (await call('GET', '/profiles', null, viewer.token)).body.profiles[0];
  await call('PUT', `/profiles/${prof.id}/list/video/nv-1`, {}, viewer.token); await call('PUT', `/profiles/${prof.id}/progress/nv-1`, { position: 5, duration: 600 }, viewer.token); await call('PUT', `/profiles/${prof.id}/list/show/new-show`, {}, viewer.token);
  assert.equal((await A('DELETE', '/catalog/videos/nv-2')).status, 200); assert.equal((await call('POST', '/videos/nv-2/stream')).status, 404);
  // a show with videos is protected unless deleted together with them
  const blocked = await A('DELETE', '/catalog/shows/new-show'); assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'has_videos');
  const del = await A('DELETE', '/catalog/shows/new-show?cascade=1'); assert.equal(del.status, 200); assert.equal(del.body.deletedVideos, 1);
  pub = (await call('GET', '/catalog')).body; assert.equal(pub.shows.length, seed.shows.length); assert.equal(pub.videos.length, seed.videos.length);
  const lib = (await call('GET', `/profiles/${prof.id}/library`, null, viewer.token)).body; assert.equal(lib.list.length, 0); assert.deepEqual(lib.progress, {});
  assert.equal((await A('DELETE', '/catalog/shows/new-show')).status, 404);
  await A('POST', `/users/${viewer.id}/revoke-plan`);
});

test('catalog: upcoming, gallery, reordering and the studio profile', async () => {
  const up = { id: 'soon-1', title: 'Soon', poster: seed.upcoming[0].poster, genres: ['Comedy'] };
  assert.equal((await A('POST', '/catalog/upcoming', up)).status, 201);
  const afterUpcomingCreate = (await call('GET', '/catalog')).body;
  assert.equal(afterUpcomingCreate.upcoming[0].id, 'soon-1', 'the newest admin-added poster leads the coming-soon rows');
  assert.equal(afterUpcomingCreate.upcoming[0].category, 'coming-soon', 'new upcoming titles default to Coming Soon');
  const promoted = await A('PUT', '/catalog/upcoming/soon-1', { ...up, category: 'releasing-this-month' });
  assert.equal(promoted.status, 200);
  assert.equal((await call('GET', '/catalog')).body.upcoming.find((u) => u.id === 'soon-1').category, 'releasing-this-month', 'multiple upcoming entries can be assigned to the release category');
  assert.deepEqual(afterUpcomingCreate.homePosters, JSON.parse(fs.readFileSync(new URL('data/studio.json', ROOT), 'utf8')).homePosters);
  const g = { id: 'ph-1', group: 'Set', image: seed.gallery[0].image, caption: '' };
  assert.equal((await A('POST', '/catalog/gallery', g)).status, 201);
  assert.equal((await A('POST', '/catalog/gallery', { ...g, id: 'ph-2', image: 'https://cdn.example.com/x.jpg' })).status, 201);
  const ids = (await call('GET', '/catalog')).body.gallery.map((x) => x.id); assert.deepEqual(ids.slice(-2), ['ph-1', 'ph-2']);
  const re = await A('PUT', '/catalog/gallery/order', { ids: ['ph-2', 'ph-1', 'ghost'] }); assert.equal(re.status, 200); assert.deepEqual(re.body.ids.slice(0, 2), ['ph-2', 'ph-1']);
  assert.deepEqual((await call('GET', '/catalog')).body.gallery.map((x) => x.id).slice(0, 2), ['ph-2', 'ph-1'], 'moved to the front; the rest keep their order');
  assert.equal((await A('PUT', '/catalog/videos/order', { ids: [] })).status, 400);
  await A('DELETE', '/catalog/gallery/ph-1'); await A('DELETE', '/catalog/gallery/ph-2'); await A('DELETE', '/catalog/upcoming/soon-1');
  // reminders for a removed upcoming title go too
  const st = (await A('GET', '/catalog')).body.studio;
  assert.equal((await A('PUT', '/studio', { ...st, studio: { ...st.studio, email: 'not-an-email' } })).status, 400);
  const bannerPosters = { releasingThisMonth: 'media/upcoming/poster-4-lg.webp', releasingThisMonthMobile: 'media/upcoming/poster-4-sm.webp', releasingThisMonthId: seed.upcoming[0].id };
  const bannerSave = await A('PUT', '/studio', { ...st, homePosters: bannerPosters }); assert.equal(bannerSave.status, 200);
  assert.deepEqual((await call('GET', '/catalog')).body.homePosters, bannerPosters, 'homepage banner artwork is exposed from the editable studio settings');
  const ok = await A('PUT', '/studio', { ...st, homePosters: bannerPosters, studio: { ...st.studio, tagline: 'A new tagline', phones: ['+91 1', '+91 2'] }, team: st.team.slice(0, 2) }); assert.equal(ok.status, 200);
  const pub = (await call('GET', '/studio')).body; assert.equal(pub.studio.tagline, 'A new tagline'); assert.equal(pub.team.length, 2); assert.deepEqual(pub.homePosters, bannerPosters);
  await A('PUT', '/studio', st);
  assert.equal(((await audit('catalog.')).length) >= 8, true);
});

test('uploads: images are sniffed, stored by content hash and served; videos get a presigned R2 PUT', async () => {
  const up = await A('POST', '/uploads/image', null, { raw: PNG, headers: { 'Content-Type': 'image/png' } }); assert.equal(up.status, 201); assert.match(up.body.path, /^uploads\/[0-9a-f]{24}\.png$/);
  const again = await A('POST', '/uploads/image', null, { raw: PNG, headers: { 'Content-Type': 'image/png' } }); assert.equal(again.body.path, up.body.path, 'same bytes → same file');
  const file = await fetch(`${root}/${up.body.path}`); assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/png'); assert.match(file.headers.get('cache-control'), /immutable/);
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
  for (const [name, body, type] of [['svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'image/svg+xml'], ['html', '<script>alert(1)</script>', 'image/png'], ['empty', '', 'image/png']]) {
    const r = await A('POST', '/uploads/image', null, { raw: body, headers: { 'Content-Type': type } }); assert.equal(r.status, 400, name);
  }
  const fiveMbImage = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  const fiveMbUpload = await A('POST', '/uploads/image', null, { raw: fiveMbImage, headers: { 'Content-Type': 'image/png' } });
  assert.equal(fiveMbUpload.status, 201, '5 MB poster uploads fit under the 10 MB image request limit');
  assert.equal(fiveMbUpload.body.bytes, fiveMbImage.length);
  assert.equal((await A('POST', '/uploads/image', null, { raw: Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]), headers: { 'Content-Type': 'image/png' } })).status, 413);
  assert.equal((await call('POST', '/admin/uploads/image', null, viewer.token, { raw: PNG })).status, 403);
  // an uploaded image can be used in the catalog (and a made-up uploads/ path cannot)
  assert.equal((await A('POST', '/catalog/gallery', { id: 'up-1', group: 'U', image: up.body.path })).status, 201);
  assert.equal((await A('POST', '/catalog/gallery', { id: 'up-2', group: 'U', image: 'uploads/ffffffffffffffffffffffff.png' })).status, 400);
  await A('DELETE', '/catalog/gallery/up-1');
  // video → presigned URL
  const v = await A('POST', '/uploads/video', { filename: 'Episode 6 Final.mp4', slug: 'shahid-ep6', size: 1e9 }); assert.equal(v.status, 201);
  assert.match(v.body.key, /^premium\/shahid-ep6\/[0-9a-f]{8}-episode-6-final\.mp4$/); assert.equal(v.body.uploadUrl, `https://r2.test/put/${v.body.key}?sig=1`); assert.equal(v.body.contentType, 'video/mp4'); assert.equal(puts.at(-1), v.body.key);
  assert.equal((await A('POST', '/uploads/video', { filename: 'virus.exe' })).status, 400);
  assert.equal((await A('POST', '/uploads/video', { filename: 'big.mp4', size: 6 * 1024 ** 3 })).status, 400);
  assert.equal((await call('POST', '/admin/uploads/video', { filename: 'a.mp4' }, viewer.token)).status, 403);
});

test('uploads live in MySQL: a Releasing This Month poster uploaded on one device shows on every other device, even after the disk is wiped', async () => {
  // The reported bug: an admin uploads a poster, the catalog row is saved in MySQL, but the image FILE sat only on this server's disk -
  // so after a restart or redeploy (Render's free plan wipes the disk each time) every other device got a broken image.
  const art = Buffer.concat([PNG, crypto.randomBytes(2048)]);                 // stands in for the 16:9 poster artwork
  const up = await A('POST', '/uploads/image', null, { raw: art, headers: { 'Content-Type': 'image/png' } });
  assert.equal(up.status, 201);
  const name = path.basename(up.body.path);
  assert.deepEqual((await db.uploads.get(name)).data, art, 'the durable copy is in MySQL, not only on disk');
  assert.equal((await db.uploads.existing([name, 'ffffffffffffffffffffffff.png'])).size, 1);

  fs.rmSync(uploadDir, { recursive: true, force: true });                     // restart / redeploy: the upload folder is empty again
  assert.equal(fs.existsSync(path.join(uploadDir, name)), false);

  // The title is created after the wipe: the validator must accept an upload that exists only in MySQL - and still refuse one that exists nowhere.
  const created = await A('POST', '/catalog/upcoming', { id: 'release-1', title: 'Release One', category: 'releasing-this-month', poster: up.body.path, backdrop: up.body.path });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const ghost = await A('POST', '/catalog/upcoming', { id: 'release-ghost', title: 'Ghost', poster: 'uploads/ffffffffffffffffffffffff.png' });
  assert.equal(ghost.status, 400); assert.match(ghost.body.error.message, /does not exist/);

  // Another device: no sign-in, no browser cache. It sees the title in the release category with its artwork ...
  const seen = (await call('GET', '/catalog')).body.upcoming.find((u) => u.id === 'release-1');
  assert.equal(seen.category, 'releasing-this-month'); assert.equal(seen.backdrop, up.body.path);
  // ... and the artwork itself loads: served from MySQL, then copied back to the folder.
  const img = await fetch(`${root}/${seen.backdrop}`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await img.arrayBuffer()), art);
  assert.equal(fs.existsSync(path.join(uploadDir, name)), true, 'the folder is only a cache');

  // Later edits keep working while the file is missing from disk (they used to fail with "file ... does not exist").
  fs.rmSync(uploadDir, { recursive: true, force: true });
  const edited = await A('PUT', '/catalog/upcoming/release-1', { ...seen, title: 'Release One (edited)' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));

  // Subtitles take the same path.
  const sub = await A('POST', '/uploads/subtitle', null, { raw: '1\n00:00:01,000 --> 00:00:02,000\nHello\n', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(sub.status, 201);
  fs.rmSync(uploadDir, { recursive: true, force: true });
  const vtt = await fetch(`${root}/${sub.body.path}`);
  assert.equal(vtt.status, 200); assert.match(vtt.headers.get('content-type'), /^text\/vtt/); assert.match(await vtt.text(), /^WEBVTT/);

  // The setup checklist reports where uploads are kept.
  const health = (await A('GET', '/health')).body.checks.find((c) => c.id === 'uploads');
  assert.equal(health.ok, true); assert.match(health.detail, /MySQL/);
  await A('DELETE', '/catalog/upcoming/release-1');
});

test('messages: triage inbox', async () => {
  for (const n of ['One', 'Two']) await call('POST', '/contact', { name: n, email: `${n}@example.com`, message: `hello ${n}` });
  let m = (await A('GET', '/messages')).body; assert.equal(m.total, 2); assert.equal(m.messages[0].handledAt, null); assert.equal((await A('GET', '/stats')).body.openMessages, 2);
  const id = m.messages[0].id;
  assert.equal((await A('PATCH', `/messages/${id}`, { handled: true })).status, 204);
  assert.equal((await A('GET', '/messages')).body.total, 1); const h = (await A('GET', '/messages?status=handled')).body; assert.equal(h.total, 1); assert.equal(h.messages[0].handledBy, 'boss@example.com');
  assert.equal((await A('GET', '/messages?status=all')).body.total, 2);
  assert.equal((await A('PATCH', `/messages/${id}`, { handled: false })).status, 204); assert.equal((await A('GET', '/messages')).body.total, 2);
  assert.equal((await A('PATCH', `/messages/${id}`, { handled: 'yes' })).status, 400); assert.equal((await A('PATCH', '/messages/nope', { handled: true })).status, 404);
  assert.equal((await A('DELETE', `/messages/${id}`)).status, 204); assert.equal((await A('DELETE', `/messages/${id}`)).status, 404); assert.equal((await A('GET', '/messages?status=all')).body.total, 1);
});

test('payments list + coupons: filters, delete only when never used; everything is audited with who did it', async () => {
  assert.equal((await A('POST', '/coupons', { code: 'temp10', kind: 'percent', value: 10 })).status, 201);
  assert.equal((await A('DELETE', '/coupons/TEMP10')).status, 204); assert.equal((await A('DELETE', '/coupons/TEMP10')).status, 404);
  await A('POST', '/coupons', { code: 'USED', kind: 'percent', value: 10 });
  await db.pool.query("INSERT INTO payments (id, user_id, plan_id, provider, provider_order_id, amount_paise, coupon_code, status) VALUES ('p-used', ?, 'plus-monthly', 'razorpay', 'order_x', 8910, 'USED', 'created')", [viewer.id]);
  assert.equal((await A('DELETE', '/coupons/USED')).body.error.code, 'coupon_used');
  const l = (await A('GET', '/coupons')).body; assert.equal(l.plans.length, 2); assert.ok(l.coupons.some((c) => c.code === 'USED'));
  const pay = (await A('GET', '/payments?status=created')).body; assert.equal(pay.total, 1); assert.equal(pay.payments[0].userEmail, 'viewer@example.com'); assert.equal((await A('GET', '/payments?status=paid')).body.total, 0);
  assert.equal((await A('GET', '/payments?email=viewer@example.com')).body.total, 1);
  const detail = (await A('GET', `/users/${viewer.id}`)).body; assert.equal(detail.payments.length, 1);
  await call('POST', '/admin/coupons', { code: 'BYTOKEN', kind: 'flat', value: 500 }, TOKEN);
  const e = await audit('coupon.'); assert.ok(e.some((x) => x.actor === 'boss@example.com' && x.action === 'coupon.create' && x.target === 'USED')); assert.ok(e.some((x) => x.actor === 'ADMIN_TOKEN' && x.target === 'BYTOKEN'));
  assert.ok(e.every((x) => x.id && x.at)); assert.equal((await A('GET', '/audit?limit=2')).body.entries.length, 2);
  const before = (await A('GET', '/audit?limit=1')).body.entries[0].id; assert.ok((await A('GET', `/audit?before=${before}&limit=1`)).body.entries[0].id < before);
  assert.equal((await call('GET', '/admin/audit', null, viewer.token)).status, 403);
});

test('the admin page is served with a strict CSP and is never cached', async () => {
  for (const p of ['/admin', '/admin/']) {
    const r = await fetch(root + p); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /html/); assert.equal(r.headers.get('cache-control'), 'no-store');
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /script-src[^;]*https:\/\/accounts\.google\.com/);
    assert.match(csp, /script-src[^;]*https:\/\/connect\.facebook\.net/);
    assert.match(csp, /script-src[^;]*https:\/\/appleid\.cdn-apple\.com/);
    assert.match(csp, /frame-src[^;]*https:\/\/accounts\.google\.com/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  }
  assert.equal((await fetch(root + '/admin/admin.css')).status, 200); assert.equal((await fetch(root + '/admin/js/main.js')).status, 200);
  assert.equal((await fetch(root + '/admin/../server/src/app.js')).status, 404);
});
