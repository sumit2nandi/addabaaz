// Manual YouTube catalog import tests: Atom parsing, explicit admin preview, selection, classification and import removal.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { Catalog } from '../../app/js/data/catalog.js';
import { matchRoute } from '../../app/js/routes.js';
import { pageMeta } from '../../app/js/seo/meta.js';
import { createYouTubeFeed, DEFAULT_YOUTUBE_CHANNEL_ID, parseYouTubeFeed } from '../src/youtube-feed.js';
import { validate } from '../src/catalog-schema.js';

const atom = (items) => `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">${items}</feed>`;
const entry = (id, title, published) => `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><published>${published}</published></entry>`;
const SAMPLE = atom([
  entry('AAAAAAAAAAA', 'Older landscape upload', '2026-09-29T08:00:00Z'),
  entry('BBBBBBBBBBB', 'Latest #Shorts &amp; newest &#x1F602;', '2026-09-30T13:30:18+00:00'),
  entry('short-id', 'Bad video id', '2026-09-30T14:00:00Z'),
  entry('CCCCCCCCCCC', 'Bad date', 'not-a-date'),
  entry('DDDDDDDDDDD', '<![CDATA[Title from CDATA]]>', '2026-09-28T08:00:00Z'),
]);

test('parseYouTubeFeed decodes XML, validates entries, sorts uploads and suggests Shorts vs landscape', () => {
  const uploads = parseYouTubeFeed(SAMPLE);
  assert.deepEqual(uploads.map((v) => v.id), ['BBBBBBBBBBB', 'AAAAAAAAAAA', 'DDDDDDDDDDD']);
  assert.equal(uploads[0].title, 'Latest #Shorts & newest 😂');
  assert.equal(uploads[2].title, 'Title from CDATA');
  assert.equal(uploads[0].publishedAt, '2026-09-30T13:30:18.000Z');
  assert.equal(uploads[0].thumbnail, 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg');
  assert.equal(uploads[0].url, 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
  assert.equal(uploads[0].suggestedKind, 'reel');
  assert.equal(uploads[1].suggestedKind, 'clip');
  assert.deepEqual(parseYouTubeFeed('<feed></feed>'), []);
});

test('latestVideos mixes episodes with landscape YouTube uploads but keeps Shorts in Reels', () => {
  const cat = new Catalog({ shows: [], upcoming: [], gallery: [], videos: [
    { id: 'episode', kind: 'episode', source: { type: 'youtube', id: 'AAAAAAAAAAA' }, publishedAt: '2026-09-28T00:00:00Z' },
    { id: 'landscape', kind: 'clip', source: { type: 'youtube', id: 'BBBBBBBBBBB' }, publishedAt: '2026-09-30T00:00:00Z' },
    { id: 'manual-clip', kind: 'clip', source: { type: 'mp4', url: 'https://example.test/video.mp4' }, publishedAt: '2026-10-01T00:00:00Z' },
    { id: 'short', kind: 'reel', source: { type: 'youtube', id: 'CCCCCCCCCCC' }, publishedAt: '2026-10-01T12:00:00Z' },
    { id: 'hidden', kind: 'clip', source: { type: 'youtube', id: 'DDDDDDDDDDD' }, publishedAt: '2026-10-02T12:00:00Z', hidden: true },
  ] });
  assert.deepEqual(cat.latestVideos(10).map((v) => v.id), ['landscape', 'episode']);
  assert.deepEqual(cat.reels().map((v) => v.id), ['short']);
  assert.equal(cat.video('hidden'), undefined, 'hidden titles are omitted from the static/local public catalog too');
});

test('video visibility validates as a public-by-default hidden flag', () => {
  const video = { id: 'video-1', kind: 'clip', title: 'Clip', source: { type: 'youtube', id: 'AAAAAAAAAAA' }, duration: 0, publishedAt: '2026-09-30T00:00:00Z', access: 'free' };
  assert.equal(validate('video', video).doc.hidden, false);
  assert.equal(validate('video', { ...video, hidden: true }).doc.hidden, true);
  assert.equal(validate('video', { ...video, hidden: 1 }).doc.hidden, true);
});

test('the removed YouTube landing page is no longer routed or indexable', () => {
  const cat = new Catalog({ shows: [], videos: [], upcoming: [], gallery: [] });
  assert.equal(matchRoute('/youtube'), null);
  assert.equal(pageMeta({ path: '/youtube', cat, origin: 'https://addabaaz.example' }).status, 404);
});

test('createYouTubeFeed scans every uploads-playlist page only on an explicit admin refresh', async () => {
  let now = Date.parse('2026-10-01T00:00:00Z'), calls = 0;
  const service = createYouTubeFeed({
    channelId: DEFAULT_YOUTUBE_CHANNEL_ID, apiKey: 'test-youtube-api-key',
    now: () => now,
    fetchImpl: async (url, options) => {
      calls++; assert.ok(options.signal);
      const request = new URL(url);
      assert.equal(request.searchParams.get('key'), 'test-youtube-api-key');
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (request.pathname.endsWith('/channels')) {
        assert.equal(request.searchParams.get('id'), DEFAULT_YOUTUBE_CHANNEL_ID);
        return new Response(JSON.stringify({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUdG8idFz3zA7xOaca8H6qtw' } } }] }), { status: 200 });
      }
      assert.ok(request.pathname.endsWith('/playlistItems'));
      assert.equal(request.searchParams.get('playlistId'), 'UUdG8idFz3zA7xOaca8H6qtw');
      assert.equal(request.searchParams.get('maxResults'), '50');
      if (request.searchParams.get('pageToken') === 'older') {
        return new Response(JSON.stringify({ items: [
          { snippet: { title: 'Older landscape upload', publishedAt: '2026-09-29T08:00:00Z', resourceId: { videoId: 'AAAAAAAAAAA' } }, contentDetails: { videoId: 'AAAAAAAAAAA', videoPublishedAt: '2026-09-29T08:00:00Z' } },
          { snippet: { title: 'Oldest channel upload', publishedAt: '2024-01-01T08:00:00Z', resourceId: { videoId: 'DDDDDDDDDDD' } }, contentDetails: { videoId: 'DDDDDDDDDDD', videoPublishedAt: '2024-01-01T08:00:00Z' } },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [
        { snippet: { title: 'Latest #Shorts & newest 😂', publishedAt: '2026-09-30T13:30:18Z', resourceId: { videoId: 'BBBBBBBBBBB' } }, contentDetails: { videoId: 'BBBBBBBBBBB', videoPublishedAt: '2026-09-30T13:30:18Z' } },
      ], nextPageToken: 'older' }), { status: 200 });
    },
  });
  assert.equal(calls, 0, 'constructing the service does not contact YouTube');
  const [first, concurrent] = await Promise.all([service.refresh(), service.refresh()]);
  assert.equal(calls, 3, 'concurrent scans share the channel lookup and both playlist pages');
  assert.deepEqual(concurrent, first);
  assert.equal(first.configured, true);
  assert.equal(first.complete, true);
  assert.equal(first.videos.length, 3, 'the scan includes uploads older than the public Atom feed limit');
  assert.deepEqual(first.videos.map((v) => v.id), ['BBBBBBBBBBB', 'AAAAAAAAAAA', 'DDDDDDDDDDD']);
  assert.equal(first.videos[0].suggestedKind, 'reel');
  now += 60_000;
  await service.refresh();
  assert.equal(calls, 6, 'a later explicit preview scans YouTube again');
});

test('createYouTubeFeed requires an API key for full scans and fails closed on channel/API errors', async () => {
  let requests = 0;
  const invalidChannel = createYouTubeFeed({ channelId: 'not-a-channel-id', apiKey: 'key', fetchImpl: async () => { requests++; throw new Error('must not fetch'); } });
  assert.equal((await invalidChannel.refresh()).reason, 'invalid_channel_id');
  const missingKey = createYouTubeFeed({ apiKey: '', fetchImpl: async () => { requests++; throw new Error('must not fetch'); } });
  assert.equal((await missingKey.refresh()).reason, 'missing_api_key');
  assert.equal(requests, 0);

  const failed = createYouTubeFeed({ apiKey: 'key', fetchImpl: async () => new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 }) });
  await assert.rejects(failed.refresh(), /HTTP 403 \(quotaExceeded\)/);
});

test('createYouTubeFeed refuses malformed and over-limit scans instead of returning partial results', async () => {
  const fetchPage = (items) => async (url) => new Response(JSON.stringify(new URL(url).pathname.endsWith('/channels')
    ? { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUdG8idFz3zA7xOaca8H6qtw' } } }] }
    : { items }), { status: 200 });
  const valid = { snippet: { title: 'Valid upload', publishedAt: '2026-09-30T00:00:00Z', resourceId: { videoId: 'AAAAAAAAAAA' } }, contentDetails: { videoId: 'AAAAAAAAAAA' } };
  const malformed = createYouTubeFeed({ apiKey: 'key', fetchImpl: fetchPage([valid, { snippet: { title: 'Incomplete upload', publishedAt: '2026-09-29T00:00:00Z' } }]) });
  await assert.rejects(malformed.refresh(), /invalid public upload entry/);
  const overLimit = createYouTubeFeed({ apiKey: 'key', maxUploads: 1, fetchImpl: fetchPage([
    valid,
    { snippet: { title: 'Another upload', publishedAt: '2026-09-29T00:00:00Z', resourceId: { videoId: 'BBBBBBBBBBB' } }, contentDetails: { videoId: 'BBBBBBBBBBB' } },
  ]) });
  await assert.rejects(overLimit.refresh(), /more than 1 uploads/);
});

const ADMIN_TOKEN = 'youtube-admin-test-token-that-is-long-enough';
const VIEWER_TOKEN = signToken('viewer', 'test-secret');
const feedVideos = [
  { id: 'BBBBBBBBBBB', title: 'The new #Shorts comedy reel', publishedAt: '2026-09-30T13:30:18.000Z' },
  { id: 'AAAAAAAAAAA', title: 'A landscape comedy video', publishedAt: '2026-09-29T08:00:00.000Z' },
];
const auditEntries = [], importRows = [], previewRows = new Map();
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
    async putYouTubeImports(docs, { batchId, actor }) {
      const added = [];
      for (const doc of docs) {
        if (stored.videos.some((v) => v.id === doc.id)) continue;
        stored.videos.push(structuredClone(doc));
        importRows.push({ batchId, videoId: doc.id, actor, importedAt: new Date() });
        added.push(doc.id);
      }
      if (added.length) catalogVersion++;
      return added;
    },
    async createYouTubePreview(snapshot) {
      previewRows.set(snapshot.snapshotId, { ...structuredClone(snapshot), checkedAt: snapshot.checkedAt.toISOString(), expiresAt: snapshot.expiresAt.toISOString() });
    },
    async getYouTubePreview(snapshotId, actor) {
      const snapshot = previewRows.get(snapshotId);
      return snapshot && snapshot.actor === actor && Date.parse(snapshot.expiresAt) > Date.now() ? structuredClone(snapshot) : null;
    },
    async setVideosHidden(ids, hidden) {
      const changed = [];
      for (const video of stored.videos) if (ids.includes(video.id)) { video.hidden = hidden; changed.push(video.id); }
      if (changed.length) catalogVersion++;
      return changed;
    },
    async removeVideos(ids) {
      const removed = stored.videos.filter((video) => ids.includes(video.id)).map((video) => video.id);
      if (removed.length) { stored.videos = stored.videos.filter((video) => !ids.includes(video.id)); catalogVersion++; }
      return removed;
    },
    async remove(key, id) {
      if (key !== 'videos') throw new Error('Unexpected catalog removal in YouTube test');
      const i = stored.videos.findIndex((v) => v.id === id);
      if (i < 0) return null;
      stored.videos.splice(i, 1); catalogVersion++;
      return { removed: 1, videos: 0 };
    },
  },
  youtubeImports: {
    async summary({ start, end }) {
      const batches = new Map();
      for (const row of importRows) {
        const prev = batches.get(row.batchId);
        if (!prev || row.importedAt > prev.importedAt) batches.set(row.batchId, row);
      }
      const latest = [...batches.values()].sort((a, b) => b.importedAt - a.importedAt)[0];
      const todayVideoIds = importRows.filter((r) => r.importedAt >= start && r.importedAt < end).map((r) => r.videoId);
      return {
        last: latest ? { batchId: latest.batchId, importedAt: latest.importedAt.toISOString(), videoIds: importRows.filter((r) => r.batchId === latest.batchId).map((r) => r.videoId) } : null,
        todayVideoIds: [...new Set(todayVideoIds)],
      };
    },
  },
};
const youtubeFeed = {
  async refresh() {
    feedCalls++;
    if (feedUnavailable) throw new Error('upstream unavailable');
    return { videos: feedVideos, updatedAt: '2026-10-01T00:00:00.000Z', configured: true, complete: true };
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

test('public reads never fetch YouTube; admins preview, select categories, import and remove tracked uploads', async () => {
  const before = feedCalls;
  const publicCatalog = await call('GET', '/api/v1/catalog');
  assert.equal(publicCatalog.status, 200);
  assert.equal(feedCalls, before, 'a public catalog page load does not contact YouTube');
  const removedPublicFeed = await call('GET', '/api/v1/youtube/latest', undefined, VIEWER_TOKEN);
  assert.equal(removedPublicFeed.status, 404);
  assert.equal(feedCalls, before);

  const anonymous = await call('POST', '/api/v1/admin/catalog/youtube/preview', {});
  assert.equal(anonymous.status, 401);
  const viewer = await call('POST', '/api/v1/admin/catalog/youtube/preview', {}, VIEWER_TOKEN);
  assert.equal(viewer.status, 403);
  assert.equal(feedCalls, before, 'unauthenticated viewers cannot trigger an upstream fetch');
  const oldRefresh = await call('POST', '/api/v1/admin/catalog/youtube/refresh', {}, ADMIN_TOKEN);
  assert.notEqual(oldRefresh.status, 200, 'the one-click refresh endpoint has been replaced by preview/import');
  assert.equal(feedCalls, before, 'the removed refresh endpoint cannot fetch YouTube');

  const preview = await call('POST', '/api/v1/admin/catalog/youtube/preview', {}, ADMIN_TOKEN);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.items.length, 2);
  assert.equal(preview.body.total, 2);
  assert.equal(preview.body.missing, 2);
  assert.ok(preview.body.previewToken.length < 256, 'large channel data is kept in the database, not the request token');
  assert.equal(preview.body.items[0].id, 'BBBBBBBBBBB');
  assert.equal(preview.body.items[0].suggestedKind, 'reel');
  assert.equal(preview.body.items[1].suggestedKind, 'clip');
  assert.equal(preview.body.items.every((v) => !v.alreadyImported), true);
  assert.equal(feedCalls, before + 1, 'only the explicit preview fetches the feed');

  const invalidToken = await call('POST', '/api/v1/admin/catalog/youtube/import', { previewToken: `${preview.body.previewToken}x`, selections: [{ id: 'BBBBBBBBBBB', kind: 'reel' }] }, ADMIN_TOKEN);
  assert.equal(invalidToken.status, 400);

  // Import only the selected Short as a Reel. Import uses the signed preview, so it does not fetch again.
  const shortImport = await call('POST', '/api/v1/admin/catalog/youtube/import', {
    previewToken: preview.body.previewToken, selections: [{ id: 'BBBBBBBBBBB', kind: 'reel' }],
  }, ADMIN_TOKEN);
  assert.equal(shortImport.status, 200);
  assert.equal(shortImport.body.added, 1);
  assert.equal(stored.videos[0].kind, 'reel');
  assert.deepEqual(stored.videos[0].source, { type: 'youtube', id: 'BBBBBBBBBBB' });
  assert.equal(stored.videos[0].duration, 0);
  assert.equal('rating' in stored.videos[0], false, 'unrated imports stay hidden from Kids profiles until reviewed');
  assert.equal(feedCalls, before + 1);

  const repeated = await call('POST', '/api/v1/admin/catalog/youtube/import', {
    previewToken: preview.body.previewToken, selections: [{ id: 'BBBBBBBBBBB', kind: 'reel' }],
  }, ADMIN_TOKEN);
  assert.equal(repeated.body.added, 0);
  assert.equal(repeated.body.skipped, 1, 're-importing an existing ID is idempotent');

  // Choose only the other, landscape video and import it as a clip.
  const landscapeImport = await call('POST', '/api/v1/admin/catalog/youtube/import', {
    previewToken: preview.body.previewToken, selections: [{ id: 'AAAAAAAAAAA', kind: 'clip' }],
  }, ADMIN_TOKEN);
  assert.equal(landscapeImport.body.added, 1);
  assert.equal(stored.videos.find((v) => v.id === 'AAAAAAAAAAA').kind, 'clip');
  assert.equal(feedCalls, before + 1, 'neither selected import nor duplicate checks fetch YouTube');
  assert.ok(auditEntries.some((entry) => entry.action === 'catalog.youtube.import' && entry.meta.added === 1));

  const history = await call('GET', '/api/v1/admin/catalog/youtube/imports', undefined, ADMIN_TOKEN);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.last.videoIds, ['AAAAAAAAAAA']);
  assert.deepEqual(history.body.todayVideoIds.sort(), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);

  const undoLast = await call('POST', '/api/v1/admin/catalog/youtube/remove-imports', { scope: 'last' }, ADMIN_TOKEN);
  assert.equal(undoLast.status, 200);
  assert.equal(undoLast.body.removed, 1);
  assert.deepEqual(stored.videos.map((v) => v.id), ['BBBBBBBBBBB']);
  const removeToday = await call('POST', '/api/v1/admin/catalog/youtube/remove-imports', { scope: 'today' }, ADMIN_TOKEN);
  assert.equal(removeToday.status, 200);
  assert.equal(removeToday.body.removed, 1);
  assert.equal(stored.videos.length, 0);
  assert.ok(auditEntries.some((entry) => entry.action === 'catalog.youtube.remove_imports' && entry.meta.scope === 'today'));
  const afterRemoval = await call('GET', '/api/v1/catalog');
  assert.equal(afterRemoval.body.videos.length, 0);

  // The import-all action sends every new item from one preview in a single tracked batch.
  const secondPreview = await call('POST', '/api/v1/admin/catalog/youtube/preview', {}, ADMIN_TOKEN);
  const importAll = await call('POST', '/api/v1/admin/catalog/youtube/import', {
    previewToken: secondPreview.body.previewToken,
    selections: secondPreview.body.items.filter((v) => !v.alreadyImported).map((v) => ({ id: v.id, kind: v.suggestedKind })),
  }, ADMIN_TOKEN);
  assert.equal(importAll.body.added, 2);
  const allHistory = await call('GET', '/api/v1/admin/catalog/youtube/imports', undefined, ADMIN_TOKEN);
  assert.deepEqual(allHistory.body.last.videoIds.sort(), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
  const undoAll = await call('POST', '/api/v1/admin/catalog/youtube/remove-imports', { scope: 'last' }, ADMIN_TOKEN);
  assert.equal(undoAll.body.removed, 2);
  assert.equal(stored.videos.length, 0);
});

test('admins can bulk hide, restore and delete selected videos without publishing hidden items', async () => {
  const preview = await call('POST', '/api/v1/admin/catalog/youtube/preview', {}, ADMIN_TOKEN);
  const imported = await call('POST', '/api/v1/admin/catalog/youtube/import', {
    previewToken: preview.body.previewToken,
    selections: preview.body.items.map((v) => ({ id: v.id, kind: v.suggestedKind })),
  }, ADMIN_TOKEN);
  assert.equal(imported.body.added, 2);

  const hide = await call('POST', '/api/v1/admin/catalog/videos/bulk', { action: 'hide', ids: ['BBBBBBBBBBB'] }, ADMIN_TOKEN);
  assert.equal(hide.status, 200); assert.equal(hide.body.affected, 1);
  const publicHidden = await call('GET', '/api/v1/catalog');
  assert.deepEqual(publicHidden.body.videos.map((v) => v.id), ['AAAAAAAAAAA']);
  const adminHidden = await call('GET', '/api/v1/admin/catalog', undefined, ADMIN_TOKEN);
  assert.equal(adminHidden.body.videos.find((v) => v.id === 'BBBBBBBBBBB').hidden, true);

  const restore = await call('POST', '/api/v1/admin/catalog/videos/bulk', { action: 'show', ids: ['BBBBBBBBBBB'] }, ADMIN_TOKEN);
  assert.equal(restore.body.affected, 1);
  assert.equal((await call('GET', '/api/v1/catalog')).body.videos.length, 2);

  const deleted = await call('POST', '/api/v1/admin/catalog/videos/bulk', { action: 'delete', ids: ['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC'] }, ADMIN_TOKEN);
  assert.equal(deleted.status, 200); assert.equal(deleted.body.affected, 2); assert.equal(deleted.body.skipped, 1);
  assert.equal(stored.videos.length, 0);
  assert.equal((await call('GET', '/api/v1/catalog')).body.videos.length, 0);
  assert.ok(auditEntries.some((entry) => entry.action === 'catalog.video.bulk_hide'));
  assert.ok(auditEntries.some((entry) => entry.action === 'catalog.video.bulk_delete'));
});

test('a failed explicit preview leaves the catalog unchanged', async () => {
  feedUnavailable = true;
  const beforeVideos = stored.videos.length, beforeCalls = feedCalls;
  try {
    const result = await call('POST', '/api/v1/admin/catalog/youtube/preview', {}, ADMIN_TOKEN);
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'youtube_unavailable');
    assert.equal(stored.videos.length, beforeVideos);
    assert.equal(feedCalls, beforeCalls + 1);
  } finally { feedUnavailable = false; }
});
