// Public crawler-visible HTML is generated server-side before the app renders; it must follow the same runtime-hiding rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../../app/js/data/catalog.js';
import { bodyHtml, createSeo } from '../src/seo.js';

const episode = {
  id: 'episode-1', kind: 'episode', episode: 1, title: 'Fixture episode', showId: 'show-1', duration: 605,
  publishedAt: '2026-10-01T00:00:00.000Z',
};
const show = { id: 'show-1', title: 'Fixture show', titleEn: 'Fixture Show', type: 'series', genres: ['Comedy'], year: 2026, cast: [], tagline: 'A test show' };
const catalog = {
  shows: [show], upcoming: [],
  latestVideos: () => [episode],
  show: (id) => id === show.id ? show : null,
  episodes: (id) => id === show.id ? [episode] : [],
  extras: () => [],
  displayTitle: (video) => video.title,
};
const meta = { description: 'Test description', title: 'Fixture Show', canonical: '/show/show-1' };

test('crawler-visible home and show content omit per-video durations', () => {
  for (const view of ['home', 'show']) {
    const body = bodyHtml(meta, { view, params: { id: show.id } }, catalog, { studio: {} }, []);
    assert.doesNotMatch(body, /10:05|duration|runtime/i, `${view} crawler copy must not disclose episode length`);
    assert.match(body, /Fixture episode/, `${view} crawler copy still lists the episode`);
  }
});

test('video sitemap entries omit per-video duration', async () => {
  const data = { schema: 1, updatedAt: '', shows: [show], videos: [{ ...episode, thumbnail: 'https://img.example.test/episode.jpg', description: 'A test episode.' }], upcoming: [], gallery: [] };
  const seo = createSeo({
    catalog: { async get() { return { version: 1, catalog: data, studio: { studio: {} } }; } },
    root: process.cwd(), origin: 'https://example.test', indexable: true,
  });
  const xml = await seo.sitemapXml({ protocol: 'https:', get: () => 'example.test' });
  assert.match(xml, /<video:video>/);
  assert.doesNotMatch(xml, /<video:duration>/, 'sitemap metadata must not disclose episode length');
});
