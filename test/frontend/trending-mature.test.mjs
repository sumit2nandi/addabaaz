// "Top 10 Episodes" mature-content demotion: guests and accounts without mature viewing history
// must see mature titles less often (capped), while the default ranking stays pure views order.
//
// Run:  node --test test/frontend/trending-mature.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { parseHTML } from 'linkedom';

// Minimal browser globals before any app module is imported (they read window/document at module scope).
const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = document;
window.location = globalThis.location;

const { Catalog } = await import('../../app/js/data/catalog.js');

const show = (id, rating) => ({ id, title: id, rating });
const ep = (id, showId, views, rating) => ({ id, showId, kind: 'episode', views, rating, episode: 1, publishedAt: '2026-01-01' });

function makeCatalog() {
  return new Catalog({
    shows: [show('clean', 'U'), show('grown', '18+'), show('mid', '13+')],
    videos: [
      ep('a1', 'clean', 100),        // non-mature
      ep('m1', 'grown', 90),         // mature via its show
      ep('a2', 'clean', 80),
      ep('m2', 'grown', 70),
      ep('m3', 'grown', 60),
      ep('t1', 'mid', 50),           // 13+ is not mature
      ep('a3', 'clean', 40),
      ep('m4', null, 30, '16+'),      // mature via its own rating
      ep('m5', 'grown', 20),
      ep('a4', 'clean', 10),
      ep('a5', 'clean', 5),
      ep('a6', 'clean', 1),
    ],
    upcoming: [],
    gallery: [],
  });
}

test('isMature: show inheritance, own rating, 13+ and unrated stay non-mature', () => {
  const cat = makeCatalog();
  assert.equal(cat.isMature(cat.video('m1')), true, '18+ show counts as mature');
  assert.equal(cat.isMature(cat.video('m4')), true, "video's own 16+ rating counts");
  assert.equal(cat.isMature(cat.video('t1')), false, '13+ is not mature');
  assert.equal(cat.isMature(cat.video('a1')), false, 'U is not mature');
  assert.equal(cat.isMature(undefined), false, 'deleted/unknown videos are safe');
});

test('trending without a cap is unchanged: pure views order including mature titles', () => {
  const ids = makeCatalog().trending(10).map((v) => v.id);
  assert.deepEqual(ids, ['a1', 'm1', 'a2', 'm2', 'm3', 't1', 'a3', 'm4', 'm5', 'a4']);
});

test('matureCap keeps mature titles rare: at most the cap before non-mature fill, then backfill', () => {
  const out = makeCatalog().trending(10, { matureCap: 2 });
  assert.equal(out.length, 10, 'the rail always fills up');
  // First pass by views with the cap: a1, m1(1), a2, m2(2), t1, a3, a4, a5 — mature kept while cap allows…
  assert.deepEqual(out.slice(0, 8).map((v) => v.id), ['a1', 'm1', 'a2', 'm2', 't1', 'a3', 'a4', 'a5']);
  // …then the rail tops up with what's left in views order (here: last non-mature, then one backfilled mature).
  assert.deepEqual(out.slice(8).map((v) => v.id), ['a6', 'm3']);
  const mature = out.filter((v) => catMature(v)).length;
  assert.equal(mature, 3, `2 in-cap mature + 1 backfill only because the catalog ran short (got ${mature})`);
});

function catMature(v) {
  const s = v.showId === 'grown' || v.rating === '16+' || v.rating === '18+';
  return Boolean(s);
}

test('matureCap: with enough non-mature episodes, mature titles never exceed the cap', () => {
  const videos = [ep('m1', 'grown', 100), ep('m2', 'grown', 99), ep('m3', 'grown', 98)];
  for (let i = 1; i <= 11; i++) videos.push(ep(`a${i}`, 'clean', 90 - i));
  const cat = new Catalog({ shows: [show('clean', 'U'), show('grown', '18+')], videos, upcoming: [], gallery: [] });
  const out = cat.trending(10, { matureCap: 2 });
  const mature = out.filter((v) => v.showId === 'grown').length;
  assert.equal(mature, 2, 'exactly the cap stays in');
  assert.deepEqual(out.map((v) => v.id), ['m1', 'm2', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
});
