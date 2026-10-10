// Slow connections: artwork shows a small rendition first and swaps in the best one once it has loaded.
// Run:  node --test test/frontend/progressive-thumbs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHighQuality, lowResolutionSrc, swapToHighQuality } from '../../app/js/ui/progressive.js';
import { rebaseUploads } from '../../app/js/data/catalog.js';

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

test('new uploaded high-resolution artwork maps to its saved low WebP sibling', () => {
  assert.equal(lowResolutionSrc('uploads/0123456789abcdef01234567-hq.jpg'), 'uploads/0123456789abcdef01234567-low.webp');
  assert.equal(lowResolutionSrc('/uploads/0123456789abcdef01234567-hq.png'), '/uploads/0123456789abcdef01234567-low.webp');
  assert.equal(lowResolutionSrc('https://api.example.test/uploads/0123456789abcdef01234567-hq.webp'), 'https://api.example.test/uploads/0123456789abcdef01234567-low.webp');
  assert.equal(lowResolutionSrc('https://site.example.test/r2-assets/broadcast/0123456789abcdef01234567-hq.gif'), 'https://site.example.test/r2-assets/broadcast/0123456789abcdef01234567-low.webp');
  assert.equal(lowResolutionSrc('r2-assets/catalog/0123456789abcdef01234567-hq.jpg'), 'r2-assets/catalog/0123456789abcdef01234567-low.webp');
  assert.equal(lowResolutionSrc('r2-assets/video-thumbnails/premium/show/0123456789abcdef01234567-hq.webp'), 'r2-assets/video-thumbnails/premium/show/0123456789abcdef01234567-low.webp');
  assert.equal(lowResolutionSrc('uploads/0123456789abcdef01234567.webp'), '', 'legacy uploads do not request a missing compact variant');
  assert.equal(lowResolutionSrc('media/shows/poster-lg.webp'), '', 'bundled artwork is unchanged');
});

test('new R2 catalog-photo and video-thumbnail URLs are rebased for same-origin and native/split-host apps', () => {
  const path = 'r2-assets/catalog/0123456789abcdef01234567-hq.png';
  const thumb = 'r2-assets/video-thumbnails/premium/show/0123456789abcdef01234567-hq.webp';
  assert.deepEqual(rebaseUploads({ poster: path }, ''), { poster: `/${path}` });
  assert.deepEqual(rebaseUploads({ poster: path }, 'https://api.example.test'), { poster: `https://api.example.test/${path}` });
  assert.deepEqual(rebaseUploads({ thumbnail: thumb }, ''), { thumbnail: `/${thumb}` });
  assert.deepEqual(rebaseUploads({ thumbnail: thumb }, 'https://api.example.test'), { thumbnail: `https://api.example.test/${thumb}` });
  assert.deepEqual(rebaseUploads({ poster: 'uploads/0123456789abcdef01234567.png' }, 'https://api.example.test'), { poster: 'https://api.example.test/uploads/0123456789abcdef01234567.png' });
});

test('a plain image swaps its low-quality src for the best one, once', () => {
  const img = fakeImg({ src: 'https://i.ytimg.com/vi/x/mqdefault.jpg', hq: 'https://i.ytimg.com/vi/x/maxresdefault.jpg' });
  assert.equal(swapToHighQuality(img), true);
  assert.equal(img.src, 'https://i.ytimg.com/vi/x/maxresdefault.jpg');
  assert.equal(img.dataset.hq, undefined, 'the pending upgrade is consumed');
  // The best rendition has loaded: a second load/error event must not touch it again.
  assert.equal(swapToHighQuality(img), false);
  assert.equal(img.src, 'https://i.ytimg.com/vi/x/maxresdefault.jpg');
});

test('the compact image stays visible until its high-quality replacement has downloaded', () => {
  const originalImage = globalThis.Image, requests = [];
  globalThis.Image = class {
    set src(value) { this.url = value; requests.push(this); }
  };
  const img = fakeImg({ src: 'low.webp', hq: 'high.webp' });
  try {
    assert.equal(loadHighQuality(img), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'high.webp');
    assert.equal(img.src, 'low.webp', 'preloading never clears the image already on screen');
    assert.equal(img.dataset.hq, 'high.webp', 'the upgrade stays pending while bytes are in flight');
    requests[0].onload();
    assert.equal(img.src, 'high.webp', 'the crisp image replaces the placeholder after preload completes');
    assert.equal(img.dataset.hq, undefined);
  } finally {
    if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage;
  }
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

test('admin image uploads generate and persist both compact and full-quality renditions', () => {
  const admin = read('admin/js/ui.js'), api = read('admin/js/api.js');
  assert.match(admin, /maxWidth: Math\.min\(480, maxWidth\), quality: 0\.64, webpOnly: true/);
  assert.match(admin, /await upload\(full, low\)/);
  assert.match(api, /low\.size < full\.size/);
  assert.match(api, /X-Image-Renditions': 'progressive'/);
  assert.match(api, /X-Image-Variant-Of': name/);
});

test('components build the progressive markup for cards, banners and posters', () => {
  const c = read('app/js/ui/components.js');
  assert.match(c, /lowSrc = ''/, 'img() takes a lowSrc');
  assert.match(c, /\|\| lowResolutionSrc\(src\)/, 'uploaded full-size images automatically resolve their saved compact sibling');
  assert.match(c, /src="\$\{low \|\| src\}" data-hq="\$\{low \? src : ''\}"/, 'img() shows the low rendition and keeps the best in data-hq');
  assert.match(c, /lowSrc: app\.catalog\.thumb\(v, 'mqdefault'\)/, 'video cards start from YouTube mqdefault (320x180)');
  assert.match(c, /lowThumb = '', lowPoster = '', blurUp = true/, 'heroBg takes low renditions and a blur-up opt-out');
  assert.match(c, /blurUp \? \(\(lowThumb && lowThumb !== thumb \? lowThumb : ''\) \|\| lowResolutionSrc\(thumb\)\) : ''/,
    'blurUp: false skips the low placeholder entirely, so the banner renders sharp from the first paint');
  assert.match(c, /srcset="\$\{lp \|\| poster\}" data-hq="\$\{lp \? poster : ''\}"/, 'the banner poster source starts low on phones');
});

test('every call site that shows a best-quality image also passes a low rendition', () => {
  const pairs = [
    ['app/js/views/show.js', /\$\{img\(cat\.thumb\(v, 'maxresdefault'\), '', \{[^}]*lowSrc: cat\.thumb\(v, 'mqdefault'\)/],
    ['app/js/views/show.js', /heroBg\(cat\.thumb\(latest, 'maxresdefault'\), s\.posterLg \|\| s\.poster, \{ fallback: `\$\{s\.posterLg \|\| s\.poster\}\|\$\{cat\.thumb\(latest, 'hqdefault'\)}`, blurUp: false \}\)/],
    ['app/js/views/show.js', /img\(s\.posterLg \|\| s\.poster, s\.title, \{ lazy: false, lowSrc: s\.poster \}\)/],
    ['app/js/views/home.js', /heroBg\(cat\.thumb\(latest, 'maxresdefault'\), show\.posterLg \|\| show\.poster, \{ lazy: i > 0, fallback: `\$\{show\.posterLg \|\| show\.poster\}\|\$\{cat\.thumb\(latest, 'hqdefault'\)}`, blurUp: false \}\)/],
    ['app/js/views/home.js', /img\(show\.posterLg \|\| show\.poster, '', \{ lazy: i > 0, lowSrc: show\.poster \}\)/],
    ['app/js/views/soon.js', /img\(u\.posterLg \|\| u\.poster, u\.title, \{ lazy: false, lowSrc: u\.poster \}\)/],
    ['app/js/views/soon.js', /img\(u\.backdrop \|\| u\.posterLg \|\| u\.poster, '', \{ lazy: false \}\)/],
    ['app/js/views/watch.js', /lowSrc: cat\.thumb\(target, 'mqdefault'\)/],
    ['app/js/views/watch.js', /player-wall-art', lazy: false, lowSrc: cat\.thumb\(v, 'mqdefault'\)/],
    ['app/js/views/reels.js', /lowSrc: cover\.low/],
  ];
  for (const [file, re] of pairs) assert.match(read(file), re, `${file} passes a low rendition: ${re}`);
  assert.match(read('app/js/views/reels.js'), /low: cat\.thumb\(v, 'mqdefault'\)/, 'reel covers compute the low rendition');
  assert.doesNotMatch(read('app/js/views/home.js'), /lowThumb: cat\.thumb\(latest, 'mqdefault'\)/,
    'the home hero is the one banner that never shows a soft placeholder — it opts out of blur-up');
});

test('main.js upgrades on load and runs the upgrade before the data-fb fallback on error', () => {
  const main = read('app/js/main.js');
  assert.match(main, /import \{ loadHighQuality, swapToHighQuality \} from '\.\/ui\/progressive\.js';/);
  const fn = main.match(/function wireImageFallbacks\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  // `load` events never reach window (the event path stops at document): the listener must be on document.
  assert.match(fn, /document\.addEventListener\('load'[\s\S]*loadHighQuality\(t\)/, 'load prefetches and swaps in the best rendition only after it arrives');
  assert.doesNotMatch(fn, /window\.addEventListener\('load'/, 'a window listener never receives image load events');
  assert.match(fn, /if \(!\(t instanceof HTMLImageElement\) \|\| swapToHighQuality\(t\)\) return;/, 'a failed placeholder jumps straight to the best rendition');
  assert.match(fn, /const chain = String\(t\.dataset\.fb \|\| ''\)\.split\('\|'\)\.filter\(\(u\) => u && u !== t\.src\);/,
    'data-fb is a chain: each failure steps one candidate further, never back to the URL that just failed');
  assert.match(fn, /if \(next\) t\.src = next; else t\.classList\.add\('img-failed'\);/,
    'an exhausted chain marks the image failed instead of retrying forever');
  assert.doesNotMatch(fn, /fbTried/, 'the one-shot fallback flag is gone — the chain itself terminates');
});

test('the home hero walks down to its sharp local poster when YouTube has no max-resolution still', () => {
  const home = read('app/js/views/home.js');
  const call = home.match(/heroBg\(cat\.thumb\(latest, 'maxresdefault'\)[\s\S]*?\)\}<\/div>/)?.[0] || '';
  assert.ok(call, 'the hero banner call exists');
  assert.match(call, /blurUp: false/, 'no soft placeholder on the first paint');
  assert.match(call, /fallback: `\$\{show\.posterLg \|\| show\.poster\}\|\$\{cat\.thumb\(latest, 'hqdefault'\)}`/,
    'missing maxresdefault steps to the sharp uploaded poster (then hqdefault), so the banner never stays blurred');
  // Every full-bleed hero banner opts out of the soft placeholder, not just the home one.
  assert.doesNotMatch(read('app/js/views/show.js'), /lowThumb: cat\.thumb\(latest, 'mqdefault'\)/,
    'the show hero banner never shows a soft placeholder either');
  assert.match(read('app/js/views/show.js'), /heroBg\(s\.posterLg \|\| s\.poster, '', \{ blurUp: false \}\)/,
    'a show without episodes still draws its banner sharp');
  assert.doesNotMatch(read('app/js/views/soon.js'), /img\(u\.backdrop \|\| u\.posterLg \|\| u\.poster, '', \{ lazy: false, lowSrc/,
    'the coming-soon hero renders its uploaded art sharp from the first paint');
});
