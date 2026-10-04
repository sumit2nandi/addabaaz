// CC controls should exist only when a subtitle file actually loads for the current video.
// Run: node --test test/frontend/subtitle-icon.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.document = document;
globalThis.window = window;
globalThis.location = { pathname: '/test', search: '', hash: '' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {} };

// linkedom has no media element behaviour. Supply just the video APIs and text-track list used by the player.
const createElement = document.createElement.bind(document);
document.createElement = (tag) => {
  const el = createElement(tag);
  if (tag === 'video') {
    Object.defineProperties(el, {
      textTracks: { value: [], configurable: true }, paused: { value: true, writable: true, configurable: true },
      ended: { value: false, writable: true, configurable: true }, duration: { value: 30, writable: true, configurable: true },
      currentTime: { value: 0, writable: true, configurable: true }, readyState: { value: 0, writable: true, configurable: true },
      volume: { value: 1, writable: true, configurable: true }, muted: { value: false, writable: true, configurable: true },
    });
    const append = el.appendChild.bind(el);
    el.appendChild = (child) => {
      const result = append(child);
      if (child.tagName === 'TRACK') el.textTracks.push({ language: child.srclang, label: child.label, mode: 'disabled' });
      return result;
    };
    el.play = () => Promise.resolve();
    el.pause = () => { el.paused = true; };
    el.load = () => {};
  }
  return el;
};

const { createHtml5Player } = await import('../../app/js/players/html5.js');
const video = (subtitles = []) => ({
  source: { type: 'mp4', url: 'https://media.example.test/video.mp4' }, duration: 30, subtitles,
});
const mount = async (subtitles) => {
  const box = document.createElement('div');
  document.body.appendChild(box);
  const player = await createHtml5Player(box, video(subtitles), { autoplay: false });
  return { box, player, cc: box.querySelector('.ytp-cc-btn'), menu: document.body.querySelector('.ytp-settings-overlay'), gear: box.querySelector('.ytp-gear-btn') };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('no subtitle tracks: hide the CC icon and omit subtitles from Settings', async () => {
  const { box, player, cc, menu, gear } = await mount([]);
  try {
    assert.ok(cc);
    assert.equal(cc.hidden, true);
    assert.equal(player.hasSubtitles(), false);
    assert.equal(box.querySelector('.ytp-settings-overlay'), null, 'the settings sheet is portalled outside the player');
    gear.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.doesNotMatch(menu.textContent, /Subtitles\/CC/);
  } finally { player.destroy(); box.remove(); }
});

test('an unavailable subtitle file does not leave a dead CC icon', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const { box, player, cc } = await mount([{ url: '/missing.vtt', lang: 'en', label: 'English' }]);
  try {
    await settle();
    assert.equal(player.hasSubtitles(), false);
    assert.equal(cc.hidden, true);
  } finally { player.destroy(); box.remove(); globalThis.fetch = previousFetch; }
});

test('a loaded subtitle track reveals the CC icon and Settings entry', async () => {
  const previousFetch = globalThis.fetch;
  let resolveFetch;
  globalThis.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  const { box, player, cc, menu, gear } = await mount([{ url: '/english.vtt', lang: 'en', label: 'English' }]);
  try {
    assert.equal(cc.hidden, true, 'the icon stays hidden while the subtitle fetch is pending');
    resolveFetch({ ok: true, text: async () => 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello' });
    await settle();
    assert.equal(player.hasSubtitles(), true);
    assert.equal(cc.hidden, false);
    gear.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.match(menu.textContent, /Subtitles\/CC/);
    menu.querySelector('[data-nav="subs"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.match(menu.textContent, /English/);
  } finally { player.destroy(); box.remove(); globalThis.fetch = previousFetch; }
});
