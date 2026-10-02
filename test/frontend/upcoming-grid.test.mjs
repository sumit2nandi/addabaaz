// Coming Soon page (#/upcoming): portrait artwork tiles two per row, landscape (or square) artwork takes a
// full-width row, and every tile crops its image to fill. Run: node --test test/frontend/upcoming-grid.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.document = document;
globalThis.window = window;
window.matchMedia = () => ({ matches: false });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const { app } = await import('../../app/js/app.js');
const { Catalog } = await import('../../app/js/data/catalog.js');
const upcoming = (await import('../../app/js/views/upcoming.js')).default;

const SIZES = {
  'media/upcoming/wide.webp': [1600, 900],   // landscape
  'media/upcoming/tall.webp': [900, 1600],   // portrait
  'media/upcoming/square.webp': [1000, 1000], // square counts as a full row
};

app.catalog = new Catalog({
  schema: 1, updatedAt: '', shows: [], videos: [], gallery: [],
  upcoming: [
    { id: 'wide', title: 'Wide', category: 'coming-soon', poster: 'media/upcoming/wide.webp' },
    { id: 'tall', title: 'Tall', category: 'coming-soon', poster: 'media/upcoming/tall.webp' },
    { id: 'square', title: 'Square', category: 'coming-soon', poster: 'media/upcoming/square.webp' },
  ],
});
app.user = { account: null, lib: {}, hasReminder: () => false, on: () => {}, listItems: () => [] };

async function render() {
  const root = document.createElement('main');
  await upcoming({ root, setTitle() {}, onCleanup() {} });
  return root;
}

// Pretend the browser finished loading a tile image (linkedom never loads images by itself).
function finishLoad(image) {
  const [w, h] = SIZES[image.getAttribute('src')];
  image.naturalWidth = w;
  image.naturalHeight = h;
  image.complete = true;
  image.dispatchEvent(new window.Event('load'));
}

test('coming-soon grid CSS: two columns, landscape spans the row, tiles crop to fill', () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.grid-upcoming \{[^}]*grid-template-columns: repeat\(2,/, 'the page lays out two portrait tiles per row');
  assert.match(css, /\.grid-upcoming \.show-tile\.is-wide \{[^}]*grid-column: 1 \/ -1/, 'a landscape tile spans the full row');
  assert.match(css, /\.grid-upcoming \.upcoming-page-poster img \{[^}]*object-fit: cover/, 'tiles crop their artwork to fill');
  assert.match(css, /\.grid-upcoming \.show-tile\.is-wide \.upcoming-page-poster \{[^}]*aspect-ratio: 16\s*\/\s*9/, 'a full-row tile is a landscape banner');
  assert.match(css, /\.grid-upcoming \.upcoming-page-poster \{[^}]*aspect-ratio: 2\s*\/\s*3/, 'a half-row tile keeps the portrait shape');
});

test('landscape artwork gets a full row, portrait shares it two-up, once the image orientation is known', async () => {
  const root = await render();
  const tiles = [...root.querySelectorAll('.grid-upcoming .show-tile')];
  assert.equal(tiles.length, 3);
  assert.ok(tiles.every((t) => !t.classList.contains('is-wide')), 'nothing is classified before its artwork loads');

  tiles.forEach((t) => finishLoad(t.querySelector('img')));
  const [wide, tall, square] = tiles;
  assert.ok(wide.classList.contains('is-wide'), 'landscape poster takes the whole row');
  assert.ok(!tall.classList.contains('is-wide'), 'portrait poster shares the row two-up');
  assert.ok(square.classList.contains('is-wide'), 'square artwork also takes a full row');
});

test('tiles are cropped cover tiles, not letterboxed contain boxes', async () => {
  const root = await render();
  assert.equal(root.querySelector('.poster-adaptive'), null, 'the old uncropped (contain) poster style is gone');
  assert.ok(root.querySelectorAll('.upcoming-page-poster img.upcoming-page-image').length === 3);
});
