// Public cards, show/watch metadata and search structured data must not reveal private metrics or content runtimes.
// Popularity ordering and playback progress may still consume catalog views/durations internally; Admin retains them.
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
  assert.equal(root.querySelector('.chip-dur'), null, 'video cards no longer display content runtime badges');
  assert.doesNotMatch(root.textContent, /\b1:00\b/);

  const { reelCard } = await import('../../app/js/ui/components.js');
  const reel = { ...video, id: 'reel-1', kind: 'reel', title: 'Short reel', duration: 90 };
  root.innerHTML = reelCard(reel).s;
  assert.equal(root.querySelector('.chip-dur'), null, 'reel cards do not show runtime badges');
  assert.doesNotMatch(root.textContent, /\b1:30\b/);
});

test('show episode rows omit their catalog view count too', async () => {
  const { app } = await import('../../app/js/app.js');
  const { epRow } = await import('../../app/js/views/show.js');
  const root = document.createElement('div'); root.innerHTML = epRow(app.catalog.video('video-1')).s;
  assert.doesNotMatch(root.textContent, /views?|123,456/i);
  assert.doesNotMatch(root.textContent, /\b1:00\b/, 'episode rows retain publication dates but omit runtime');
});

test('public card, show and watch renderers never display content durations or catalog view counts', () => {
  for (const file of ['app/js/ui/components.js', 'app/js/views/show.js', 'app/js/views/watch.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /fmtViews|\bviews\s*\$\{/i, `${file} must not render a view count`);
    assert.doesNotMatch(source, /fmtDuration|fmtRuntime|chip-dur|<dt>Runtime<\/dt>/, `${file} must not render a content duration`);
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
  assert.equal(videoObject.duration, undefined, 'public structured data does not disclose content runtime');
});
