// iOS/WebKit may reject unmuted autoplay; adapters should try sound first and fall back to muted inline playback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
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
    assert.equal(element.preload, 'auto', 'active playback asks for media bytes immediately');
    for (const name of ['muted', 'playsinline', 'webkit-playsinline', 'autoplay']) assert.ok(attributes.has(name), `${name} attribute is present`);
    ctl.destroy();
  } finally { restore(); }
});

test('HTML5 retries autoplay muted when iOS rejects the first unmuted play attempt', async () => {
  const restore = saveGlobals(['document', 'navigator', 'window', 'localStorage']);
  const attributes = new Map();
  const playModes = [];
  const element = {
    textTracks: { length: 0, addEventListener() {} },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener() {},
    canPlayType() { return 'probably'; },
    appendChild() {}, pause() {}, load() {},
    play() {
      playModes.push(this.muted);
      if (playModes.length === 1) {
        const err = new Error('autoplay requires a gesture'); err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      return Promise.resolve();
    },
  };
  const container = { innerHTML: '', appendChild() {} };
  globalThis.document = { createElement(tag) { assert.equal(tag, 'video'); return element; } };
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  globalThis.window = {};
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
  try {
    const ctl = await createHtml5Player(container, { source: { type: 'mp4', url: '/video.mp4' } }, { autoplay: true, muted: false });
    assert.deepEqual(playModes, [false, true], 'sound-first attempt is followed by muted autoplay');
    assert.equal(element.defaultMuted, true);
    assert.equal(element.muted, true);
    assert.ok(attributes.has('muted'), 'muted attribute is applied before the retry');
    await ctl.playPromise;
    ctl.destroy();
  } finally { restore(); }
});

test('HTML5 returns the player without waiting for a slow subtitle request', async () => {
  const restore = saveGlobals(['document', 'navigator', 'window', 'localStorage', 'fetch']);
  let playCalled = false;
  const element = {
    textTracks: { length: 0, addEventListener() {} },
    setAttribute() {}, removeAttribute() {}, addEventListener() {},
    canPlayType() { return 'probably'; }, appendChild() {}, pause() {}, load() {},
    play() { playCalled = true; return Promise.resolve(); },
  };
  const container = { innerHTML: '', appendChild() {} };
  globalThis.document = { createElement() { return element; } };
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  globalThis.window = {};
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
  globalThis.fetch = () => new Promise(() => {}); // subtitle server never responds
  try {
    const result = await Promise.race([
      createHtml5Player(container, {
        source: { type: 'mp4', url: '/video.mp4' },
        subtitles: [{ url: '/slow.vtt', label: 'English', lang: 'en' }],
      }, { autoplay: true, muted: true }).then((ctl) => ({ ctl })),
      new Promise((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    assert.ok(result?.ctl, 'player setup completes while subtitles continue in the background');
    assert.equal(playCalled, true, 'video play is requested without waiting for the subtitle response');
    result.ctl.destroy();
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
    assert.equal(config.playerVars.controls, 0);
    assert.equal(config.playerVars.disablekb, 1);
    assert.deepEqual(actions, ['mute'], 'chromeless Reels avoid an initial playVideo() postMessage that wakes YouTube’s pause overlay');
    ctl.destroy();
  } finally { restore(); }
});

test('YouTube iframe fallback honors the requested sound-first mode when the API script fails', async () => {
  const restore = saveGlobals(['document', 'location', 'window']);
  globalThis.document = {
    createElement() { return { appendChild() {} }; },
    head: { appendChild(script) { setTimeout(() => script.onerror?.(), 0); } },
  };
  globalThis.location = { protocol: 'https:', origin: 'https://addabaaz.example' };
  globalThis.window = {};
  try {
    const container = { innerHTML: '', appendChild() {}, querySelector() { return null; } };
    const ctl = await createYouTubePlayer(container, 'test-video', { autoplay: true, muted: false, controls: true });
    assert.equal(ctl.engine, 'iframe', 'slow/blocked API does not hold the video behind its 8-second timeout');
    assert.match(container.innerHTML, /autoplay=1/);
    assert.match(container.innerHTML, /mute=0/, 'fallback does not force the viewer into muted autoplay');
    assert.match(container.innerHTML, /playsinline=1/);
    assert.match(container.innerHTML, /controls=1/, 'the fallback keeps YouTube controls available');
    assert.match(container.innerHTML, /fs=1/, 'the fallback keeps YouTube fullscreen enabled');
    assert.match(container.innerHTML, /allowfullscreen/, 'the fallback iframe is permitted to enter fullscreen');
    ctl.destroy();
  } finally { restore(); }
});

test('YouTube does not wait for the API network timeout before using its iframe fallback', async () => {
  const restore = saveGlobals(['document', 'location', 'window', 'setTimeout', 'clearTimeout']);
  const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
  const stalledApiTimeout = { stalledApiTimeout: true };
  globalThis.setTimeout = (fn, ms, ...args) => ms === 1500
    ? realSetTimeout(fn, 0, ...args)
    : ms === 8000 ? stalledApiTimeout : realSetTimeout(fn, ms, ...args);
  globalThis.clearTimeout = (timer) => { if (timer !== stalledApiTimeout) realClearTimeout(timer); };
  globalThis.document = { createElement() { return {}; }, head: { appendChild() {} } };
  globalThis.location = { protocol: 'https:', origin: 'https://addabaaz.example' };
  globalThis.window = {};
  try {
    const container = { innerHTML: '', appendChild() {}, querySelector() { return null; } };
    const ctl = await createYouTubePlayer(container, 'slow-api-video', { autoplay: true, muted: false, controls: false });
    assert.equal(ctl.engine, 'iframe', 'the playback budget expires while the API script request is still pending');
    assert.match(container.innerHTML, /mute=0/, 'fallback honors the requested unmuted mode when the API is still loading');
    ctl.destroy();
  } finally { restore(); }
});

test('YouTube retries blocked unmuted autoplay muted', async () => {
  const restore = saveGlobals(['document', 'location', 'window']);
  const actions = [];
  let config;
  let muted = false;
  class FakePlayer {
    constructor(_mount, options) {
      config = options;
      setTimeout(() => options.events.onReady({ target: this }), 0);
    }
    mute() { muted = true; actions.push('mute'); }
    playVideo() { actions.push('play'); }
    isMuted() { return muted; }
    getCurrentTime() { return 0; }
    getDuration() { return 0; }
    getPlayerState() { return -1; }
    destroy() {}
  }
  globalThis.document = { createElement() { return {}; } };
  globalThis.location = { protocol: 'https:', origin: 'https://addabaaz.example' };
  globalThis.window = { YT: { Player: FakePlayer, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 } } };
  try {
    const container = { innerHTML: '', appendChild() {} };
    const ctl = await createYouTubePlayer(container, 'test-video', { autoplay: true, muted: false, controls: false });
    assert.equal(config.playerVars.autoplay, 1);
    assert.equal(config.playerVars.mute, 0, 'sound-first autoplay is requested');
    assert.deepEqual(actions, ['play']);
    config.events.onAutoplayBlocked();
    assert.deepEqual(actions, ['play', 'mute', 'play'], 'a blocked attempt is retried muted');
    config.events.onAutoplayBlocked();
    assert.deepEqual(actions, ['play', 'mute', 'play'], 'muted fallback is attempted only once');
    ctl.destroy();
  } finally { restore(); }
});

test('YouTube watchdog retries muted when iOS omits the blocked-autoplay event', async () => {
  const restore = saveGlobals(['document', 'location', 'window', 'setTimeout', 'clearTimeout']);
  const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
  const actions = [];
  let config, fallbackCheck;
  globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms === 1200) { fallbackCheck = fn; return { mutedFallbackTimer: true }; }
    return realSetTimeout(fn, ms, ...args);
  };
  globalThis.clearTimeout = (timer) => {
    if (timer?.mutedFallbackTimer) return;
    return realClearTimeout(timer);
  };
  class FakePlayer {
    constructor(_mount, options) {
      config = options;
      realSetTimeout(() => options.events.onReady({ target: this }), 0);
    }
    mute() { actions.push('mute'); }
    playVideo() { actions.push('play'); }
    getPlayerState() { return -1; }
    getCurrentTime() { return 0; }
    getDuration() { return 0; }
    destroy() {}
  }
  globalThis.document = { createElement() { return {}; } };
  globalThis.location = { protocol: 'https:', origin: 'https://addabaaz.example' };
  globalThis.window = { YT: { Player: FakePlayer, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 } } };
  try {
    const container = { innerHTML: '', appendChild() {} };
    const ctl = await createYouTubePlayer(container, 'iphone-video', { autoplay: true, muted: false, controls: false });
    assert.deepEqual(actions, ['play'], 'start with the requested sound-first attempt');
    assert.equal(typeof fallbackCheck, 'function', 'arm a watchdog after the player is ready');
    fallbackCheck(); // no onAutoplayBlocked callback; the player remains UNSTARTED
    assert.deepEqual(actions, ['play', 'mute', 'play'], 'retry inline playback muted instead of leaving the poster stuck');
    ctl.destroy();
  } finally { restore(); }
});

test('YouTube embeds keep native controls and offer app-owned settings for speed and loop', async () => {
  const restore = saveGlobals(['document', 'location', 'window']);
  const { document, window } = parseHTML('<!doctype html><html><head></head><body><div id="slot"></div></body></html>');
  const calls = [];
  let config, rate = 1, ended = 0;
  const PlayerState = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 };
  class FakePlayer {
    constructor(_mount, options) {
      config = options;
      this.options = options;
      setTimeout(() => options.events.onReady({ target: this }), 0);
    }
    getAvailablePlaybackRates() { return [0.5, 1, 1.5, 2]; }
    getPlaybackRate() { return rate; }
    setPlaybackRate(value) { rate = value; calls.push(['rate', value]); this.options.events.onPlaybackRateChange({ data: value }); }
    getPlayerState() { return PlayerState.PAUSED; }
    getCurrentTime() { return 0; }
    getDuration() { return 10; }
    seekTo(value) { calls.push(['seek', value]); }
    playVideo() { calls.push(['play']); }
    pauseVideo() {}
    mute() {}
    unMute() {}
    setVolume() {}
    isMuted() { return false; }
    destroy() {}
  }
  globalThis.document = document;
  globalThis.location = { protocol: 'https:', origin: 'https://addabaaz.example' };
  globalThis.window = { YT: { Player: FakePlayer, PlayerState } };
  try {
    const container = document.getElementById('slot');
    const ctl = await createYouTubePlayer(container, 'settings-video', {
      autoplay: false,
      controls: true,
      onEnded: () => ended++,
    });
    assert.equal(config.playerVars.controls, 1, 'YouTube built-in controls stay enabled for native quality and captions');
    assert.equal(config.playerVars.fs, 1, 'the native YouTube fullscreen option stays enabled');
    assert.equal(container.querySelector('.ytp-youtube-fullscreen-btn'), null, 'there is no extra app-owned maximize button');
    const launcher = container.querySelector('.ytp-youtube-settings-btn');
    assert.ok(launcher, 'the app-owned settings launcher is visible outside the YouTube iframe');
    launcher.click();
    const sheet = document.body.querySelector('.ytp-settings-overlay');
    assert.ok(sheet);
    assert.equal(container.contains(sheet), false, 'the settings sheet is portalled outside the embedded player');
    assert.match(sheet.querySelector('.ytp-settings-title').textContent, /^Settings$/, 'the full Settings title is displayed');
    assert.match(sheet.textContent, /Playback Speed/);
    assert.match(sheet.textContent, /Loop/);
    assert.match(sheet.textContent, /Tap the video to reveal YouTube’s controls for quality and subtitles/);
    sheet.querySelector('[data-nav="speed"]').click();
    assert.ok(sheet.querySelector('[data-speed="1.5"]'));
    sheet.querySelector('[data-speed="1.5"]').click();
    assert.deepEqual(calls[0], ['rate', 1.5], 'the sheet applies supported playback rates through the IFrame API');
    assert.equal(sheet.hidden, true);

    launcher.click();
    sheet.querySelector('[data-act="loop"]').click();
    assert.match(sheet.querySelector('.ytp-menu-pill').textContent, /On/);
    config.events.onStateChange({ data: PlayerState.ENDED });
    assert.deepEqual(calls.slice(1), [['seek', 0], ['play']], 'loop restarts the video without signalling the watch page as ended');
    assert.equal(ended, 0);
    sheet.querySelector('[data-settings-close]').click();
    assert.equal(sheet.hidden, true);
    assert.equal(document.body.classList.contains('player-settings-open'), false);
    ctl.destroy();
    assert.equal(document.body.querySelector('.ytp-settings-overlay'), null, 'destroy removes the portal');
  } finally { restore(); }
});
