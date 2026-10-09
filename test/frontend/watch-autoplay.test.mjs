// Watch page (#/watch/:id) autoplay fallbacks: when a phone refuses even muted autoplay (Low Power Mode,
// data saver...), the page must offer an obvious "Tap to play" pill — and the tap itself is the gesture
// the browser needs. When muted autoplay works, the player’s own volume control handles unmuting.
// Run:  node --test test/frontend/watch-autoplay.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { register } from 'node:module';
import { parseHTML } from 'linkedom';

// Minimal DOM, installed before any app module is imported (they read window/document at module scope).
const { document, window, Element } = parseHTML('<!doctype html><html><head></head><body><main id="view"></main><div id="toasts"></div></body></html>');
globalThis.window = window; globalThis.document = document;
globalThis.location = { protocol: 'https:', origin: 'https://t.in', pathname: '/', hash: '', href: 'https://t.in/', search: '' };
window.location = globalThis.location;
globalThis.localStorage = window.localStorage ?? { getItem: () => null, setItem: () => {} };
globalThis.fetch = globalThis.fetch || (async () => { throw new Error('offline'); });
window.fetch = globalThis.fetch;
const scrollIntoViewCalls = [];
Element.prototype.scrollIntoView = function (...args) { scrollIntoViewCalls.push({ element: this, args }); };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };   // rails (related videos) measure themselves; linkedom has no layout

register(new URL('./watch-mock-loader.mjs', import.meta.url));
const { Catalog } = await import('../../app/js/data/catalog.js');
const { app } = await import('../../app/js/app.js');
const watch = (await import('../../app/js/views/watch.js')).default;

const VIDEO = { id: 'v1', kind: 'episode', episode: 1, title: 'Test episode', showId: 's1', duration: 100, views: 1, publishedAt: '2026-09-01T00:00:00Z', source: { type: 'youtube', id: 'abc' } };
const PREMIUM_VIDEO = { ...VIDEO, id: 'vp', episode: 2, title: 'Premium episode', access: 'premium', poster: 'media/premium-vp.webp', source: { type: 'r2', key: 'premium/x.mp4' } };
const PREMIUM_YT = { ...VIDEO, id: 'vpy', episode: 3, title: 'Premium on YouTube', access: 'premium', source: { type: 'youtube', id: 'zzz' } };
const RELATED_EPISODE = { ...VIDEO, id: 'r1', episode: 1, title: 'Related show premiere', showId: 's2', source: { type: 'youtube', id: 'def' } };
const R2_STANDALONE = { ...VIDEO, id: 'r2-standalone', title: 'Standalone R2', showId: null, source: { type: 'r2', key: 'testing/standalone.mp4' } };
app.catalog = app.fullCatalog = new Catalog({ schema: 1, updatedAt: '', shows: [
  { id: 's1', title: 'Show', titleEn: 'Show', genres: ['comedy'], cast: [], type: 'series', poster: 'media/shows/s1.webp' },
  { id: 's2', title: 'Related Show', titleEn: 'Related Show', genres: ['comedy'], cast: [], type: 'series' },
], videos: [VIDEO, PREMIUM_VIDEO, PREMIUM_YT, RELATED_EPISODE, R2_STANDALONE], upcoming: [], gallery: [] });
app.user = {
  remote: null, account: null, profiles: [], profile: { id: 'p1', name: 'T' }, activeId: 'p1', supportsAuth: false, isKids: false,
  gateFor: () => 'ok', progressOf: () => null, isFinished: () => false, pref: () => true, setPref: () => {},
  saveProgress: () => {}, fraction: () => 0, inList: () => false, hasReminder: () => false, on: () => {}, needsProfileChoice: () => false,
};

async function mount(id = 'v1') {
  globalThis.__watchOpts = null; globalThis.__watchCtl = null;
  document.getElementById('view').innerHTML = '';
  const root = document.createElement('div');
  const ctx = { root, params: { id }, query: {}, path: `/watch/${id}`, setTitle: () => {}, onCleanup: () => {} };
  await watch(ctx);
  if (id === 'vp') assert.equal(streamUrlRequests, 1, 'the signed R2 URL is fetched before the deferred player starts');
  assert.equal(globalThis.__watchCtl, null, 'player startup is deferred while the router still has a detached view');
  document.getElementById('view').appendChild(root); // Router commits the view after the renderer returns.
  await new Promise((r) => setTimeout(r, 30));   // requestAnimationFrame/setTimeout starts the player after the view commit
  assert.ok(globalThis.__watchCtl, 'the player was created');
  return { ctx, ctl: globalThis.__watchCtl, opts: globalThis.__watchOpts };
}

before(() => assert.ok(watch, 'watch view imported'));

test('page asks the player to start automatically on all devices', async () => {
  const { opts } = await mount();
  assert.equal(opts.autoplay, true, 'watch page requests autoplay and lets the player attempt the preferred sound mode first');
});

test('public watch metadata does not show catalog view count or content runtime', async () => {
  const { ctx } = await mount('v1');
  const meta = ctx.root.querySelector('.meta-line');
  assert.ok(meta);
  assert.doesNotMatch(meta.textContent, /views?/i);
  assert.doesNotMatch(meta.textContent, /\b1\s+views?\b/i, 'the fixture has one catalog view, which is no longer exposed');
  assert.doesNotMatch(meta.textContent, /\b1:40\b/, 'watch metadata omits this episode’s 100-second runtime');
});

test('watch actions are source-specific for YouTube and R2 videos', async () => {
  const { ctx: youtube } = await mount('v1');
  const ytActions = youtube.root.querySelector('.watch-actions');
  assert.equal(ytActions.querySelector('[data-list="video:v1"]'), null, 'YouTube has no Save video action');
  assert.equal(ytActions.querySelectorAll('[data-list="show:s1"]').length, 1, 'the show-level My List action remains');
  assert.ok(ytActions.querySelector('#castBtn'), 'the cast action is still available for other sources when supported');
  assert.ok(ytActions.querySelector('#shareBtn'), 'Share is preserved');
  assert.ok(ytActions.querySelector('#autoNext'), 'Autoplay next is preserved');

  streamUrlRequests = 0;
  const { ctx: r2 } = await mount('vp');
  const r2Actions = r2.root.querySelector('.watch-actions');
  assert.equal(streamUrlRequests, 1, 'the R2 media still uses its signed stream URL');
  assert.equal(r2Actions.querySelector('#castBtn'), null, 'R2 has no Cast action');
  assert.equal(r2Actions.querySelector('[data-list="video:vp"]'), null, 'R2 no longer saves just the episode');
  assert.equal(r2Actions.querySelectorAll('[data-list="show:s1"]').length, 1, 'R2 offers one show-level My List action');
  // No visible wording: the +/✓ icon is the button, and the wording is its accessible name/tooltip.
  const r2List = r2Actions.querySelector('[data-list="show:s1"]');
  assert.equal(r2List.textContent.trim(), '', 'the list action carries no text label');
  assert.equal(r2List.getAttribute('aria-label'), 'Add show to My List', 'the plus button still announces what it saves');
  assert.equal(r2List.title, 'Add show to My List', 'and shows the same wording as a tooltip');

  streamUrlRequests = 0;
  const { ctx: standalone } = await mount('r2-standalone');
  const soloActions = standalone.root.querySelector('.watch-actions');
  assert.equal(soloActions.querySelector('#castBtn'), null, 'standalone R2 also has no Cast action');
  assert.equal(soloActions.querySelector('[data-list^="video:"]'), null, 'without a parent show, the replacement list action is omitted');
  assert.equal(soloActions.querySelector('[data-list^="show:"]'), null, 'there is no invalid show ID to add');
  assert.ok(soloActions.querySelector('#shareBtn'), 'standalone R2 keeps Share');
  streamUrlRequests = 0;
});

test('the first successful playback records one database view start for this watch page', async () => {
  const previousRemote = app.user.remote, events = [];
  app.user.remote = { playEvent: (...args) => events.push(args) };
  try {
    const { opts } = await mount('v1');
    opts.onState('playing'); opts.onState('playing');
    assert.deepEqual(events, [['v1', 'start']], 'resumes/buffering within the page do not add duplicate views');
    opts.onState('paused');
  } finally { app.user.remote = previousRemote; }
});

test('Autoplay next counts down to the next episode when one exists', async () => {
  const { opts } = await mount('v1');
  opts.onEnded();
  const card = document.querySelector('#nextUp');
  assert.ok(card && !card.hidden, 'the next-up countdown appears when the video ends');
  assert.match(card.textContent, /Next in \d+s/);
  assert.match(card.textContent, /Premium episode/, 'the next episode is selected ahead of recommendations');
  assert.doesNotMatch(card.textContent, /Episode\s·/, 'the video type is not shown in the popup');
  assert.doesNotMatch(card.textContent, /recommended/i, 'the popup does not label the next video as recommended');
  assert.equal(card.querySelector('#nuCancel'), null, 'the large Cancel button is gone');
  card.querySelector('#nuClose').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(card.hidden, true, 'the small close button dismisses the countdown');
});

test('when the series has no next episode, Autoplay next recommends a related show episode', async () => {
  const { opts } = await mount('vpy');
  opts.onEnded();
  const card = document.querySelector('#nextUp');
  assert.ok(card && !card.hidden, 'a related recommendation appears at the end of the playlist');
  assert.match(card.textContent, /Next in \d+s/);
  assert.doesNotMatch(card.textContent, /recommended/i, 'no Recommended label appears in the popup');
  assert.match(card.textContent, /Related show premiere/, 'recommendations start with a related show episode');
  assert.doesNotMatch(card.textContent, /Episode\s·/, 'the video type is omitted');
  card.querySelector('#nuClose').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(card.hidden, true);
});

test('recommended-next countdown ticks preserve the thumbnail and card controls', async () => {
  const { opts } = await mount('vpy');
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  let tick, cleared = false;
  globalThis.setInterval = (fn, delay) => {
    if (delay === 1000) { tick = fn; return 'next-countdown'; }
    return realSetInterval(fn, delay);
  };
  globalThis.clearInterval = (id) => {
    if (id === 'next-countdown') { cleared = true; return; }
    return realClearInterval(id);
  };
  try {
    opts.onEnded();
    const card = document.querySelector('#nextUp');
    const thumbnail = card.querySelector('.next-card img');
    const playButton = card.querySelector('#nuPlay');
    const countdown = card.querySelector('[data-next-countdown]');
    assert.ok(thumbnail, 'the recommendation thumbnail is rendered');
    assert.ok(countdown);
    assert.match(countdown.textContent, /Next in \d+s/);
    const seconds = Number(countdown.textContent.match(/(\d+)s$/)[1]);

    tick();
    assert.equal(countdown.textContent, `Next in ${seconds - 1}s`);
    assert.equal(card.querySelector('.next-card img'), thumbnail, 'the same image node stays mounted across countdown ticks');
    assert.equal(card.querySelector('#nuPlay'), playButton, 'the rest of the recommendation card stays mounted too');

    card.querySelector('#nuClose').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(cleared, true, 'the close button still stops the timer');
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test('the next-up popup is translucent, compact and dismissible with a top-right cross', () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  const view = fs.readFileSync(new URL('../../app/js/views/watch.js', import.meta.url), 'utf8');
  assert.match(css, /\.next-up \{[^}]*right: 12px; bottom: 12px;[^}]*width: fit-content;/,
    'the popup shrink-wraps to content at the video bottom-right');
  assert.match(css, /\.next-card \{[^}]*grid-template-columns: 80px minmax\(0,1fr\); align-items: end;[^}]*background: rgba\(15,15,20,\.42\)[^}]*backdrop-filter: blur\(14px\)/,
    'the compact glass card aligns its contents to the bottom');
  assert.match(css, /\.next-card img \{ width: 68px; max-width: 68px; align-self: center; justify-self: end; \}/,
    'on phones the thumbnail sits in the upper-left content area beside the title and play action');
  assert.match(css, /\.next-close \{[^}]*inset: 6px 6px auto auto;[^}]*width: 28px; height: 28px;/,
    'the dismiss control is pinned to the upper-right corner');
  assert.match(view, /Next in \$\{n\}s/, 'the countdown does not use a Recommended label');
  assert.match(view, /id="nuClose" aria-label="Dismiss next video"/, 'the cross has an accessible name');
  assert.doesNotMatch(view, /cat\.label\(target\)|id="nuCancel"|Recommended next/, 'the video type, large Cancel button, and Recommended copy are removed');
});

test('Autoplay next disabled does not start an episode or recommendation countdown', async () => {
  const pref = app.user.pref;
  app.user.pref = () => false;
  try {
    const { opts } = await mount('vpy');
    opts.onEnded();
    assert.equal(document.querySelector('#nextUp').hidden, true);
  } finally { app.user.pref = pref; }
});

test('opening a watch page does not scroll the viewport down to the current episode row', async () => {
  scrollIntoViewCalls.length = 0;
  await mount('v1');
  assert.equal(scrollIntoViewCalls.length, 0, 'the page stays at the top instead of scrolling to the episode list');
});

test('when even muted autoplay is blocked, a "Tap to play" pill starts playback with one tap', async () => {
  const { ctx, ctl, opts } = await mount();
  assert.equal(document.querySelector('#playPill'), null, 'no pill while autostart works');
  opts.onAutoplayBlocked();   // the browser refused even muted playback
  const pill = document.querySelector('#playPill');
  assert.ok(pill, 'Tap-to-play pill shown when even muted autoplay is blocked');
  pill.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(ctl.__played, true, 'the tap started playback (the tap is the user gesture the browser needed)');
  await new Promise((r) => setTimeout(r));
  assert.equal(document.querySelector('#playPill'), null, 'pill removed after use');
  // Once playback reports 'playing', the pill must not linger.
  opts.onAutoplayBlocked(); opts.onState('playing');
  assert.equal(document.querySelector('#playPill'), null, 'playing state clears any leftover pill');
  assert.ok(ctx);
});

test('muted autostart uses the player volume control without a duplicate unmute pill', async () => {
  const { opts } = await mount();
  assert.equal(opts.onAutoplayMuted, undefined, 'watch does not add an app-level unmute prompt');
  assert.equal(document.querySelector('#unmutePill'), null, 'the player remains free of a duplicate Tap to unmute button');
});

// The player mock is not given a stream URL for R2 videos, so give the premium page one.
let streamUrlRequests = 0;
app.user.streamUrl = async () => { streamUrlRequests++; return { type: 'mp4', url: 'https://r2.test/premium/x.mp4' }; };

test('premium word: top-left of the player, hidden while the video plays, back on pause / end / error', async () => {
  streamUrlRequests = 0;
  await mount('vp');
  assert.equal(streamUrlRequests, 1, 'the R2 signing request starts during render and is reused by player startup');
  const box = document.querySelector('#playerBox');
  assert.ok(box.classList.contains('has-premium'), 'a premium video marks its player box');
  const mark = box.querySelector('.premium-mark.premium-mark-player');
  assert.ok(mark, 'the premium word is drawn inside the player box');
  assert.equal(box.classList.contains('is-playing'), false, 'visible before playback starts');
  const { opts } = { opts: globalThis.__watchOpts };

  opts.onState('buffering');
  assert.equal(box.classList.contains('is-playing'), false, 'still visible while the first frames load');
  opts.onState('playing');
  assert.equal(box.classList.contains('is-playing'), true, 'hidden (via .is-playing) while the video plays');
  opts.onState('buffering');
  assert.equal(box.classList.contains('is-playing'), true, 'a mid-play stall does not make the badge flash back in');
  opts.onState('paused');
  assert.equal(box.classList.contains('is-playing'), false, 'back on pause');
  opts.onState('playing');
  assert.equal(box.classList.contains('is-playing'), true);
  opts.onState('ended');
  assert.equal(box.classList.contains('is-playing'), false, 'back when the video ends');
  opts.onState('playing');
  opts.onState('error', 2);
  assert.equal(box.classList.contains('is-playing'), false, 'back when playback fails');
});

test('free videos get no premium word and no premium markers', async () => {
  await mount('v1');
  const box = document.querySelector('#playerBox');
  assert.equal(box.querySelector('.premium-mark'), null);
  assert.equal(box.classList.contains('has-premium'), false);
  globalThis.__watchOpts.onState('playing');   // toggling the state class on a free video is harmless
  assert.equal(box.querySelector('.premium-mark'), null);
});

// Renders the watch page for a locked viewer (signed in, no plan).
async function mountLocked(id) {
  document.getElementById('view').innerHTML = '';
  const root = document.createElement('div');
  document.getElementById('view').appendChild(root);
  await watch({ root, params: { id }, setTitle() {}, onCleanup() {} });
  return root;
}

test('locked premium shows the video artwork behind the lock wall instead of a black background', async () => {
  const originalGate = app.user.gateFor;
  app.user.gateFor = (v, c) => (c.isPremium(v) ? 'plan' : 'ok');   // signed-in viewer without a plan
  try {
    const root = await mountLocked('vp');
    const box = root.querySelector('#playerBox');
    assert.ok(box.classList.contains('has-wall'), 'the player box flags that artwork sits behind the wall');
    const bg = box.querySelector('.player-wall-bg');
    assert.ok(bg, 'the same-origin artwork is painted as a CSS background (cannot fail or be hidden)');
    assert.match(bg.getAttribute('style'), /media\/premium-vp\.webp/);
    assert.equal(box.querySelector('img.player-wall-art'), null, 'no separate thumbnail layer when there is no remote thumb');
    assert.equal(root.querySelector('#playerMsg').hidden, false, 'the lock wall itself still shows');
    assert.equal(root.querySelector('#playerMsg p'), null, 'no descriptive text under the lock icon');
    assert.equal(root.querySelector('#playerSlot').innerHTML, '', 'no player is created while locked');

    // A YouTube-sourced premium video layers its remote thumbnail over the same-origin background,
    // so a network that blocks i.ytimg.com still sees the show artwork, never a black box.
    const ytRoot = await mountLocked('vpy');
    const ytBox = ytRoot.querySelector('#playerBox');
    assert.match(ytBox.querySelector('.player-wall-bg').getAttribute('style'), /media\/shows\/s1\.webp/);
    const wallArt = ytBox.querySelector('img.player-wall-art');
    assert.equal(wallArt.getAttribute('src'), 'https://i.ytimg.com/vi/zzz/mqdefault.jpg', 'a small rendition shows first');
    assert.equal(wallArt.getAttribute('data-hq'), 'https://i.ytimg.com/vi/zzz/maxresdefault.jpg', 'the best one replaces it once loaded');
  } finally {
    app.user.gateFor = originalGate;
  }
});

test('lock-wall CSS: artwork covers the box and the wall stays readable over it', () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.player-wall-bg \{[^}]*background-size: cover/, 'the same-origin artwork fills the player box instead of a black background');
  assert.match(css, /\.player-wall-bg \{[^}]*z-index: 1/, 'the artwork paints above the opaque black player slot');
  assert.match(css, /img\.player-wall-art \{[^}]*object-fit: cover/, 'the remote thumbnail layer also fills the box');
  assert.match(css, /img\.player-wall-art \{[^}]*z-index: 1/, 'the thumbnail layer also paints above the slot');
  assert.match(css, /\.player-box\.has-wall \.player-overlay \{[^}]*linear-gradient/, 'the wall dims the artwork so its text stays readable');
});
