// Manual YouTube catalog refresh tests: Atom parsing, admin-only sync, and database-backed public display.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { Catalog } from '../../app/js/data/catalog.js';
import { matchRoute } from '../../app/js/routes.js';
import { pageMeta } from '../../app/js/seo/meta.js';
import { bodyHtml } from '../src/seo.js';
import { createYouTubeFeed, DEFAULT_YOUTUBE_CHANNEL_ID, parseYouTubeFeed } from '../src/youtube-feed.js';

const atom = (items) => `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">${items}</feed>`;
const entry = (id, title, published) => `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><published>${published}</published></entry>`;
const SAMPLE = atom([
  entry('AAAAAAAAAAA', 'Older upload', '2026-09-29T08:00:00Z'),
  entry('BBBBBBBBBBB', 'Latest &amp; newest &#x1F602;', '2026-09-30T13:30:18+00:00'),
  entry('short-id', 'Bad video id', '2026-09-30T14:00:00Z'),
  entry('CCCCCCCCCCC', 'Bad date', 'not-a-date'),
  entry('DDDDDDDDDDD', '<![CDATA[Title from CDATA]]>', '2026-09-28T08:00:00Z'),
]);

test('parseYouTubeFeed decodes XML, validates entries, sorts newest-first and builds safe YouTube URLs', () => {
  const uploads = parseYouTubeFeed(SAMPLE);
  assert.deepEqual(uploads.map((v) => v.id), ['BBBBBBBBBBB', 'AAAAAAAAAAA', 'DDDDDDDDDDD']);
  assert.equal(uploads[0].title, 'Latest & newest 😂');
  assert.equal(uploads[2].title, 'Title from CDATA');
  assert.equal(uploads[0].publishedAt, '2026-09-30T13:30:18.000Z');
  assert.equal(uploads[0].thumbnail, 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg');
  assert.equal(uploads[0].url, 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
  assert.deepEqual(parseYouTubeFeed('<feed></feed>'), []);
});

test('the Latest from YouTube page uses catalog records and has a canonical collection URL', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
  const cat = new Catalog(data);
  const route = matchRoute('/youtube');
  assert.equal(route.view, 'youtube');
  const meta = pageMeta({ path: '/youtube', cat, origin: 'https://addabaaz.example' });
  assert.equal(meta.status, 200);
  assert.equal(meta.canonical, '/youtube');
  assert.match(meta.title, /Latest YouTube Uploads/);
  assert.equal(meta.jsonld[0]['@type'], 'CollectionPage');
  const seoBody = bodyHtml(meta, route, cat, null, []);
  assert.match(seoBody, /Latest from YouTube/);
  assert.match(seoBody, /administrator refreshes the catalog/);
  assert.match(seoBody, /https:\/\/www\.youtube\.com\/@ADDABAAZ01/);
});

test('createYouTubeFeed only fetches when refresh() is explicitly called and refreshes each time', async () => {
  let now = Date.parse('2026-10-01T00:00:00Z'), calls = 0;
  const service = createYouTubeFeed({
    channelId: DEFAULT_YOUTUBE_CHANNEL_ID,
    now: () => now,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, `https://www.youtube.com/feeds/videos.xml?channel_id=${DEFAULT_YOUTUBE_CHANNEL_ID}`);
      assert.ok(options.signal);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(SAMPLE, { status: 200 });
    },
  });
  assert.equal(calls, 0, 'constructing the service does not contact YouTube');
  const [first, concurrent] = await Promise.all([service.refresh(), service.refresh()]);
  assert.equal(calls, 1, 'concurrent manual requests share one upstream call');
  assert.deepEqual(concurrent, first);
  assert.equal(first.configured, true);
  assert.equal(first.videos.length, 3);
  now += 60_000;
  await service.refresh();
  assert.equal(calls, 2, 'a later admin refresh always asks YouTube for a fresh feed');
});

test('createYouTubeFeed does not fetch an invalid channel or disguise an upstream failure as success', async () => {
  let requests = 0;
  const disabled = createYouTubeFeed({ channelId: 'not-a-channel-id', fetchImpl: async () => { requests++; throw new Error('must not fetch'); } });
  assert.deepEqual(await disabled.refresh(), { videos: [], updatedAt: null, configured: false });
  assert.equal(requests, 0);

  const failed = createYouTubeFeed({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(failed.refresh(), /offline/);
});

const ADMIN_TOKEN = 'youtube-admin-test-token-that-is-long-enough';
const VIEWER_TOKEN = signToken('viewer', 'test-secret');
const feedVideos = [
  { id: 'BBBBBBBBBBB', title: 'Latest upload', publishedAt: '2026-09-30T13:30:18.000Z', thumbnail: 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB' },
  { id: 'AAAAAAAAAAA', title: 'Older upload', publishedAt: '2026-09-29T08:00:00.000Z', thumbnail: 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' },
];
const auditEntries = [];
const stored = { schema: 1, updatedAt: null, shows: [], videos: [], upcoming: [], gallery: [] };
let catalogVersion = 0, feedCalls = 0, feedUnavailable = false, server, root;
const db = {
  errors: { add: async () => {} },
  users: { byId: async (id) => id === 'viewer' ? { id, email: 'viewer@example.com', name: 'Viewer', sessionVersion: 0, isAdmin: false, disabledAt: null } : null },
  audit: { add: async (entry) => { auditEntries.push(entry); } },
  catalog: {
    async version() { return catalogVersion; },
    async seed() { return false; },
    async snapshot() { return { catalog: structuredClone(stored), studio: null }; },
    async put(key, id, doc, { create = false } = {}) {
      if (key !== 'videos' || !create) throw new Error('Unexpected catalog write in YouTube test');
      if (stored.videos.some((v) => v.id === id)) throw Object.assign(new Error('Duplicate catalog id'), { code: 'ER_DUP_ENTRY' });
      stored.videos.push(structuredClone(doc)); catalogVersion++;
      return 'created';
    },
  },
};
const youtubeFeed = {
  async refresh() {
    feedCalls++;
    if (feedUnavailable) throw new Error('upstream unavailable');
    return { videos: feedVideos, updatedAt: '2026-10-01T00:00:00.000Z', configured: true };
  },
};
const app = createApp({
  db,
  jwtSecret: 'test-secret',
  serveStatic: false,
  rate: false,
  payments: { provider: 'none' },
  mailer: { provider: 'none', send: async () => ({ sent: false }) },
  billing: { config: { gstEnabled: false, siteUrl: 'https://addabaaz.example', supportEmail: '' } },
  push: { configured: false, publicKey: '' },
  r2: { configured: false },
  youtubeFeed,
  adminToken: ADMIN_TOKEN,
  catalogPath: path.join(os.tmpdir(), `addabaaz-youtube-no-seed-${process.pid}.json`),
});
server = app.listen(0);
test.before(async () => { await new Promise((resolve) => server.once('listening', resolve)); root = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise((resolve) => server.close(resolve)); });

const call = async (method, url, body, token) => {
  const response = await fetch(root + url, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test('public catalog reads never fetch YouTube; the manual refresh is admin-only and idempotent', async () => {
  const before = feedCalls;
  const publicCatalog = await call('GET', '/api/v1/catalog');
  assert.equal(publicCatalog.status, 200);
  assert.equal(feedCalls, before, 'a public catalog page load does not contact YouTube');
  const removedPublicFeed = await call('GET', '/api/v1/youtube/latest', undefined, VIEWER_TOKEN);
  assert.equal(removedPublicFeed.status, 404, 'the old public live-feed endpoint is gone');
  assert.equal(feedCalls, before);

  const anonymous = await call('POST', '/api/v1/admin/catalog/youtube/refresh', {});
  assert.equal(anonymous.status, 401);
  const viewer = await call('POST', '/api/v1/admin/catalog/youtube/refresh', {}, VIEWER_TOKEN);
  assert.equal(viewer.status, 403);
  assert.equal(feedCalls, before, 'unauthenticated viewers cannot trigger an upstream fetch');

  const first = await call('POST', '/api/v1/admin/catalog/youtube/refresh', {}, ADMIN_TOKEN);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { added: 2, skipped: 0, checkedAt: '2026-10-01T00:00:00.000Z' });
  assert.equal(stored.videos.length, 2);
  assert.deepEqual(stored.videos[0], {
    id: 'BBBBBBBBBBB', showId: null, kind: 'clip', episode: null, title: 'Latest upload',
    source: { type: 'youtube', id: 'BBBBBBBBBBB' }, thumbnail: 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg',
    duration: 0, publishedAt: '2026-09-30T13:30:18Z', views: 0, access: 'free',
  });
  assert.equal('rating' in stored.videos[0], false, 'unrated imports stay hidden from Kids profiles until reviewed');
  assert.ok(auditEntries.some((entry) => entry.action === 'catalog.youtube.refresh' && entry.meta.added === 2));

  const second = await call('POST', '/api/v1/admin/catalog/youtube/refresh', {}, ADMIN_TOKEN);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { added: 0, skipped: 2, checkedAt: '2026-10-01T00:00:00.000Z' });
  assert.equal(stored.videos.length, 2, 'repeated refreshes do not duplicate catalog records');
  assert.equal(feedCalls, before + 2, 'only the two explicit admin actions fetched the feed');
  const catalogAfterSync = await call('GET', '/api/v1/catalog');
  assert.equal(catalogAfterSync.body.videos.length, 2);
});

test('a failed manual refresh leaves the database catalog unchanged', async () => {
  feedUnavailable = true;
  const before = stored.videos.length;
  try {
    const result = await call('POST', '/api/v1/admin/catalog/youtube/refresh', {}, ADMIN_TOKEN);
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'youtube_unavailable');
    assert.equal(stored.videos.length, before);
  } finally { feedUnavailable = false; }
});
