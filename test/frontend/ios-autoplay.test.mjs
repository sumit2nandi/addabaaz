// iOS/WebKit autoplay depends on an explicit muted, inline HTMLVideoElement and a muted YouTube iframe start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHtml5Player } from '../../app/js/players/html5.js';
import { createYouTubePlayer } from '../../app/js/players/youtube.js';

const saveGlobals = (names) => {
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
};

test('HTML5 autoplay marks the video muted and inline before assigning its source', async () => {
  const restore = saveGlobals(['document', 'navigator', 'window', 'localStorage']);
  const attributes = new Map();
  const element = {
    textTracks: { length: 0, addEventListener() {} },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener() {},
    canPlayType() { return 'probably'; },
    appendChild() {}, pause() {}, load() {}, play() { return Promise.resolve(); },
  };
  const container = { innerHTML: '', appendChild() {} };
  globalThis.document = { createElement(tag) { assert.equal(tag, 'video'); return element; } };
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  globalThis.window = {};
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
  try {
    const ctl = await createHtml5Player(container, { source: { type: 'mp4', url: '/video.mp4' } }, { autoplay: true, muted: true });
    assert.equal(element.defaultMuted, true);
    assert.equal(element.muted, true);
    assert.equal(element.playsInline, true);
    assert.equal(element.autoplay, true);
    for (const name of ['muted', 'playsinline', 'webkit-playsinline', 'autoplay']) assert.ok(attributes.has(name), `${name} attribute is present`);
    ctl.destroy();
  } finally { restore(); }
});

test('YouTube autoplay explicitly mutes the iOS iframe before asking it to play inline', async () => {
  const restore = saveGlobals(['document', 'location', 'window']);
  const actions = [];
  let config;
  class FakePlayer {
    constructor(_mount, options) {
      config = options;
      setTimeout(() => options.events.onReady({ target: this }), 0);
    }
    mute() { actions.push('mute'); }
    playVideo() { actions.push('play'); }
    getCurrentTime() { return 0; }
    getDuration() { return 0; }
    destroy() {}
  }
  globalThis.document = { createElement() { return {}; } };
  globalThis.location = { protocol: 'https:', origin: 'https://addabaaz.example' };
  globalThis.window = { YT: { Player: FakePlayer, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 } } };
  try {
    const container = { innerHTML: '', appendChild() {} };
    const ctl = await createYouTubePlayer(container, 'test-video', { autoplay: true, muted: true, controls: false });
    assert.equal(config.playerVars.autoplay, 1);
    assert.equal(config.playerVars.mute, 1);
    assert.equal(config.playerVars.playsinline, 1);
    assert.deepEqual(actions, ['mute', 'play']);
    ctl.destroy();
  } finally { restore(); }
});
