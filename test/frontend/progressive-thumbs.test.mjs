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
  assert.match(c, /lowThumb = '', lowPoster = '', blurUp = true/, 'heroBg can opt out of low-resolution placeholders');
  assert.match(c, /const lt = blurUp \?/, 'blurUp=false skips the background thumbnail rendition');
  assert.match(c, /const lp = blurUp \?/, 'blurUp=false skips the phone poster rendition');
  assert.match(c, /srcset="\$\{lp \|\| poster\}" data-hq="\$\{lp \? poster : ''\}"/, 'the banner poster source starts low on phones when blur-up is enabled');
});

test('every call site that benefits from a compact progressive rendition passes one', () => {
  const pairs = [
    ['app/js/views/show.js', /\$\{img\(cat\.thumb\(v, 'maxresdefault'\), '', \{[^}]*lowSrc: cat\.thumb\(v, 'mqdefault'\)/],
    ['app/js/views/show.js', /const bgSrc = s\.backdrop \|\| \(latest \? cat\.thumb\(latest, 'maxresdefault'\) : ''\);[\s\S]*?const bgFallback = \[s\.backdrop && latest \? cat\.thumb\(latest, 'maxresdefault'\) : '', s\.posterLg \|\| s\.poster, latest \? cat\.thumb\(latest, 'hqdefault'\) : ''\]\.filter\(Boolean\)\.join\('\|'\);[\s\S]*?heroBg\(bgSrc, s\.posterLg \|\| s\.poster, \{ fallback: bgFallback, blurUp: false \}\)/],
    ['app/js/views/show.js', /img\(s\.posterLg \|\| s\.poster, s\.title, \{ lazy: false, lowSrc: s\.poster \}\)/],
    ['app/js/views/home.js', /const bgSrc = show\.backdrop \|\| cat\.thumb\(latest, 'maxresdefault'\);[\s\S]*?const bgFallback = \[show\.backdrop \? cat\.thumb\(latest, 'maxresdefault'\) : '', show\.posterLg \|\| show\.poster, cat\.thumb\(latest, 'hqdefault'\)\]\.filter\(Boolean\)\.join\('\|'\);[\s\S]*?heroBg\(bgSrc, show\.posterLg \|\| show\.poster, \{ lazy: i > 0, fallback: bgFallback, blurUp: false \}\)/],
    ['app/js/views/home.js', /img\(show\.posterLg \|\| show\.poster, '', \{ lazy: i > 0, lowSrc: show\.poster \}\)/],
    ['app/js/views/soon.js', /img\(u\.posterLg \|\| u\.poster, u\.title, \{ lazy: false, lowSrc: u\.poster \}\)/],
    ['app/js/views/soon.js', /img\(u\.backdrop \|\| u\.posterLg \|\| u\.poster, '', \{ lazy: false, lowSrc: u\.poster \}\)/],
    ['app/js/views/watch.js', /lowSrc: cat\.thumb\(target, 'mqdefault'\)/],
    ['app/js/views/watch.js', /player-wall-art', lazy: false, lowSrc: cat\.thumb\(v, 'mqdefault'\)/],
    ['app/js/views/reels.js', /lowSrc: cover\.low/],
  ];
  for (const [file, re] of pairs) assert.match(read(file), re, `${file} uses its intended image rendition: ${re}`);
  assert.match(read('app/js/views/reels.js'), /low: cat\.thumb\(v, 'mqdefault'\)/, 'reel covers compute the low rendition');
});

test('Home and show heroes prefer a show backdrop and do not pass blur-up placeholders', () => {
  const home = read('app/js/views/home.js'), detail = read('app/js/views/show.js');
  assert.match(home, /const bgSrc = show\.backdrop \|\| cat\.thumb\(latest, 'maxresdefault'\)/, 'Home starts with the uploaded show backdrop');
  assert.match(detail, /const bgSrc = s\.backdrop \|\| \(latest \? cat\.thumb\(latest, 'maxresdefault'\) : ''\)/, 'the show page starts with the uploaded show backdrop');
  assert.match(home, /const bgFallback = \[show\.backdrop \? cat\.thumb\(latest, 'maxresdefault'\) : '', show\.posterLg \|\| show\.poster, cat\.thumb\(latest, 'hqdefault'\)\]/, 'Home keeps maxresdefault, poster, and hqdefault as the fallback chain');
  assert.match(detail, /const bgFallback = \[s\.backdrop && latest \? cat\.thumb\(latest, 'maxresdefault'\) : '', s\.posterLg \|\| s\.poster, latest \? cat\.thumb\(latest, 'hqdefault'\) : ''\]/, 'the show page keeps maxresdefault, poster, and hqdefault as the fallback chain');
  for (const [name, source] of [['Home', home], ['show page', detail]]) {
    const heroCalls = source.match(/heroBg\([^\n]+/g) || [];
    assert.ok(heroCalls.length, `${name} has a hero background`);
    for (const call of heroCalls) {
      assert.match(call, /blurUp: false/, `${name} disables blur-up for its hero art`);
      assert.doesNotMatch(call, /lowThumb|lowPoster|lowSrc/, `${name} does not pass low-resolution hero placeholders`);
    }
  }
});

test('main.js upgrades on load and runs the upgrade before the data-fb fallback on error', () => {
  const main = read('app/js/main.js');
  assert.match(main, /import \{ loadHighQuality, swapToHighQuality \} from '\.\/ui\/progressive\.js';/);
  const fn = main.match(/function wireImageFallbacks\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  // `load` events never reach window (the event path stops at document): the listener must be on document.
  assert.match(fn, /document\.addEventListener\('load'[\s\S]*loadHighQuality\(t\)/, 'load prefetches and swaps in the best rendition only after it arrives');
  assert.doesNotMatch(fn, /window\.addEventListener\('load'/, 'a window listener never receives image load events');
  assert.match(fn, /if \(!\(t instanceof HTMLImageElement\) \|\| swapToHighQuality\(t\)\) return;/, 'a failed placeholder jumps straight to the best rendition');
  assert.match(fn, /const \[fb, \.\.\.remaining\] = \(t\.dataset\.fb \|\| ''\)\.split\('\|'\)/, 'pipe-delimited fallbacks are attempted in order');
  assert.match(fn, /t\.dataset\.fb = remaining\.join\('\|'\)/, 'each fallback is consumed so a later failure advances the chain');
  assert.ok(fn.indexOf('swapToHighQuality(t)) return') < fn.indexOf("t.dataset.fbTried = '1'"), 'before the fallback is marked as tried');
});
