// Why the site looked warmer and flatter than the same posters on Facebook, and what was done about it:
//
//   * the artwork files themselves were colour-faithful (scripts/optimize-images.sh keeps the pixels exact),
//     but they were only 400px wide and quality 78, so cards were upscaled and soft on a 2x phone;
//   * video cards used YouTube's 480x360 `hqdefault` thumbnail — the smallest rendition — where the app has
//     `sddefault` (78% more pixels) and, for full-screen reels, `maxresdefault`;
//   * a near-black page with a heavy banner scrim makes correctly-coloured artwork read dull and warm.
//
// These assertions keep the fixes in place. They are deliberately about *how* the art is delivered and lifted
// — never about changing its colours, which stay exact (and the lightbox keeps showing the untouched file).
// Run:  node --test test/frontend/artwork-quality.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const css = read('app/css/styles.css');

test('video cards ask for a bigger YouTube thumbnail, with the default as the fallback', () => {
  const src = read('app/js/ui/components.js');
  const fn = src.match(/export function ytImg\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, 'ytImg is exported');
  assert.match(fn, /catalog\.thumb\(v, 'sddefault'\)/, 'cards ask for sddefault (640x480) instead of the 480x360 default');
  assert.match(fn, /const hq = app\.catalog\.thumb\(v, 'hqdefault'\);/, 'the default rendition is kept as the fallback');
  assert.match(fn, /fallback: hq && hq !== src \? hq : ''/, 'data-fb drops back to it, never to the same URL');
  // The hero already uses maxresdefault; that must not regress either.
  assert.match(read('app/js/views/home.js'), /cat\.thumb\(latest, 'maxresdefault'\)/, 'the home banner uses maxresdefault');
  assert.match(read('app/js/views/show.js'), /cat\.thumb\(latest, 'maxresdefault'\)/, 'the show banner uses maxresdefault');
});

test('full-screen reel covers use the largest YouTube rendition', () => {
  const reels = read('app/js/views/reels.js');
  assert.match(reels, /cat\.thumb\(v, 'maxresdefault'\)/, 'reels ask for maxresdefault (1280x720)');
  assert.match(reels, /cat\.thumb\(v, 'hqdefault'\)/, 'and keep the default as the fallback');
  assert.match(reels, /img\(cover\.src, '', \{ fallback: cover\.fallback,/, 'the cover passes its fallback through to the img');
});

test('the image pipeline renders cards at 600px and everything at quality 84 with webp:method=6', () => {
  const sh = read('scripts/optimize-images.sh');
  assert.match(sh, /\[quality:?\]?/, 'the script documents its quality parameter');
  assert.match(sh, /render images\/Shahid\.webp\s+shows shahid\s+600 1600/, 'show posters: 600px cards, full-size detail art');
  assert.match(sh, /render "\$f" upcoming "\$\(slug "\$f"\)" 600 1600/, 'upcoming posters at the same sizes');
  assert.match(sh, /render "\$f" bts\s+"\$\(slug "\$f"\)" 600 1600/, 'BTS gallery at the same sizes');
  assert.match(sh, /local src="\$1" group="\$2" name="\$3" sm="\$4" lg="\$5" q="\$\{6:-84\}"/, 'quality defaults to 84');
  assert.match(sh, /-quality "\$q" -define webp:method=6/, 'encoding uses the smallest-for-quality WebP method');
  assert.match(sh, /-resize "\$\{sm\}x>"/, 'resizing still only ever shrinks an image');
});

test('the artwork lift is applied to artwork only, never to text or the lightbox', () => {
  assert.match(css, /--art-pop: saturate\(1\.12\) contrast\(\.99\) brightness\(1\.05\)/, 'one tunable lift is defined');
  assert.match(css, /--art-pop-hero: saturate\(1\.15\) contrast\(\.99\) brightness\(1\.07\)/, 'the banner computes its own (it sits under a scrim)');
  // contrast() must stay at or below 1: a contrast above 1 scales values around mid-grey and therefore
  // darkens the (already near-black) posters — the exact effect that read as "dull and warm".
  for (const [name, value] of [['--art-pop', css.match(/--art-pop: ([^;]+);/)?.[1] || ''], ['--art-pop-hero', css.match(/--art-pop-hero: ([^;]+);/)?.[1] || '']]) {
    const con = Number(value.match(/contrast\(([\d.]+)\)/)?.[1]);
    const bri = Number(value.match(/brightness\(([\d.]+)\)/)?.[1]);
    const sat = Number(value.match(/saturate\(([\d.]+)\)/)?.[1]);
    assert.ok(con <= 1, `${name} does not darken the artwork (contrast ${con})`);
    assert.ok(bri > 1, `${name} lifts the artwork (brightness ${bri})`);
    assert.ok(sat >= 1.1, `${name} brings the colour up (saturate ${sat})`);
  }
  assert.match(css, /\.poster img, \.thumb img \{[^}]*filter: var\(--art-pop\); \}/, 'poster and thumbnail cards use it');
  assert.match(css, /\.ep-thumb img, \.reel-slot > img \{ filter: var\(--art-pop\); \}/, 'episode rows and reel covers use it');
  assert.match(css, /\.hero-bg img \{[^}]*filter: var\(--art-pop-hero\); \}/, 'the banner artwork uses it');
  // The blurred player wall and the darkened release carousel mirror keep their own deliberate filters.
  assert.match(css, /img\.player-wall-art \{[^}]*filter: brightness\(\.55\) saturate\(\.9\);[^}]*\}/, 'the player wall stays dim');
  assert.match(css, /\.home-release-bg \{[^}]*filter: blur\(24px\) brightness\(\.55\);[^}]*\}/, 'the blurred release mirror stays dim');
  // The lightbox shows the file as uploaded: no filter on it (it is the "check the colour" view).
  const lightbox = css.match(/\.lightbox img \{[^}]*\}/)?.[0] || '';
  assert.ok(lightbox, 'the lightbox image rule exists');
  assert.doesNotMatch(lightbox, /filter:/, 'the full-size artwork view is untouched');
  // Video playback must never be colour-graded by these rules.
  const players = read('app/js/players/html5.js') + read('app/js/players/youtube.js');
  assert.doesNotMatch(players, /filter\s*[:=]/, 'no filter is applied to the playing video');
});

test('the banner scrim was lightened but stays dark enough for white text', () => {
  const shade = css.match(/\.hero-shade \{ position: absolute;[^}]*\}/)?.[0] || '';
  assert.ok(shade, 'the banner shade rule exists');
  const left = Number(shade.match(/rgba\(5,5,5,\.(\d+)\) 0%/)?.[1]);
  assert.ok(left >= 85 && left <= 92, `the left edge stays near-solid for the title (got .${left})`);
  assert.doesNotMatch(shade, /\.94|\.70|\.15/, 'the old, heavier scrim is gone');
  const mobile = css.match(/--hero-fade-mobile:[^;]+;/)?.[0] || '';
  assert.match(mobile, /rgba\(5,5,5,\.86\) 26%/, 'phone banners keep a fading (not flat) scrim');
});
