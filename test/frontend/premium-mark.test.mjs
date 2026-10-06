import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

// The Premium word-mark: one small badge (premiumMark) used on show posters, video/reel thumbnails, episode rows,
// the hero and the player. It sits in the TOP-LEFT corner of the artwork/video and steps aside while a video plays.
const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
// The declaration block of the rule that starts a line with exactly this selector ('' when there is none).
const block = (selector) => {
  const line = css.split('\n').find((l) => l.startsWith(`${selector} {`));
  return line ? line.slice(line.indexOf('{') + 1, line.indexOf('}')) : '';
};

test('the premium word sits in the top-left corner everywhere it is used (never the right)', () => {
  for (const selector of ['.premium-mark', '.premium-mark-compact', '.premium-mark-hero', '.premium-mark-player']) {
    const decl = block(selector);
    assert.ok(decl, `${selector} rule exists`);
    assert.match(decl, /(^|[\s;])left:/, `${selector} is anchored to the left`);
    assert.equal(/(^|[\s;])right:/.test(decl), false, `${selector} is not anchored to the right`);
  }
  assert.match(block('.premium-mark'), /position:\s*absolute/);
  assert.match(block('.premium-mark'), /top:\s*8px/);
});

test('the premium word is hidden while a video plays: watch page (.is-playing) and the active, un-paused reel', () => {
  const line = css.split('\n').find((l) => l.startsWith('.player-box.is-playing .premium-mark'));
  assert.ok(line, 'a hide rule for the watch page player exists');
  assert.ok(line.includes('.reel.playing:not(.paused) .premium-mark'), 'the same rule covers an active, un-paused reel');
  const decl = line.slice(line.indexOf('{') + 1, line.indexOf('}'));
  assert.match(decl, /opacity:\s*0/);
  assert.match(decl, /visibility:\s*hidden/);
  assert.match(block('.premium-mark'), /transition:[^;]*opacity/, 'it fades rather than popping');
});

test('things that share the top-left corner make room for the premium word', () => {
  assert.match(block('.chip-label.chip-after-mark'), /left:\s*9\d+px/, 'the EP / Reel label chip moves beside the wider word badge');
  assert.match(block('.player-box.has-premium .unmute-pill'), /left:\s*\d+px/, '"Tap to play" does not sit under the badge');
  assert.match(block('.reel-frame.has-premium .unmute-pill'), /left:\s*\d+px/);
});

test('premium cards carry the golden premium word (and the label chip steps aside); free cards do not', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.ADDABAAZ_ENV = {};
  const { app } = await import('../../app/js/app.js');
  const { Catalog } = await import('../../app/js/data/catalog.js');
  const { showCard, videoCard, reelCard, premiumMark } = await import('../../app/js/ui/components.js');
  const video = (id, extra) => ({ id, kind: 'episode', title: id, showId: 'free-show', duration: 60, views: 1, publishedAt: '2026-01-01T00:00:00Z', source: { type: 'youtube', id: 'abcdefghijk' }, ...extra });
  app.catalog = new Catalog({
    shows: [{ id: 'free-show', title: 'Free show', poster: 'media/a.webp' }, { id: 'pro-show', title: 'Pro show', poster: 'media/b.webp', access: 'premium' }],
    videos: [video('free-ep'), video('pro-ep', { access: 'premium' }), video('pro-reel', { kind: 'reel', access: 'premium' }), video('free-reel', { kind: 'reel' })],
  });
  const dom = (markup) => { const el = document.createElement('div'); el.innerHTML = markup.s ?? markup; return el; };

  const mark = dom(premiumMark()).querySelector('.premium-mark');
  assert.ok(mark, 'premiumMark() renders the badge');
  assert.equal(mark.getAttribute('role'), 'img');
  assert.equal(mark.getAttribute('aria-label'), 'Premium content');
  const word = mark.querySelector('.premium-word');
  assert.ok(word, 'the badge is the golden premium word, not an icon');
  assert.equal(word.textContent, 'premium');
  assert.equal(mark.querySelector('svg'), null, 'no crown artwork remains in the badge');

  const premiumCard = dom(videoCard(app.catalog.video('pro-ep')));
  assert.ok(premiumCard.querySelector('.thumb .premium-mark'), 'premium video thumbnail has the badge');
  assert.ok(premiumCard.querySelector('.chip-label.chip-after-mark'), 'its label chip sits beside the badge');
  const freeCard = dom(videoCard(app.catalog.video('free-ep')));
  assert.equal(freeCard.querySelector('.premium-mark'), null, 'free video has no badge');
  assert.equal(freeCard.querySelector('.chip-after-mark'), null, 'and its label chip stays in the corner');

  assert.ok(dom(showCard(app.catalog.show('pro-show'))).querySelector('.poster .premium-mark'), 'premium show poster has the badge');
  assert.equal(dom(showCard(app.catalog.show('free-show'))).querySelector('.premium-mark'), null);
  // Reels (like trailers and clips) are free previews: they never wear the badge, even on a premium show.
  assert.equal(dom(reelCard(app.catalog.video('pro-reel'))).querySelector('.premium-mark'), null, 'a premium-flagged reel is free content: no badge');
  assert.equal(dom(reelCard(app.catalog.video('free-reel'))).querySelector('.premium-mark'), null);
});
