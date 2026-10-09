// Admin uploads (posters, thumbnails, subtitles) are stored in MySQL; the upload folder is only a cache. On a host with a throw-away
// disk (Render's free plan wipes it on every deploy and restart) an image that was uploaded from one device used to vanish for everybody
// else: the catalog row survived in MySQL but the file did not. These tests cover the serving side - a file missing from disk is served from
// MySQL - and the image hotlink guard that also has to let the website, the native app and listed hosts show those images.
// Needs no MySQL: the database is an in-memory stub (just enough of `uploads`, `catalog` and `audit`) driven through the real Express routes;
// the MySQL-backed twin of the admin flow lives in admin.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { describeImage, describeImageVariant, describeSubtitle, cacheUpload, UPLOAD_NAME, uploadType } from '../src/uploads.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), crypto.randomBytes(32)]);
const NAME = describeImage(PNG).name;
const VTT = describeSubtitle('WEBVTT\n\n00:00.000 --> 00:01.000\nহ্যালো\n');

// Stub database: `uploads`, `catalog` (the admin's catalog writes + the public catalog) and `audit` are real in-memory fakes; every other method answers null.
const stored = new Map();
const asked = [];
const TOKEN = 'a'.repeat(32);   // the shared ADMIN_TOKEN: lets the admin routes run without user accounts
const fakeDb = () => {
  const items = { shows: [], videos: [], upcoming: [], gallery: [] };
  let version = 1;
  const duplicate = () => Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
  const catalog = {
    seed: async () => false,
    version: async () => version,
    snapshot: async () => ({ catalog: { schema: 1, updatedAt: null, ...structuredClone(items) }, studio: null }),
    put: async (key, id, doc, { create = false } = {}) => {
      const list = items[key], i = list.findIndex((d) => d.id === id);
      if (create) { if (i >= 0) throw duplicate(); list.unshift(structuredClone(doc)); version++; return 'created'; }
      if (i < 0) return null; list[i] = structuredClone(doc); version++; return 'updated';
    },
    remove: async (key, id) => { const list = items[key], i = list.findIndex((d) => d.id === id); if (i < 0) return null; list.splice(i, 1); version++; return { removed: 1, videos: 0 }; },
  };
  const uploads = {
    get: async (name) => { asked.push(name); return stored.get(name) ?? null; },
    put: async (name, type, data) => { stored.set(name, { type, data }); },
    existing: async (names) => new Set(names.filter((n) => stored.has(n))),
  };
  return new Proxy({ uploads, catalog, audit: { add: async () => {} }, settings: { all: async () => ({}) } }, { get: (target, prop) => (prop in target ? target[prop] : async () => null) });
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-uploads-'));
const servers = [];
const start = async (opts = {}) => {
  const dir = fs.mkdtempSync(path.join(tmp, 'u-'));
  const app = createApp({ db: fakeDb(), jwtSecret: 'test-secret', rate: false, uploadDir: dir, adminToken: TOKEN, ...opts });
  const server = app.listen(0); await new Promise((r) => server.once('listening', r)); servers.push(server);
  return { dir, base: `http://127.0.0.1:${server.address().port}` };
};
test.after(() => { servers.forEach((s) => s.close()); fs.rmSync(tmp, { recursive: true, force: true }); });

test('upload helpers: names are content hashes, types come from the extension, the folder copy is best effort', () => {
  assert.match(NAME, UPLOAD_NAME);
  assert.equal(describeImage(PNG).name, NAME, 'the same bytes always get the same name');
  assert.equal(describeImage(Buffer.from('not an image')), null);
  assert.equal(uploadType('a.webp'), 'image/webp');
  assert.equal(uploadType('a.jpg'), 'image/jpeg');
  assert.match(uploadType(VTT.name), /^text\/vtt/);
  assert.match(VTT.name, UPLOAD_NAME);
  assert.equal(VTT.data.toString('utf8').startsWith('WEBVTT'), true);
  const dir = fs.mkdtempSync(path.join(tmp, 'h-'));
  assert.equal(cacheUpload(dir, NAME, PNG), true);
  assert.deepEqual(fs.readFileSync(path.join(dir, NAME)), PNG);
  assert.equal(cacheUpload(dir, NAME, PNG), true, 'writing again is harmless');
  const file = path.join(tmp, 'a-file-not-a-folder'); fs.writeFileSync(file, 'x');
  assert.equal(cacheUpload(path.join(file, 'sub'), NAME, PNG), false, 'an unwritable folder is reported, not thrown');

  const high = describeImage(PNG, { progressive: true });
  const low = describeImageVariant(WEBP, high.name);
  assert.match(high.name, /^[0-9a-f]{24}-hq\.png$/);
  assert.equal(low.path, `uploads/${high.name.slice(0, 24)}-low.webp`);
  assert.match(low.name, UPLOAD_NAME);
  assert.equal(describeImageVariant(PNG, high.name), null, 'compact variants must really be WebP');
  assert.equal(describeImageVariant(WEBP, NAME), null, 'a legacy image is not a progressive parent');
});

test('an image that is missing from the disk is served from MySQL, cached for a year, and copied back to disk', async () => {
  const { dir, base } = await start();
  stored.set(NAME, { type: 'image/png', data: PNG });
  assert.equal(fs.existsSync(path.join(dir, NAME)), false, 'a fresh server (new deploy) starts with an empty folder');

  const res = await fetch(`${base}/uploads/${NAME}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control'), /max-age=31536000/);
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG, 'the very bytes that were uploaded');
  assert.equal(fs.existsSync(path.join(dir, NAME)), true, 'the folder is a cache: the file was written back');

  const before = asked.length;
  const again = await fetch(`${base}/uploads/${NAME}`);
  assert.equal(again.status, 200);
  assert.deepEqual(Buffer.from(await again.arrayBuffer()), PNG);
  assert.equal(asked.length, before, 'the second request is answered from disk, not MySQL');

  const head = await fetch(`${base}/uploads/${NAME}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'image/png');
});

test('new catalog image uploads save a compact WebP rendition beside the durable high-quality original', async () => {
  const { dir, base } = await start();
  const highBytes = Buffer.concat([PNG, crypto.randomBytes(4096)]);
  const lowBytes = Buffer.concat([WEBP, crypto.randomBytes(8)]);
  const upload = (body, headers = {}) => fetch(`${base}/api/v1/admin/uploads/image`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/png', ...headers }, body,
  });

  const highResponse = await upload(highBytes, { 'X-Image-Renditions': 'progressive' });
  assert.equal(highResponse.status, 201, await highResponse.clone().text());
  const high = await highResponse.json();
  assert.match(high.path, /^uploads\/[0-9a-f]{24}-hq\.png$/);
  assert.deepEqual(stored.get(path.basename(high.path)).data, highBytes);

  const badVariant = await upload(Buffer.concat([WEBP, crypto.randomBytes(highBytes.length)]), { 'X-Image-Variant-Of': path.basename(high.path) });
  assert.equal(badVariant.status, 400, 'a compact variant may not be larger than its original');
  const compactResponse = await upload(lowBytes, { 'Content-Type': 'image/webp', 'X-Image-Variant-Of': path.basename(high.path) });
  assert.equal(compactResponse.status, 201, await compactResponse.clone().text());
  const compact = await compactResponse.json();
  assert.equal(compact.path, `uploads/${path.basename(high.path).slice(0, 24)}-low.webp`);
  assert.equal(compact.variant, 'low');
  assert.deepEqual(stored.get(path.basename(compact.path)).data, lowBytes);
  assert.equal(stored.get(path.basename(compact.path)).type, 'image/webp');
  const createTitle = await fetch(`${base}/api/v1/admin/catalog/upcoming`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'rendition-poster', title: 'Rendition Poster', poster: high.path, backdrop: high.path }),
  });
  assert.equal(createTitle.status, 201, await createTitle.clone().text());
  const publicTitle = ((await (await fetch(`${base}/api/v1/catalog`)).json()).upcoming || []).find((item) => item.id === 'rendition-poster');
  assert.equal(publicTitle.poster, high.path, 'the content catalog references the full-quality upload');
  assert.equal(fs.existsSync(path.join(dir, path.basename(high.path))), true);
  assert.equal(fs.existsSync(path.join(dir, path.basename(compact.path))), true);

  fs.rmSync(dir, { recursive: true, force: true });
  const lowFetch = await fetch(`${base}/${compact.path}`);
  assert.equal(lowFetch.status, 200, 'the compact variant is served from MySQL after a disk wipe');
  assert.equal(lowFetch.headers.get('content-type'), 'image/webp');
  assert.match(lowFetch.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await lowFetch.arrayBuffer()), lowBytes);
  assert.equal(fs.existsSync(path.join(dir, path.basename(compact.path))), true, 'the cache is repopulated');
});

test('subtitles are served from MySQL with the right type, and a stored file survives the loss of the whole folder', async () => {
  const { dir, base } = await start();
  stored.set(VTT.name, { type: VTT.type, data: VTT.data });
  const res = await fetch(`${base}/uploads/${VTT.name}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/vtt/);
  assert.equal(await res.text(), VTT.data.toString('utf8'));
  fs.rmSync(dir, { recursive: true, force: true });   // the redeploy: the disk is gone
  const after = await fetch(`${base}/uploads/${VTT.name}`);
  assert.equal(after.status, 200, 'still served - from MySQL');
});

test('unknown or malformed names are a plain 404, and odd names never reach MySQL', async () => {
  const { base } = await start();
  const never = ['..%2f..%2fetc%2fpasswd', 'ABCDEF0123456789ABCDEF01.png', 'abc.png', `${NAME}.exe`, `${NAME.replace('.png', '.svg')}`, '.env', `x/${NAME}`];
  asked.length = 0;
  for (const n of never) assert.equal((await fetch(`${base}/uploads/${n}`)).status, 404, n);
  assert.deepEqual(asked, [], 'names that are not content-hash file names are rejected before any lookup');
  assert.equal((await fetch(`${base}/uploads/ffffffffffffffffffffffff.png`)).status, 404, 'well-formed but never uploaded');
  assert.deepEqual(asked, ['ffffffffffffffffffffffff.png']);
});

test('Broadcast photos upload to private R2, avoid the MySQL uploads store, and resolve through a stable URL', async () => {
  const objects = new Map();
  const r2 = {
    configured: true,
    async putObject(key, data, metadata) { objects.set(key, { data: Buffer.from(data), ...metadata }); },
    presignGet(key, { ttl }) { return `https://r2.example.test/${key}?ttl=${ttl}`; },
  };
  const { base } = await start({ r2 });
  const image = Buffer.concat([PNG, crypto.randomBytes(32)]);
  const upload = await fetch(`${base}/api/v1/admin/uploads/broadcast-image`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/png', 'X-Image-Renditions': 'progressive' }, body: image,
  });
  assert.equal(upload.status, 201, await upload.clone().text());
  const result = await upload.json();
  assert.match(result.path, /^r2-assets\/broadcast\/[0-9a-f]{24}-hq\.png$/);
  const name = result.path.split('/').at(-1), key = `broadcast/${name}`;
  assert.deepEqual(objects.get(key).data, image, 'the high-quality image is written to R2');
  assert.equal(objects.get(key).contentType, 'image/png');
  assert.match(objects.get(key).cacheControl, /immutable/);
  assert.equal(stored.has(name), false, 'Broadcast photos are not copied into MySQL uploaded_files');

  const compactBytes = Buffer.concat([WEBP, crypto.randomBytes(8)]);
  const compactUpload = await fetch(`${base}/api/v1/admin/uploads/broadcast-image`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/webp', 'X-Image-Variant-Of': name }, body: compactBytes,
  });
  assert.equal(compactUpload.status, 201, await compactUpload.clone().text());
  const compact = await compactUpload.json();
  assert.equal(compact.path, `r2-assets/broadcast/${name.slice(0, 24)}-low.webp`);
  assert.deepEqual(objects.get(`broadcast/${path.basename(compact.path)}`).data, compactBytes);
  assert.equal(objects.get(`broadcast/${path.basename(compact.path)}`).contentType, 'image/webp');

  const previewResponse = await fetch(`${base}/api/v1/admin/notifications/preview`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'push', title: 'New release', body: 'Watch now', imageUrl: result.path }),
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(new URL(preview.image, 'https://preview.example').pathname, `/${result.path}`);
  assert.equal(preview.push.image, preview.image, 'the image URL is in the actual push payload too');

  const stableUrl = await fetch(`${base}/${result.path}`, { redirect: 'manual' });
  assert.equal(stableUrl.status, 302);
  assert.equal(stableUrl.headers.get('location'), `https://r2.example.test/${key}?ttl=3600`);
  assert.match(stableUrl.headers.get('cache-control'), /max-age=60/);
  const stableLow = await fetch(`${base}/${compact.path}`, { redirect: 'manual' });
  assert.equal(stableLow.status, 302, 'the compact Broadcast variant has a public stable R2 URL too');
  assert.equal(stableLow.headers.get('location'), `https://r2.example.test/broadcast/${path.basename(compact.path)}?ttl=3600`);
  assert.equal((await fetch(`${base}/r2-assets/broadcast/not-an-image.png`, { redirect: 'manual' })).status, 404);
});

test('hotlink guard: the website, the native app and listed hosts may show uploads; other sites may not', async () => {
  stored.set(NAME, { type: 'image/png', data: PNG });
  const { base } = await start({ billing: { config: { siteUrl: 'https://watch.example.in', supportEmail: '' } } });
  const get = (referer, headers = {}) => fetch(`${base}/uploads/${NAME}`, { headers: { ...(referer ? { Referer: referer } : {}), ...headers } });

  assert.equal((await get(null)).status, 200, 'no Referer (address bar, privacy settings): allowed');
  assert.equal((await get(`${base}/`)).status, 200, 'the same host (the website served by this server)');
  assert.equal((await get('https://watch.example.in/show/x')).status, 200, 'the public site (PUBLIC_SITE_URL)');
  assert.equal((await get('https://www.watch.example.in/')).status, 200, '... also with www');
  assert.equal((await get('https://app.addabaaz.in/')).status, 200, 'the Android/iOS app WebView (this was refused before)');
  assert.equal((await get('https://evil.example/blog')).status, 403, 'another site cannot hot-link our images');
  assert.equal((await get('https://evil.example/blog', { 'User-Agent': 'facebookexternalhit/1.1' })).status, 200, 'link-preview crawlers keep working');
});

test('hotlink guard: CORS_ORIGINS entries and IMAGE_ALLOWED_HOSTS are allowed too', async () => {
  stored.set(NAME, { type: 'image/png', data: PNG });
  const previous = process.env.IMAGE_ALLOWED_HOSTS;
  process.env.IMAGE_ALLOWED_HOSTS = 'cdn.partner.example, Studio.Example';
  try {
    const { base } = await start({ corsOrigins: 'https://stage.example.org,https://other.example.org' });
    const get = (referer) => fetch(`${base}/uploads/${NAME}`, { headers: { Referer: referer } });
    assert.equal((await get('https://stage.example.org/')).status, 200, 'an explicit CORS origin');
    assert.equal((await get('https://cdn.partner.example/page')).status, 200, 'IMAGE_ALLOWED_HOSTS entry');
    assert.equal((await get('https://studio.example/page')).status, 200, 'host names are compared case-insensitively');
    assert.equal((await get('https://evil.example/')).status, 403);
    assert.equal((await get('https://addabaaz.in/')).status, 200, 'the default public site');
  } finally {
    if (previous === undefined) delete process.env.IMAGE_ALLOWED_HOSTS; else process.env.IMAGE_ALLOWED_HOSTS = previous;
  }
});

// The reported bug, end to end through the real admin routes: upload on one device, the disk is wiped by a redeploy, the title is created and
// edited afterwards, and another device (no sign-in, nothing cached) loads the public catalog and the artwork.
test('Releasing This Month: an upload survives a disk wipe, can be used and edited afterwards, and shows on another device', async () => {
  const { dir, base } = await start();
  const admin = (method, p, body, headers = {}) => fetch(`${base}/api/v1/admin${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...headers }, body });
  const json = (method, p, doc) => admin(method, p, JSON.stringify(doc), { 'Content-Type': 'application/json' });
  const art = Buffer.concat([PNG, crypto.randomBytes(4096)]);
  const wipeDisk = () => fs.rmSync(dir, { recursive: true, force: true });   // a restart / redeploy on a host with a throw-away disk

  const up = await admin('POST', '/uploads/image', art, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 201);
  const uploaded = await up.json();
  const name = path.basename(uploaded.path);
  assert.match(uploaded.path, /^uploads\/[0-9a-f]{24}\.png$/);
  assert.equal(uploaded.bytes, art.length);
  assert.deepEqual(stored.get(name).data, art, 'the durable copy is stored in the database');
  assert.equal(stored.get(name).type, 'image/png');
  assert.equal(fs.existsSync(path.join(dir, name)), true, 'and a cache copy sits in the upload folder');

  wipeDisk();
  const created = await json('POST', '/catalog/upcoming', { id: 'release-1', title: 'Release One', category: 'releasing-this-month', poster: uploaded.path, backdrop: uploaded.path });
  assert.equal(created.status, 201, 'the validator accepts an upload that exists only in the database: ' + await created.clone().text());
  const ghost = await json('POST', '/catalog/upcoming', { id: 'release-ghost', title: 'Ghost', poster: 'uploads/ffffffffffffffffffffffff.png' });
  assert.equal(ghost.status, 400, 'an upload that exists nowhere is still refused');
  assert.match((await ghost.json()).error.message, /does not exist/);
  const traversal = await json('POST', '/catalog/upcoming', { id: 'release-evil', title: 'Evil', poster: 'uploads/../package.json' });
  assert.equal(traversal.status, 400, 'a path trick is still refused');

  // Another device: public catalog, no credentials.
  const seen = ((await (await fetch(`${base}/api/v1/catalog`)).json()).upcoming || []).find((u) => u.id === 'release-1');
  assert.ok(seen, 'the new title is in the public catalog');
  assert.equal(seen.category, 'releasing-this-month');
  assert.equal(seen.backdrop, uploaded.path);
  const img = await fetch(`${base}/${seen.backdrop}`);
  assert.equal(img.status, 200, 'the artwork loads');
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), art);

  wipeDisk();   // wiped again: editing the title (which still points at the upload) used to fail with "file ... does not exist"
  const edited = await json('PUT', '/catalog/upcoming/release-1', { ...seen, title: 'Release One (edited)' });
  assert.equal(edited.status, 200, await edited.clone().text());
  const after = ((await (await fetch(`${base}/api/v1/catalog`)).json()).upcoming || []).find((u) => u.id === 'release-1');
  assert.equal(after.title, 'Release One (edited)');

  // Subtitles take the same path.
  const sub = await admin('POST', '/uploads/subtitle', '1\n00:00:01,000 --> 00:00:02,000\nHello\n', { 'Content-Type': 'text/plain' });
  assert.equal(sub.status, 201);
  const subtitle = await sub.json();
  assert.equal(subtitle.cues, 1);
  wipeDisk();
  const vtt = await fetch(`${base}/${subtitle.path}`);
  assert.equal(vtt.status, 200);
  assert.match(vtt.headers.get('content-type'), /^text\/vtt/);
  assert.match(await vtt.text(), /^WEBVTT/);

  // Not an image / not signed in.
  assert.equal((await admin('POST', '/uploads/image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { 'Content-Type': 'image/svg+xml' })).status, 400);
  assert.equal((await fetch(`${base}/api/v1/admin/uploads/image`, { method: 'POST', body: art })).status, 401);
});
