// Unit tests for the createPlayer() autoplay logic (app/js/players/index.js).
// The strategy under test is the main branch's: every autoplaying player is BUILT muted
// (autoplay=1&mute=1 → motion starts instantly on every phone) and the mute is then lifted on
// main's 600/1500/3000ms schedule so playback comes up with VOLUME — no gesture required, no
// multi-second sound-first wait, and no "blocked" signal for a merely slow load.
//
// Run:  node --test test/frontend/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';

register(new URL('./mock-loader.mjs', import.meta.url));
const { createPlayer } = await import('../../app/js/players/index.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const container = { innerHTML: '' };
// createPlayer()'s block/pill windows: block check at 2200*1.5ms, "still muted" check 600ms after the last lift.
const BLOCK_AT = 3300, PILL_AT = 3900;

function setActivation(active) {
  try { Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: active }, configurable: true }); }
  catch { /* environment without a settable navigator */ }
  return typeof navigator.userActivation?.hasBeenActive === 'boolean';
}

beforeEach(() => {
  globalThis.__ytScenario = null; globalThis.__html5Scenario = null; globalThis.__muted = false; globalThis.__createdMuted = false; globalThis.__unmuted = false;
  setActivation(true);   // default: the user HAS interacted with the page
});

test('autoplay builds the player MUTED (instant start) and the lifts give volume with NO gesture', async () => {
  globalThis.__ytScenario = { playAfterMs: 400 };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  assert.equal(globalThis.__createdMuted, true, 'built muted like main autoplay=1&mute=1 → starts playing instantly everywhere');
  await wait(800);   // first lift lands at 600ms
  assert.equal(globalThis.__unmuted, true, 'the 600ms lift unmuted the player without any user gesture (main\'s schedule)');
  assert.equal(globalThis.__muted, false, 'volume is on');
  await wait(PILL_AT - 800 + 300);
  assert.equal(mutedCb, 0, 'no "tap for sound" pill: the lift gave sound');
  assert.equal(blockedCb, 0, 'playback started → no blocked signal');
  ctl.destroy();
});

test('slow playback (starts playing at 4.5s) is NOT mistaken for a block', async () => {
  globalThis.__ytScenario = { bufferingAfterMs: 100, playAfterMs: 4500 };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(BLOCK_AT + 400);   // buffering already happened → the block check must pass
  assert.equal(blockedCb, 0, 'a buffering player is not blocked');
  await wait(1500);
  assert.equal(blockedCb, 0, 'still not blocked once it reaches playing');
  assert.equal(mutedCb, 0, 'and it was never force-muted');
  assert.equal(globalThis.__muted, false, 'volume via the lifts');
  ctl.destroy();
});

test('muted playback also refused (Low Power Mode) → onAutoplayBlocked once, no misleading mute pill', async () => {
  globalThis.__ytScenario = { autoplayBlocked: true };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(BLOCK_AT + 500);
  assert.equal(blockedCb, 1, 'the page gets onAutoplayBlocked so it can show the big play button');
  await wait(5000);
  assert.equal(blockedCb, 1, 'exactly once');
  assert.equal(mutedCb, 0, 'the player is not playing at all — the play affordance, not the unmute pill, is the right offer');
  ctl.destroy();
});

test('fresh page load (no user activation at all): still instant + lifts still run — activation no longer gates anything', async () => {
  const stubbed = setActivation(false);   // deep link / reload: no gesture yet on this page
  globalThis.__ytScenario = { playAfterMs: 400 };
  let mutedCb = 0;
  try {
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
      autoplay: true, onAutoplayMuted: () => mutedCb++,
    });
    assert.equal(globalThis.__createdMuted, true, 'instant muted build');
    await wait(800);
    if (stubbed) assert.equal(globalThis.__unmuted, true, 'the lift runs even before any gesture (main unmutes on a timer)');
    await wait(PILL_AT);
    assert.equal(mutedCb, 0, 'mock reports unmuted after the lifts → no pill');
    ctl.destroy();
  } finally { setActivation(true); }
});

test('a page-muted build (viewer chose silence) gets NO lifts and no pill — but the first gesture still unmutes', async () => {
  const listeners = {};
  const prevWin = globalThis.window;
  globalThis.window = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((x) => x !== fn); },
  };
  const fireGesture = () => Object.values(listeners).flat().slice().forEach((fn) => fn({ type: 'pointerdown' }));
  try {
    globalThis.__ytScenario = { playAfterMs: 400 };
    let mutedCb = 0, unmutedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
      autoplay: true, muted: true, onAutoplayMuted: () => mutedCb++, onGestureUnmuted: () => unmutedCb++,
    });
    assert.equal(globalThis.__createdMuted, true, 'explicit-muted builds are muted too');
    await wait(1000);   // past the 600ms lift — it must NOT have run
    assert.equal(globalThis.__unmuted, false, 'no unmute lift when the page asked for silence');
    assert.equal(globalThis.__muted, true, 'still muted');
    assert.ok((listeners.pointerdown || []).length > 0, 'the first-gesture unmute safety net is armed');
    fireGesture();
    assert.equal(unmutedCb, 1, 'the page is told sound switched on');
    assert.equal(globalThis.__unmuted, true, 'gesture unmute ran');
    assert.equal(mutedCb, 0, 'the viewer\'s own mute choice never shows a pill');
    await wait(PILL_AT);
    assert.equal(mutedCb, 0, 'and the pill check stays quiet for page-muted builds');
    ctl.destroy();
  } finally {
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
  }
});

test('a viewer mute during the lift window cancels the remaining lifts — their choice sticks', async () => {
  globalThis.__ytScenario = { playAfterMs: 400 };
  let mutedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++,
  });
  await wait(800);                 // first lift already gave sound
  assert.equal(globalThis.__unmuted, true, 'lifted');
  ctl.mute();                      // the reels sound button (or any page-driven mute)
  assert.equal(globalThis.__muted, true, 'muted on request');
  await wait(PILL_AT);             // past the 1500/3000ms lifts and the pill check
  assert.equal(globalThis.__muted, true, 'no later lift un-mutes the viewer\'s explicit choice');
  assert.equal(mutedCb, 0, 'and no misleading "tap for sound" pill');
  ctl.destroy();
});

test('autoplay: false → no lifts, no gesture listeners, no block signal', async () => {
  const listeners = {};
  const prevWin = globalThis.window;
  globalThis.window = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((x) => x !== fn); },
  };
  try {
    let mutedCb = 0, blockedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
      autoplay: false, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
    });
    assert.equal(globalThis.__createdMuted, false, 'viewer asked for no autoplay: built as requested, not force-muted');
    await wait(BLOCK_AT + 700);
    assert.equal(globalThis.__unmuted, false, 'no lifts');
    assert.equal(mutedCb, 0);
    assert.equal(blockedCb, 0, 'nothing to block — the viewer presses play themselves');
    assert.equal((listeners.pointerdown || []).length + (listeners.touchstart || []).length, 0, 'no gesture listener');
    ctl.destroy();
  } finally {
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
  }
});

test('html5: built muted → plays instantly, the lift turns the volume on, nothing is blocked', async () => {
  globalThis.__html5Scenario = { reject: null, playsAfterMs: 80 };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'mp4', url: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  assert.equal(globalThis.__createdMuted, true, 'mp4/hls also start muted for instant motion');
  await wait(1200);
  assert.equal(globalThis.__unmuted, true, 'lifted to volume');
  assert.equal(globalThis.__muted, false);
  await wait(PILL_AT - 1200 + 200);
  assert.equal(mutedCb, 0);
  assert.equal(blockedCb, 0, 'it played');
  ctl.destroy();
});

test('html5: play() rejected outright (NotAllowedError) → onAutoplayBlocked for the tap-to-play affordance', async () => {
  globalThis.__html5Scenario = { reject: 'autoplay' };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'mp4', url: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(BLOCK_AT + 500);
  assert.equal(blockedCb, 1, 'the genuine rejection reaches the page as a block');
  assert.equal(mutedCb, 0, 'not as a mute pill');
  ctl.destroy();
});

test('html5: media error (NotSupportedError) must NOT be treated as an autoplay block', async () => {
  globalThis.__html5Scenario = { reject: 'media' };
  let mutedCb = 0, blockedCb = 0, errorCode = null;
  const ctl = await createPlayer(container, { source: { type: 'mp4', url: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
    onState: (s, code) => { if (s === 'error') errorCode = code; },
  });
  await wait(7500); // well past the block window
  assert.equal(blockedCb, 0, 'a broken file is not an autoplay block — the error event is the only signal');
  assert.equal(mutedCb, 0, 'and it is never "recovered" by muting');
  assert.equal(errorCode, 4, 'the media error still reaches the page');
  ctl.destroy();
});
