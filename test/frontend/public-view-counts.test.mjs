// Public cards, show/watch metadata and search structured data must not reveal view counts.
// Popularity ordering may still consume catalog views internally; Admin retains the counts.
// Run: node --test test/frontend/public-view-counts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('a rendered public video card omits its catalog view count', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = document; globalThis.window = window;
  const { app } = await import('../../app/js/app.js');
  const { Catalog } = await import('../../app/js/data/catalog.js');
  const video = { id: 'video-1', kind: 'episode', episode: 1, title: 'Episode', showId: 'show-1', duration: 60, views: 123456, publishedAt: '2026-09-01', source: { type: 'youtube', id: 'abcdefghijk' } };
  app.catalog = new Catalog({ shows: [{ id: 'show-1', title: 'Show', titleEn: 'Show' }], videos: [video], upcoming: [], gallery: [] });
  app.user = { fraction: () => 0, inList: () => false };
  const { videoCard } = await import('../../app/js/ui/components.js');
  const root = document.createElement('div'); root.innerHTML = videoCard(video).s;
  const meta = root.querySelector('.card-meta');
  assert.ok(meta);
  assert.doesNotMatch(meta.textContent, /views?|123,456/i);
});

test('show episode rows omit their catalog view count too', async () => {
  const { app } = await import('../../app/js/app.js');
  const { epRow } = await import('../../app/js/views/show.js');
  const root = document.createElement('div'); root.innerHTML = epRow(app.catalog.video('video-1')).s;
  assert.doesNotMatch(root.textContent, /views?|123,456/i);
});

test('public card, show and watch renderers no longer format or label view counts', () => {
  for (const file of ['app/js/ui/components.js', 'app/js/views/show.js', 'app/js/views/watch.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /fmtViews|\bviews\s*\$\{/i, `${file} must not render a view count`);
  }
});

test('public video structured data does not publish a view interaction statistic', async () => {
  const { Catalog } = await import('../../app/js/data/catalog.js');
  const { pageMeta } = await import('../../app/js/seo/meta.js');
  const cat = new Catalog(JSON.parse(read('data/catalog.json')));
  const v = cat.videos.find((video) => video.kind === 'episode');
  const jsonld = pageMeta({ path: `/watch/${v.id}`, cat, origin: 'https://example.test' }).jsonld;
  const videoObject = jsonld.find((item) => item['@type'] === 'VideoObject');
  assert.ok(videoObject);
  assert.equal(videoObject.interactionStatistic, undefined);
});
