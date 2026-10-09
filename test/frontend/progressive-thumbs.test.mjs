// Slow connections: artwork shows a small rendition first and swaps in the best one once it has loaded.
// Run:  node --test test/frontend/progressive-thumbs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { swapToHighQuality } from '../../app/js/ui/progressive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Minimal stand-ins for DOM elements: enough for swapToHighQuality (dataset, src, srcset, parentElement, querySelectorAll).
const fakeSource = (attrs) => ({ media: attrs.media || '', srcset: attrs.srcset || '', dataset: { ...(attrs.hq ? { hq: attrs.hq } : {}) } });
function fakeImg({ src, hq = '', picture = null }) {
  const el = { tagName: 'IMG', src, dataset: hq ? { hq } : {}, parentElement: picture };
  return el;
}
function fakePicture(sources) {
  return { tagName: 'PICTURE', querySelectorAll: () => sources };
}

test('a plain image swaps its low-quality src for the best one, once', () => {
  const img = fakeImg({ src: 'https://i.ytimg.com/vi/x/mqdefault.jpg', hq: 'https://i.ytimg.com/vi/x/maxresdefault.jpg' });
  assert.equal(swapToHighQuality(img), true);
  assert.equal(img.src, 'https://i.ytimg.com/vi/x/maxresdefault.jpg');
  assert.equal(img.dataset.hq, undefined, 'the pending upgrade is consumed');
  // The best rendition has loaded: a second load/error event must not touch it again.
  assert.equal(swapToHighQuality(img), false);
  assert.equal(img.src, 'https://i.ytimg.com/vi/x/maxresdefault.jpg');
});

test('an image without a best rendition is left alone (existing fallback path)', () => {
  const img = fakeImg({ src: 'media/shows/x-sm.webp' });
  assert.equal(swapToHighQuality(img), false);
  assert.equal(img.src, 'media/shows/x-sm.webp');
});

test('a failed low-quality image jumps to the best rendition instead of giving up', () => {
  const img = fakeImg({ src: 'low.jpg', hq: 'high.jpg' });
  assert.equal(swapToHighQuality(img), true);
  assert.equal(img.src, 'high.jpg');
});

test('in a <picture>, the source that matches the viewport is the one upgraded', () => {
  const source = fakeSource({ media: '(max-width: 759px)', srcset: 'poster-sm.webp', hq: 'poster-lg.webp' });
  const img = fakeImg({ src: 'backdrop-mq.jpg', hq: 'backdrop-max.jpg', picture: null });
  img.parentElement = fakePicture([source]);
  assert.equal(swapToHighQuality(img, () => true), true, 'phone: the poster source matches');
  assert.equal(source.srcset, 'poster-lg.webp');
  assert.equal(img.src, 'poster-lg.webp');
  assert.equal(img.dataset.hq, 'backdrop-max.jpg', 'the wide-still upgrade is not triggered on a phone');
  assert.equal(swapToHighQuality(img, () => true), false, 'nothing left to upgrade once the poster is in');
});

test('in a <picture>, a wide viewport does not download the poster; the wide still upgrades', () => {
  const source = fakeSource({ media: '(max-width: 759px)', srcset: 'poster-sm.webp', hq: 'poster-lg.webp' });
  const img = fakeImg({ src: 'backdrop-mq.jpg', hq: 'backdrop-max.jpg' });
  img.parentElement = fakePicture([source]);
  assert.equal(swapToHighQuality(img, () => false), true);
  assert.equal(img.src, 'backdrop-max.jpg');
  assert.equal(source.dataset.hq, 'poster-lg.webp', 'the poster upgrade stays pending for a phone');
  assert.equal(source.srcset, 'poster-sm.webp');
});

test('catalog.thumb: the low-quality rendition is a real YouTube size', () => {
  const src = read('app/js/data/catalog.js');
  assert.match(src, /maxresdefault\|sddefault\|hqdefault\|mqdefault\|default/, 'thumb() accepts every YouTube rendition');
});

test('components build the progressive markup for cards, banners and posters', () => {
  const c = read('app/js/ui/components.js');
  assert.match(c, /lowSrc = ''/, 'img() takes a lowSrc');
  assert.match(c, /src="\$\{low \|\| src\}" data-hq="\$\{low \? src : ''\}"/, 'img() shows the low rendition and keeps the best in data-hq');
  assert.match(c, /lowSrc: app\.catalog\.thumb\(v, 'mqdefault'\)/, 'video cards start from YouTube mqdefault (320x180)');
  assert.match(c, /lowThumb = '', lowPoster = ''/, 'heroBg takes low renditions');
  assert.match(c, /srcset="\$\{lp \|\| poster\}" data-hq="\$\{lp \? poster : ''\}"/, 'the banner poster source starts low on phones');
});

test('every call site that shows a best-quality image also passes a low rendition', () => {
  const pairs = [
    ['app/js/views/show.js', /\$\{img\(cat\.thumb\(v, 'maxresdefault'\), '', \{[^}]*lowSrc: cat\.thumb\(v, 'mqdefault'\)/],
    ['app/js/views/show.js', /heroBg\(cat\.thumb\(latest, 'maxresdefault'\)[\s\S]*?lowThumb: cat\.thumb\(latest, 'mqdefault'\), lowPoster: s\.poster/],
    ['app/js/views/show.js', /img\(s\.posterLg \|\| s\.poster, s\.title, \{ lazy: false, lowSrc: s\.poster \}\)/],
    ['app/js/views/home.js', /lowThumb: cat\.thumb\(latest, 'mqdefault'\), lowPoster: show\.poster/],
    ['app/js/views/home.js', /img\(show\.posterLg \|\| show\.poster, '', \{ lazy: i > 0, lowSrc: show\.poster \}\)/],
    ['app/js/views/soon.js', /img\(u\.posterLg \|\| u\.poster, u\.title, \{ lazy: false, lowSrc: u\.poster \}\)/],
    ['app/js/views/soon.js', /img\(u\.backdrop \|\| u\.posterLg \|\| u\.poster, '', \{ lazy: false, lowSrc: u\.poster \}\)/],
    ['app/js/views/watch.js', /lowSrc: cat\.thumb\(target, 'mqdefault'\)/],
    ['app/js/views/watch.js', /player-wall-art', lazy: false, lowSrc: cat\.thumb\(v, 'mqdefault'\)/],
    ['app/js/views/reels.js', /lowSrc: cover\.low/],
  ];
  for (const [file, re] of pairs) assert.match(read(file), re, `${file} passes a low rendition: ${re}`);
  assert.match(read('app/js/views/reels.js'), /low: cat\.thumb\(v, 'mqdefault'\)/, 'reel covers compute the low rendition');
});

test('main.js upgrades on load and runs the upgrade before the data-fb fallback on error', () => {
  const main = read('app/js/main.js');
  assert.match(main, /import \{ swapToHighQuality \} from '\.\/ui\/progressive\.js';/);
  const fn = main.match(/function wireImageFallbacks\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  // `load` events never reach window (the event path stops at document): the listener must be on document.
  assert.match(fn, /document\.addEventListener\('load'[\s\S]*swapToHighQuality\(t\)/, 'load swaps in the best rendition (listened for on document)');
  assert.doesNotMatch(fn, /window\.addEventListener\('load'/, 'a window listener never receives image load events');
  assert.match(fn, /if \(!\(t instanceof HTMLImageElement\) \|\| swapToHighQuality\(t\)\) return;/, 'error tries the best rendition first');
  assert.ok(fn.indexOf('swapToHighQuality(t)) return') < fn.indexOf("t.dataset.fbTried = '1'"), 'before the fallback is marked as tried');
});
