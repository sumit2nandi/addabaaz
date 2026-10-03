// Two viewer-facing fixes, pinned so they cannot quietly come back:
//
//  1. the details-page poster is not forced into a 2:3 box (a 4:5 or 16:9 upload lost up to half its
//     picture) and clicking it opens the whole artwork in the lightbox;
//  2. the Behind-the-scenes gallery is hidden — no entry point anywhere for viewers or editors.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------------------------------------------------------------- the poster */

test('the details poster keeps its own shape, cropped only a little', () => {
  const css = read('app/css/styles.css');
  const rule = css.match(/^\.detail-poster \{[^}]*\}$/m)?.[0] || '';
  assert.match(rule, /aspect-ratio: var\(--poster-ar, 4\/5\)/, 'the box follows the image, falling back to 4:5');
  assert.doesNotMatch(rule, /aspect-ratio: 2\/3/, 'the hard 2:3 box is gone');
  assert.match(rule, /cursor: zoom-in/, 'it looks clickable');
  assert.match(rule, /border: 0/, 'it is a button, styled like the old div');

  const components = read('app/js/ui/components.js');
  assert.match(components, /export function fitPoster\(root\)/);
  assert.match(components, /Math\.min\(1\.55, Math\.max\(0\.68, w \/ h\)\)/, 'clamped: a wide image is trimmed at the sides, never halved');
});

test('clicking the poster opens the full artwork', () => {
  for (const [file, srcVar] of [['app/js/views/soon.js', 'u'], ['app/js/views/show.js', 's']]) {
    const view = read(file);
    assert.match(view, /<button type="button" class="detail-poster" id="detailPoster" aria-label="Open the full poster">/, `${file}: the poster is a button`);
    assert.match(view, /fitPoster\(ctx\.root\)/, `${file}: the box adapts to the image`);
    assert.match(view, /openPoster\(posterSrc/, `${file}: tapping it opens the poster`);
    assert.match(view, new RegExp(`const posterSrc = ${srcVar}\\.posterLg \\|\\| ${srcVar}\\.poster`), `${file}: the largest version is used`);
  }
  const lightbox = read('app/js/ui/lightbox.js');
  assert.match(lightbox, /export function openPoster\(src, title = ''\)/, 'openPoster exists');
  assert.match(lightbox, /if \(!src\) return;/, 'and does nothing when a title has no artwork');
  assert.match(lightbox, /const many = items\.length > 1;/, 'a single image has no arrows');
  assert.match(lightbox, /cap\.textContent = many \?/, 'and no "1 / 1" counter');
});

/* ---------------------------------------------------------------- the gallery */

test('Behind the Scenes is gone from every viewer surface', async () => {
  const surfaces = {
    'the top-bar menu': [read('app/js/ui/shell.js'), /\['\/gallery'/],
    'the footer': [read('index.html'), /#\/gallery/],
    'the home page': [read('app/js/views/home.js'), /galleryCard|cat\.gallery/],
    'the Account shortcuts': [read('app/js/views/account.js'), /#\/gallery/],
  };
  for (const [what, [src, entryPoint]] of Object.entries(surfaces)) {
    assert.doesNotMatch(src, entryPoint, `${what} has no link to it`);
    assert.doesNotMatch(src, /Behind the Scene/i, `${what} no longer shows its name`);   // comments may explain the removal by name elsewhere, not here
  }
  // Old links still work: the route stays in the table purely so /gallery can bounce home, and the page
  // module is that bounce instead of "Scene not found".
  assert.match(read('app/js/routes.js'), /\['\/gallery', 'gallery'\],/, 'the route exists only to redirect');
  const stub = read('app/js/views/gallery.js');
  assert.match(stub, /export default async function gallery\(\)/, 'the module exists for old links');
  assert.match(stub, /go\('\/', \{ replace: true \}\)/, 'and sends them home');

  // The same for crawlers and link previews, which the server answers on its own: a 301, not a 404.
  const { pageMeta } = await import('../../app/js/seo/meta.js');
  const { matchRoute } = await import('../../app/js/routes.js');
  assert.equal(matchRoute('/gallery').view, 'gallery');
  const meta = pageMeta({ path: '/gallery', cat: { shows: [], videos: [], upcoming: [], gallery: [] }, origin: 'https://addabaaz.test' });
  assert.equal(meta.status, 301, 'a permanent redirect');
  assert.equal(meta.redirect, '/');
  assert.equal(meta.robots, 'noindex,nofollow');
});

test('search engines stop offering it too', () => {
  const seo = read('server/src/seo.js');
  assert.doesNotMatch(seo, /'\/gallery'/, 'no nav link, no sitemap entry');
  assert.doesNotMatch(seo, /case 'gallery'/, 'and no rendered gallery page');
  const meta = read('app/js/seo/meta.js');
  assert.match(meta, /view === 'gallery'\) \{\n    return Object\.assign\(out, \{ redirect: '\/', status: 301, robots: 'noindex,nofollow' \}\)/, '/gallery is a 301 to the home page');
});

test('the Content studio can no longer add photos to it', () => {
  const studioMain = read('content/js/main.js');
  assert.doesNotMatch(studioMain, /'gallery'/, 'no sidebar entry, no route');
  assert.doesNotMatch(studioMain, /Gallery/i, 'and the word is gone from the page list');
  const view = read('admin/js/views/content.js');
  assert.match(view, /const VIEWS = \{ shows: drawShows, videos: drawVideos, upcoming: drawUpcoming, top: drawTop \};/, 'the page map has no gallery');
  assert.doesNotMatch(view, /drawGallery/, 'and the editor is gone');
  // The API and the data stay: the uploads are untouched, so the section can come back.
  assert.match(read('server/src/catalog-schema.js'), /gallery: 'gallery'/, 'the catalog type is still valid');
  const json = JSON.parse(read('data/catalog.json'));
  assert.ok(Array.isArray(json.gallery), 'and the photos are still in the catalog');
});

test('fitPoster reads the real image size and clamps it', async () => {
  const { parseHTML } = await import('linkedom');
  const { document, window } = parseHTML('<!doctype html><html><body><button class="detail-poster" id="detailPoster"><img id="pi"></button></body></html>');
  globalThis.window = window;                       // components.js reads the app shell at import time
  globalThis.document = document;
  window.location = globalThis.location;
  const { fitPoster } = await import('../../app/js/ui/components.js');
  const box = document.querySelector('.detail-poster');
  const img = document.getElementById('pi');
  const shape = (w, h) => { Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true }); Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true }); Object.defineProperty(img, 'complete', { value: true, configurable: true }); fitPoster(document); return box.style.getPropertyValue('--poster-ar'); };
  assert.equal(shape(1080, 1620), '0.6800', 'an extra-tall 2:3 poster is lifted only to the 0.68 floor — a hair of side-trim, not a hard 2:3 box');
  assert.equal(shape(1080, 1350), '0.8000', 'a 4:5 poster keeps its own shape exactly');
  assert.equal(shape(1920, 1080), '1.5500', 'a wide backdrop is capped at 1.55, so only the sides are trimmed');
  assert.equal(shape(700, 1000), '0.7000', 'and a shape inside the range is passed through untouched');
});
