// Unit tests for createPlayer() autoplay: request sound first (muted on iOS, where WebKit refuses an unmuted
// start), honor explicit mute, and never unmute on a timer.
// Browser autoplay policy may reject sound; HTML5/YouTube adapters can then retry muted and expose a tap-for-sound hint.
// Run: node --test test/frontend/player-logic.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';

register(new URL('./mock-loader.mjs', import.meta.url));
const { createPlayer } = await import('../../app/js/players/index.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const container = { innerHTML: '' };
const BLOCK_AT = 3300;

function setActivation(active) {
  try { Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: active }, configurable: true }); }
  catch { /* environment without a settable navigator */ }
  return typeof navigator.userActivation?.hasBeenActive === 'boolean';
}

beforeEach(() => {
  globalThis.__ytScenario = null; globalThis.__html5Scenario = null;
  globalThis.__muted = false; globalThis.__createdMuted = false; globalThis.__unmuted = false;
  setActivation(true);
});

test('YouTube autoplay requests sound first and never automatically unmutes later', async () => {
  globalThis.__ytScenario = { bufferingAfterMs: 10, playAfterMs: 40 };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  assert.equal(globalThis.__createdMuted, false, 'not force-muted for autoplay');
  await wait(3600); // long enough to catch the former delayed-unmute schedule
  assert.equal(globalThis.__muted, false, 'successful sound-first playback stays audible');
  assert.equal(globalThis.__unmuted, false, 'no timer calls unmute()');
  assert.equal(mutedCb, 0, 'no tap-for-sound hint when sound is already on');
  assert.equal(blockedCb, 0, 'playback started');
  ctl.destroy();
});

const iPhoneUA = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  platform: 'iPhone', maxTouchPoints: 5,
};
const withIphone = (extraWindow = {}) => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const listeners = {};
  Object.defineProperty(globalThis, 'navigator', { value: iPhoneUA, configurable: true });
  globalThis.window = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((x) => x !== fn); },
    ...extraWindow,
  };
  return {
    listeners,
    restore() {
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete globalThis.navigator;
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else delete globalThis.window;
    },
  };
};

test('iPhone browser starts autoplay muted, because WebKit refuses an unmuted first play', async () => {
  /* WebKit judges autoplay at the moment play() runs and never reconsiders, so the delayed
   * mute-then-retry that works on Android leaves the video dead on iOS: it has to start muted. */
  const env = withIphone();
  try {
    globalThis.__ytScenario = { bufferingAfterMs: 10, playAfterMs: 40 };
    let mutedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'iphone-web' } }, {
      autoplay: true, onAutoplayMuted: () => mutedCb++,
    });
    assert.equal(globalThis.__createdMuted, true, 'the only start WebKit grants is a muted one');
    await wait(150);
    assert.equal(globalThis.__muted, true, 'the video plays muted rather than not at all');
    assert.equal(globalThis.__unmuted, false, 'no timer-based unmute');
    assert.equal(mutedCb, 1, 'the viewer is offered the tap-for-sound control');
    assert.equal((env.listeners.pointerdown || []).length + (env.listeners.touchstart || []).length, 0, 'iOS uses explicit sound controls');
    ctl.destroy();
  } finally { env.restore(); }
});

test('iPhone native app also starts muted; explicit sound controls still work', async () => {
  const env = withIphone({ Capacitor: { isNativePlatform: () => true } });
  try {
    globalThis.__ytScenario = { bufferingAfterMs: 10, playAfterMs: 40 };
    let mutedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'iphone-app' } }, {
      autoplay: true, onAutoplayMuted: () => mutedCb++,
    });
    assert.equal(globalThis.__createdMuted, true);
    await wait(150);
    assert.equal(globalThis.__muted, true);
    assert.equal(mutedCb, 1);
    ctl.mute(); ctl.unmute();
    assert.equal(globalThis.__muted, false, 'explicit sound controls remain available');
    ctl.destroy();
  } finally { env.restore(); }
});

test('an embed that cannot report its state is never declared autoplay-blocked', async () => {
  /* The API-less fallback iframe may stay silent. Without a state reading, "blocked" would be a guess,
   * and a guessed block covers a playing video with a "Tap to Play" pill. */
  globalThis.__ytScenario = { engine: 'iframe', unknownState: true, bufferingAfterMs: 10, playAfterMs: 40 };
  let blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'opaque-embed' } }, {
    autoplay: true, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(3600);
  assert.equal(blockedCb, 0, 'a silent embed cannot prove it was refused');
  ctl.destroy();
});

test('slow startup is not treated as blocked and does not trigger any delayed sound change', async () => {
  globalThis.__ytScenario = { bufferingAfterMs: 100, playAfterMs: 900 };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'slow' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  assert.equal(globalThis.__createdMuted, false);
  await wait(1200);
  assert.equal(blockedCb, 0, 'buffering/playback counts as an accepted autoplay');
  assert.equal(globalThis.__muted, false);
  assert.equal(globalThis.__unmuted, false, 'the sound state is not changed after startup');
  assert.equal(mutedCb, 0);
  ctl.destroy();
});

test('if even muted playback is refused, report onAutoplayBlocked exactly once and no mute prompt', async () => {
  globalThis.__ytScenario = { autoplayBlocked: true };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'blocked' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(BLOCK_AT + 100);
  assert.equal(blockedCb, 1, 'the page can show its big play button');
  assert.equal(mutedCb, 0, 'there is no running muted video to unmute');
  ctl.destroy();
});

test('a fresh page without user activation still requests unmuted playback first', async () => {
  const stubbed = setActivation(false);
  globalThis.__ytScenario = { playAfterMs: 30 };
  try {
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'deep-link' } }, { autoplay: true });
    assert.equal(globalThis.__createdMuted, false, 'initial request is not tied to a pre-existing page gesture');
    await wait(100);
    assert.equal(globalThis.__muted, false);
    assert.equal(globalThis.__unmuted, false, 'no delayed unmute is needed');
    ctl.destroy();
  } finally { if (stubbed) setActivation(true); }
});

test('explicit mute stays muted until a deliberate non-iOS gesture enables sound', async () => {
  const listeners = {};
  const prevWin = globalThis.window;
  globalThis.window = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((x) => x !== fn); },
  };
  const fireGesture = () => Object.values(listeners).flat().slice().forEach((fn) => fn({ type: 'pointerdown' }));
  try {
    globalThis.__ytScenario = { playAfterMs: 30 };
    let mutedCb = 0, unmutedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'muted' } }, {
      autoplay: true, muted: true, onAutoplayMuted: () => mutedCb++, onGestureUnmuted: () => unmutedCb++,
    });
    assert.equal(globalThis.__createdMuted, true, 'explicit mute is honored');
    await wait(100);
    assert.equal(globalThis.__muted, true, 'no automatic unmute');
    assert.equal(globalThis.__unmuted, false);
    assert.ok((listeners.pointerdown || []).length > 0, 'the existing gesture fallback is armed');
    fireGesture();
    assert.equal(globalThis.__unmuted, true, 'sound changes only after the gesture');
    assert.equal(unmutedCb, 1);
    assert.equal(mutedCb, 0, 'an intentional muted mode is not an autoplay fallback');
    ctl.destroy();
  } finally {
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
  }
});

test('autoplay false does not force mute or register autoplay listeners', async () => {
  const listeners = {};
  const prevWin = globalThis.window;
  globalThis.window = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((x) => x !== fn); },
  };
  try {
    let mutedCb = 0, blockedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'manual' } }, {
      autoplay: false, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
    });
    assert.equal(globalThis.__createdMuted, false);
    await wait(100);
    assert.equal(globalThis.__unmuted, false);
    assert.equal(mutedCb, 0);
    assert.equal(blockedCb, 0, 'manual play is not counted as an autoplay block');
    assert.equal((listeners.pointerdown || []).length + (listeners.touchstart || []).length, 0, 'no gesture listener when autoplay is off');
    ctl.destroy();
  } finally {
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
  }
});

test('HTML5 playback requests sound first; a browser refusal retries muted and stays muted', async () => {
  globalThis.__html5Scenario = { reject: 'autoplay', playsAfterMs: 20 };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'mp4', url: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  assert.equal(globalThis.__createdMuted, false, 'first attempt is unmuted');
  await wait(3500);
  assert.equal(globalThis.__muted, true, 'muted retry remains muted');
  assert.equal(globalThis.__unmuted, false, 'no delayed automatic unmute');
  assert.equal(mutedCb, 1, 'offer a user-controlled sound action after the muted retry starts');
  assert.equal(blockedCb, 0, 'muted retry played successfully');
  ctl.destroy();
});

test('HTML5 media error is not treated as autoplay refusal', async () => {
  globalThis.__html5Scenario = { reject: 'media' };
  let mutedCb = 0, blockedCb = 0, errorCode = null;
  const ctl = await createPlayer(container, { source: { type: 'mp4', url: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
    onState: (s, code) => { if (s === 'error') errorCode = code; },
  });
  await wait(BLOCK_AT + 100);
  assert.equal(blockedCb, 0, 'a broken file is not an autoplay policy block');
  assert.equal(mutedCb, 0, 'a broken file does not show a sound prompt');
  assert.equal(errorCode, 4, 'the media error remains visible to the page');
  ctl.destroy();
});
