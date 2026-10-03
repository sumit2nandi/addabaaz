// The "Top 10 Episodes" rail is controllable from the Content studio.
//
// Behaviour (app/js/data/catalog.js): episodes an editor ranked (`topRank` 1…10) lead the rail in that
// order; the rest of the slots stay most-watched, and with nothing ranked the rail is exactly what it was.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Minimal browser globals before any app module is imported (they read window/document at module scope).
const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = document;
window.location = globalThis.location;

const { Catalog } = await import('../../app/js/data/catalog.js');

const ep = (id, views, extra = {}) => ({ id, showId: 's1', kind: 'episode', views, episode: 1, publishedAt: '2026-01-01', ...extra });
const catalog = (videos) => new Catalog({ shows: [{ id: 's1', title: 'Show' }], videos, upcoming: [], gallery: [] });

test('with nothing picked the rail is the old most-watched list', () => {
  const cat = catalog([ep('a', 10), ep('b', 30), ep('c', 20)]);
  assert.deepEqual(cat.trending(10).map((v) => v.id), ['b', 'c', 'a']);
});

test('picked episodes lead the rail in rank order, and views fill the rest', () => {
  const cat = catalog([
    ep('views-first', 999), ep('views-second', 500), ep('views-third', 100),
    ep('picked-2', 1, { topRank: 2 }), ep('picked-1', 2, { topRank: 1 }),
  ]);
  assert.deepEqual(cat.trending(4).map((v) => v.id), ['picked-1', 'picked-2', 'views-first', 'views-second'],
    'picks first (by rank), then most-watched, never a duplicate');
});

test('a full set of picks is exactly the rail', () => {
  const videos = Array.from({ length: 12 }, (_, i) => ep(`e${i}`, 1000 - i));
  videos[7].topRank = 1; videos[2].topRank = 2;                       // ranks come from the CMS, not from views
  const out = catalog(videos).trending(10).map((v) => v.id);
  assert.deepEqual(out.slice(0, 2), ['e7', 'e2'], 'the two picks lead');
  assert.equal(out.length, 10);
  assert.equal(new Set(out).size, 10, 'no duplicates');
});

test('an editorial pick survives the mature cap (it is a decision, not a recommendation)', () => {
  const cat = catalog([
    ep('clean-1', 100), ep('clean-2', 90), ep('mature-pick', 1, { topRank: 1, rating: '18+' }),
    ep('grown', 80, { rating: '18+' }), ep('clean-3', 70), ep('clean-4', 60),
  ]);
  const out = cat.trending(4, { matureCap: 0 }).map((v) => v.id);
  assert.equal(out[0], 'mature-pick', 'the pick leads even with the cap at zero');
  assert.equal(out.includes('grown'), false, 'auto-filled mature episodes are still demoted');
});

test('ranks outside 1…10, or on something that is not an episode, are ignored', () => {
  const cat = catalog([
    ep('eleven', 0, { topRank: 11 }), ep('zero', 0, { topRank: 0 }),
    { id: 'reel', kind: 'reel', views: 5000, publishedAt: '2026-01-01' },
    ep('normal', 5),
  ]);
  assert.deepEqual(cat.trending(10).map((v) => v.id), ['normal', 'eleven', 'zero'], 'neither rank counts as a pick, so they fall back to view order');
});

/* ---------------------------------------------------------------- the console */

test('the Content studio has a Top 10 page that writes ranks', () => {
  const main = read('content/js/main.js');
  assert.match(main, /\['top', 'Top 10', 'crown'\]/, 'it is in the sidebar');
  assert.match(main, /\[\/\^\(shows\|videos\|upcoming\|top\)\$\/, \(\) => import\('\/admin\/js\/views\/content\.js'\)\]/, 'and routed');
  const view = read('admin/js/views/content.js');
  assert.match(view, /const ranked = \(\) => data\.videos\.filter\(\(v\) => v\.kind === 'episode' && Number\(v\.topRank\) >= 1\)/, 'picks are the ranked episodes');
  assert.match(view, /api\.put\(`\/catalog\/videos\/\$\{encodeURIComponent\(w\.id\)\}`, \{ \.\.\.byId\.get\(w\.id\), topRank: w\.rank \}\)/, 'writing a rank saves the whole video document');
  assert.match(view, /data-top-up|data-top-in/, 'add / move / remove controls');
  assert.match(view, /Rank by views/, 'and a way back to the automatic list');
  assert.match(view, /const VIEWS = \{ shows: drawShows, videos: drawVideos, upcoming: drawUpcoming, top: drawTop \};/);
});

test('the video editor can set the position too, so saving a video never loses its rank', () => {
  const view = read('admin/js/views/content.js');
  assert.match(view, /\{ k: 'topRank', label: 'Top 10 position \(optional\)', type: 'number', min: 1, max: 10/);
  const schema = read('server/src/catalog-schema.js');
  assert.match(schema, /'hidden', 'topRank'\], 'A video'/, 'the API accepts the field');
  assert.match(schema, /r\.int\('topRank', \{ min: 1, max: 10, nullable: true \}\)/, '1…10 or nothing');
  assert.match(schema, /if \(r\.out\.topRank && r\.out\.kind !== 'episode'\) r\.out\.topRank = null;/, 'only episodes can be ranked');
});
