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

test('the poster box, the expand button and the banner all open the full artwork', () => {
  for (const file of ['app/js/views/soon.js', 'app/js/views/show.js']) {
    const view = read(file);
    assert.match(view, /<button type="button" class="detail-poster" id="detailPoster" aria-label="Open the full poster">/, `${file}: the poster is a button`);
    assert.match(view, /fitPoster\(ctx\.root\)/, `${file}: the box adapts to the image`);
    assert.match(view, /id="detailPoster"|#detailPoster'/, `${file}: wired`);
    assert.match(view, /#detailPoster'[^\n]*openArtwork\(art, 'poster'\)/, `${file}: the poster box opens the poster`);
    assert.match(view, /<section class="detail-hero" id="detailHero">/, `${file}: the banner has an id to hang the tap handler on`);
    assert.match(view, /id="artBtn" aria-label="View the full artwork"/, `${file}: an expand button remains available`);
    // The expand button and a tap on the banner open the picture the BANNER is showing (the reported bug: on a
    // phone they did not agree with it). The show page resolves that per tap, because heroBg swaps the poster
    // in below 760px; Coming Soon's banner is a plain <img> of the backdrop, so it always opens the backdrop.
    if (file.endsWith('show.js')) {
      assert.match(view, /const bannerMode = \(\) => bannerArtMode\(art\);/, `${file}: the banner's current artwork is resolved on each tap`);
      assert.match(view, /#artBtn'[^\n]*openArtwork\(art, bannerMode\(\)\)/, `${file}: the expand button opens what the banner shows`);
      assert.match(view, /tapArtwork\(.{0,40}art, bannerMode\);/, `${file}: and so does a tap on the banner`);
    } else {
      assert.match(view, /tapArtwork\(.{0,40}art\);/, `${file}: and tapping the banner opens the artwork`);
      assert.match(view, /#artBtn'[^\n]*openArtwork\(art, 'backdrop'\)/, `${file}: the expand button opens what the banner shows`);
    }
  }
  // On a phone the poster box is display:none, so the banner remains another easy artwork entry point —
  // but it must never steal clicks from the buttons in the hero or fire when the viewer was selecting text.
  const lightbox = read('app/js/ui/lightbox.js');
  assert.match(lightbox, /export function tapArtwork\(hero, art, start = 'backdrop'\)/, 'tapArtwork exists and defaults to the wide still');
  assert.match(lightbox, /if \(e\.target\.closest\('a, button, input, select, textarea, label'\)\) return;/, 'buttons and links keep their own job');
  assert.match(lightbox, /window\.getSelection\?\.\(\)/, 'a text selection is not a tap');
  assert.match(lightbox, /openArtwork\(art, typeof start === 'function' \? start\(\) : start\)/, 'and it opens what the banner is showing at that moment');
  // The popup itself: a single image has no arrows and no counter; tapping the dark background closes it.
  assert.match(lightbox, /const many = items\.length > 1;/, 'a single image has no arrows');
  assert.match(lightbox, /cap\.textContent = !showCaption \? '' : many \?/, 'gallery counters remain conditional while artwork popups can hide captions');
  assert.match(lightbox, /e\.target\.closest\('\.lb-close'\) \|\| e\.target === root/, 'the X and the backdrop close it');
  // And the phone layout itself is untouched: the poster box stays hidden, the banner carries the feature.
  assert.match(read('app/css/styles.css'), /@media \(min-width: 760px\) \{ \.hero-poster, \.detail-poster \{ display: block; \} \}/, 'the poster box is still desktop-only');
});

test('Coming Soon keeps the artwork expand button beside My List on phones', () => {
  const soon = read('app/js/views/soon.js');
  const actions = soon.match(/<div class="hero-actions soon-hero-actions">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.ok(actions, 'the Coming Soon page has its own action row');
  assert.ok(actions.indexOf('remindBtn(') < actions.indexOf('listBtn('), 'Remind me remains first');
  assert.ok(actions.indexOf('listBtn(') < actions.indexOf('id="artBtn"'), 'the artwork action follows My List');
  assert.match(soon, /id="shareBtn"/, 'the Share action is preserved');
  assert.match(actions, /listBtn\('upcoming', u\.id, \{ label: 'Add to My List', cls: 'btn btn-glass btn-lg icon-only' \}\)/,
    'the Coming Soon My List action is the plus/check icon only');

  const css = read('app/css/styles.css');
  assert.match(css, /\.soon-hero-actions \{ display: grid; grid-template-columns: minmax\(0,1fr\) 48px 48px 48px;/,
    'mobile Coming Soon actions use one flexible reminder column and three fixed icon columns');
  assert.match(css, /\.soon-hero-actions > #artBtn, \.soon-hero-actions > \.list-btn, \.soon-hero-actions > #shareBtn \{ width: 48px; height: 48px; padding: 0; \}/,
    'the icon controls keep one compact, fixed size beside the reminder');
  assert.match(css, /@media \(max-width: 359px\) \{\n  \.soon-hero-actions \{ grid-template-columns: minmax\(0,1fr\) 44px 44px 44px; gap: 6px; \}/,
    'the same row adapts for especially narrow phones');
});

test('show details keep all four hero controls in one row on phones', () => {
  const show = read('app/js/views/show.js');
  const actions = show.match(/<div class="hero-actions">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.ok(actions, 'the show page has one hero action row');
  assert.ok(actions.indexOf('trailer.id') < actions.indexOf('listBtn('), 'the trailer icon comes before My List');
  assert.ok(actions.indexOf('listBtn(') < actions.indexOf('id="artBtn"'), 'the artwork control follows My List');
  assert.match(actions, /href="#\/watch\/\$\{trailer\.id\}" aria-label="Watch trailer" title="Watch trailer"/,
    'Trailer stays available as an accessible icon-only button');
  assert.doesNotMatch(actions, /\} Trailer<\/a>/, 'the Trailer text is removed');
  assert.match(actions, /listBtn\('show', s\.id, \{ cls: 'btn btn-glass btn-lg icon-only' \}\)/,
    'the show-page My List action is the accessible plus/check icon only');
  assert.match(show, /id="shareBtn"/, 'Share remains available outside the compact mobile row');

  const css = read('app/css/styles.css');
  assert.match(css, /\.detail-hero \.hero-actions \{ gap: 8px; flex-wrap: nowrap; \}/,
    'the detail-page actions never wrap on phones');
  assert.match(css, /\.detail-hero \.hero-actions > \.btn-primary \{ flex: 0 1 auto; \}/,
    'the main action stays content-sized instead of stretching into empty space');
  assert.match(css, /\.detail-hero \.hero-actions > \.btn-lg\.icon-only \{ flex: 0 0 48px; width: 48px; padding: 0; \}/,
    'the other three controls use equal compact columns');
  assert.match(css, /\.detail-hero \.hero-actions > \.btn-lg\.icon-only \{ flex-basis: 44px; width: 44px; \}/,
    'the compact controls narrow further on very small phones without shrinking in height');
  // On phones the show and Coming Soon banners use the same lower-only fade as the home hero: the
  // artwork above stays clear and the darkening starts where the text and the action row begin.
  assert.match(css, /\.hero-shade, \.detail-hero \.hero-shade \{ background: var\(--hero-fade-mobile\); \}/,
    'the detail banners share the home hero’s phone fade');
  const fade = css.match(/--hero-fade-mobile:\s*([^;]+);/)?.[1] || '';
  assert.ok(fade, 'the shared phone fade is defined once, as a token');
  assert.match(fade, /^linear-gradient\(0deg/, 'it is a lower-only fade, not a top-down wash');
  assert.doesNotMatch(fade, /180deg|90deg|270deg/, 'nothing darkens the poster from the top or from either side');
  // The lower half still needs to be a real scrim under the text and actions — but it was lightened from .72
  // to .62 on purpose, so pin the band rather than one number.
  const mid = Number(fade.match(/rgba\(5,5,5,\.(\d+)\) 46%/)?.[1]);
  assert.ok(mid >= 55 && mid <= 72, `the lower half still darkens enough for the hero text and actions (got .${mid})`);
  assert.match(fade, /rgba\(5,5,5,0\) 78%/, 'and it is gone by the upper third, so the artwork up there stays clear');
  const phones = css.slice(css.indexOf('@media (max-width: 759px)'));
  assert.ok(phones.indexOf('--hero-fade-mobile') > 0, 'the fade only applies on phones');
  assert.doesNotMatch(phones, /^\s*\.detail-hero \.hero-shade \{[^}]*background:/m, 'the detail banner keeps no separate phone scrim');
  assert.match(css.slice(0, css.indexOf('@media (max-width: 759px)')), /\.hero-shade \{[^}]*linear-gradient\(180deg/,
    'desktops keep the banner scrim they always had');
});

test('show facts sit below the banner and the tagline uses the page font', () => {
  const show = read('app/js/views/show.js');
  const heroStart = show.indexOf('<section class="detail-hero"');
  const heroEnd = show.indexOf('</section>', heroStart);
  const facts = show.indexOf('<dl class="facts show-facts-below">');
  const tagline = show.indexOf('class="show-tagline-below"');
  const description = show.indexOf('<section class="show-description"');
  assert.ok(heroStart >= 0 && facts > heroEnd, 'cast and episode facts no longer cover the banner artwork');
  assert.ok(facts < tagline && tagline < description, 'facts and tagline stay together before the description');
  assert.doesNotMatch(show, /show-tagline-below bn/, 'the tagline no longer uses the Bengali serif display override');

  const css = read('app/css/styles.css');
  assert.match(css, /\.page-tight\.show-details-page \{ padding-top: 12px; \}/, 'desktop below-banner information has a small gap');
  assert.match(css, /\.show-tagline-below \{[^}]*font-family: var\(--font\)/, 'the tagline uses the same font stack as the rest of the page');
  assert.match(css, /\.detail-hero \{ min-height: 74vh; min-height: 74svh; \}/, 'the phone detail banner matches the home banner height');
  assert.match(css, /\.detail-hero \.hero-inner \{ padding-bottom: 12px; \}/, 'the hero text block sits lower to align with the home banner');
  assert.match(css, /\.page-tight\.show-details-page \{ padding-top: 0; \}/, 'mobile show facts start directly under the banner with no dead gap');
});

test('a long episode list scrolls inside its own frame instead of stretching the page', async () => {
  // Reported from a phone with 18 episodes: the list ran the page on indefinitely. The list now has its own
  // scroll region, so the header, facts, description and rails keep their place.
  const show = read('app/js/views/show.js');
  assert.match(show, /<div class="ep-list ep-frame" id="epList" role="region" tabindex="0" aria-label="Episode list">/,
    'the list is a focusable, named scroll region');
  assert.match(show, /const box = \$\('#epList', ctx\.root\);\n\s*box\.innerHTML = list\.map\(\(v\) => epRow\(v\)\)\.join\(''\);\n\s*box\.scrollTop = 0;/,
    're-sorting returns the frame to the top of the new order');

  const css = read('app/css/styles.css');
  const frame = css.match(/\.ep-frame \{[^}]*\}/)?.[0] || '';
  assert.ok(frame, 'the frame rule exists');
  assert.match(frame, /max-height: clamp\(280px, 58vh, 620px\)/, 'the list is capped to a share of the viewport');
  assert.match(frame, /max-height: clamp\(280px, 58svh, 620px\)/, 'and to the small viewport height on phones (iOS URL bar)');
  assert.match(frame, /overflow-y: auto/, 'the rest of the list scrolls inside the frame');
  assert.doesNotMatch(frame, /overscroll-behavior: contain/,
    'the frame does not trap the finger — its scroll chains back to the page at either end');
  assert.match(css, /\.ep-frame:focus-visible \{ outline: 2px solid var\(--gold\); outline-offset: 2px; \}/,
    'keyboard focus on the frame is visible');
  // The watch page's own side list is a different surface: it must keep its compact rows and its own scroller.
  assert.match(css, /\.ep-list\.compact \.ep-row \{[^}]*grid-template-columns: 26px 104px 1fr;/, 'the compact variant is unchanged');
  assert.match(css, /\.watch-side \{[^}]*overflow-y: auto;/, 'the desktop watch panel keeps scrolling as before');
  assert.doesNotMatch(read('app/js/views/watch.js'), /ep-frame/, 'the watch page does not get a second scroller inside the panel');
});

test('the artwork popup shows the banner and the poster, each once', async () => {
  const { artworkItems, openArtwork } = await import('../../app/js/ui/lightbox.js');
  assert.deepEqual(artworkItems({ poster: 'p.jpg', backdrop: 'b.jpg' }).map((x) => [x.id, x.image, x.caption]),
    [['backdrop', 'b.jpg', 'Artwork'], ['poster', 'p.jpg', 'Poster']], 'banner first, then the poster');
  assert.deepEqual(artworkItems({ poster: 'same.jpg', backdrop: 'same.jpg' }).map((x) => x.id), ['backdrop'], 'the same file is not shown twice');
  assert.deepEqual(artworkItems({ backdrop: 'b.jpg' }).map((x) => x.id), ['backdrop'], 'a title with no poster still opens');
  assert.equal(artworkItems({}).length, 0);
  assert.equal(openArtwork({}), undefined, 'and nothing opens when there is no artwork at all');
});

test('a tap on the banner really opens the popup (the reported bug)', async () => {
  // Reported from a phone: "No full image popup opening on click of the banner poster". On a phone the
  // poster box is display:none, so the banner is what a viewer taps — and that tap did nothing.
  const { parseHTML } = await import('linkedom');
  const { document, window } = parseHTML(`<!doctype html><html><body>
    <section class="detail-hero" id="detailHero">
      <div class="hero-bg"><img src="b.jpg"></div>
      <div class="hero-inner"><div class="hero-copy"><p id="txt">A coming soon title</p>
        <button id="remind">Remind me</button></div></div>
    </section></body></html>`);
  globalThis.window = window; globalThis.document = document;
  window.location = globalThis.location = { href: 'http://x/soon/y' };
  globalThis.history = { pushState() {}, back() {} };
  globalThis.Image = class { set src(_v) {} };                 // the popup preloads the next image
  const { tapArtwork } = await import('../../app/js/ui/lightbox.js');
  const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
  const hero = document.getElementById('detailHero');
  tapArtwork(hero, { title: 'T', poster: 'p.jpg', backdrop: 'b.jpg' });

  click(document.getElementById('remind'));
  assert.equal(document.querySelector('.lightbox'), null, 'a button in the hero keeps its own job');

  click(document.getElementById('txt'));
  const lb = document.querySelector('.lightbox');
  assert.ok(lb, 'tapping the banner artwork opens the popup');
  assert.equal(lb.querySelector('img').getAttribute('src'), 'b.jpg', 'and shows the banner full size first');
  assert.equal(lb.querySelectorAll('.lb-nav').length, 2, 'the poster is one swipe away');
  assert.equal(lb.querySelector('figcaption').textContent, '', 'the banner popup has no visible Artwork caption or counter');
  assert.equal(lb.querySelector('figcaption').hidden, true, 'the artwork and poster labels stay hidden in this popup');
  assert.equal(lb.querySelector('.lb-close') !== null, true, 'with a close button');
});

test('a banner tap on a phone opens the poster the banner is showing, not the wide still', async () => {
  // Reported from a phone: the expand button and the banner showed different pictures. `heroBg` swaps the
  // poster in below 760px, so on a phone the banner IS the poster and both entry points must open the poster.
  const { parseHTML } = await import('linkedom');
  const { document, window } = parseHTML('<!doctype html><html><body><section id="detailHero"><div class="hero-bg"></div><p id="txt">Laugh Bite</p></section></body></html>');
  globalThis.window = window; globalThis.document = document;
  window.location = globalThis.location = { href: 'http://x/show/laugh-bite' };
  globalThis.history = { pushState() {}, back() {} };
  globalThis.Image = class { set src(_v) {} };
  const { tapArtwork } = await import('../../app/js/ui/lightbox.js');
  const { bannerArtMode, HERO_POSTER_MQ } = await import('../../app/js/ui/components.js');
  const art = { title: 'Laugh Bite', poster: 'media/shows/laugh-bite-lg.webp', backdrop: 'https://i.ytimg.com/vi/x/maxresdefault.jpg' };
  // The mode follows the same media query the banner markup uses; the test harness has no layout, so stub it.
  const phone = () => { window.matchMedia = (q) => ({ matches: q === HERO_POSTER_MQ }); };
  const desktop = () => { window.matchMedia = () => ({ matches: false }); };

  phone();
  assert.equal(bannerArtMode(art), 'poster', 'on a phone the banner is showing the poster');
  tapArtwork(document.getElementById('detailHero'), art, () => bannerArtMode(art));
  document.getElementById('txt').dispatchEvent(new window.Event('click', { bubbles: true }));
  const lb = document.querySelector('.lightbox');
  assert.ok(lb, 'the tap opens the popup');
  assert.equal(lb.querySelector('img').getAttribute('src'), 'media/shows/laugh-bite-lg.webp', 'and it shows the poster the banner displays');
  assert.equal(lb.querySelectorAll('.lb-nav').length, 2, 'the wide still is one swipe away');
  document.querySelector('.lb-close').dispatchEvent(new window.Event('click', { bubbles: true }));

  desktop();
  assert.equal(bannerArtMode(art), 'backdrop', 'on a wide screen the banner is showing the still');
  assert.equal(bannerArtMode({ poster: 'p.jpg', backdrop: 'p.jpg' }), 'backdrop', 'a title with one picture needs no choice');
  assert.equal(bannerArtMode({ poster: 'p.jpg' }), 'backdrop', 'and neither does one with no still at all');

  // The same art object also feeds the popup's fallback: a still without a max-resolution rendition swaps to
  // the hqdefault YouTube publishes, instead of leaving a broken image (main.js reads data-fb on error).
  const { artworkItems } = await import('../../app/js/ui/lightbox.js');
  const items = artworkItems({ poster: 'p.jpg', backdrop: 'max.jpg', backdropFallback: 'hq.jpg' });
  assert.equal(items[0].fallback, 'hq.jpg', 'the wide still carries its fallback');
  assert.equal(items[1].fallback, undefined, 'the local poster needs none');
  assert.equal(artworkItems({ backdrop: 'same.jpg', backdropFallback: 'same.jpg' })[0].fallback, '', 'never the same URL twice');
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
