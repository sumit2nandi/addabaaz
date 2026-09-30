// Unit tests for the createPlayer() autoplay fallback logic (app/js/players/index.js).
// These guard the "videos start muted on mobile" regression: the mute fallback must fire ONLY when the
// browser genuinely refused sound autoplay — never when the video is merely slow to load.
//
// Run:  node --test test/frontend/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';

register(new URL('./mock-loader.mjs', import.meta.url));
const { createPlayer } = await import('../../app/js/players/index.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const container = { innerHTML: '' };

function setActivation(active) {
  try { Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: active }, configurable: true }); }
  catch { /* environment without a settable navigator: skip activation-dependent assumptions */ }
  return typeof navigator.userActivation?.hasBeenActive === 'boolean';
}

beforeEach(() => {
  globalThis.__ytScenario = null; globalThis.__html5Scenario = null; globalThis.__muted = false; globalThis.__createdMuted = false; globalThis.__unmuted = false;
  setActivation(true);   // default: the user HAS interacted with the page
});

test('youtube: slow buffering (4.5s) must NOT be force-muted — sound autoplay keeps working', async () => {
  globalThis.__ytScenario = { startState: 5, delayToPlayMs: 4500, playsWithSound: true };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(6000);
  assert.equal(mutedCb, 0, 'onAutoplayMuted must not fire for a slow (but allowed) start');
  assert.equal(blockedCb, 0);
  assert.equal(globalThis.__muted, false, 'the video must not be muted');
  ctl.destroy();
});

test('youtube: blocked sound autoplay → muted fallback after ~5s, muted playback starts (no "blocked" error)', async () => {
  globalThis.__ytScenario = { startState: 5, delayToPlayMs: null, playsWithSound: false, mutedPlays: true };
  let mutedCb = 0, blockedCb = 0;
  const t0 = Date.now(); let mutedAt = -1;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true,
    onAutoplayMuted: () => { mutedCb++; mutedAt = Date.now() - t0; },
    onAutoplayBlocked: () => blockedCb++,
  });
  await wait(8000);
  assert.equal(mutedCb, 1, 'onAutoplayMuted must fire exactly once');
  assert.ok(mutedAt >= 4500 && mutedAt <= 6000, `fallback should land ~5s (got ${mutedAt}ms)`);
  assert.equal(blockedCb, 0, 'muted playback succeeded → no blocked callback');
  assert.equal(globalThis.__muted, true, 'the video now runs muted (tap-to-unmute affordance shown by the page)');
  ctl.destroy();
});

test('youtube: muted playback also blocked (Low Power Mode) → onAutoplayBlocked, page shows play button', async () => {
  globalThis.__ytScenario = { startState: 5, delayToPlayMs: null, playsWithSound: false, mutedPlays: false };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(8000);
  assert.equal(mutedCb, 1);
  assert.equal(blockedCb, 1, 'page gets onAutoplayBlocked so it can show the big play button');
  ctl.destroy();
});

test('youtube on a touch device before ANY page gesture: muted-autoplay build at once — no seconds of dead wait', async () => {
  const prevMM = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    setActivation(false);   // fresh page load / deep link: no interaction yet on this page
    // The embed autoplays by itself once it may (muted is always allowed) — modelled by the delayed play.
    globalThis.__ytScenario = { startState: 5, delayToPlayMs: 300, playsWithSound: true };
    let mutedCb = 0, blockedCb = 0; const t0 = Date.now(); let mutedAt = -1;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
      autoplay: true,
      onAutoplayMuted: () => { mutedCb++; mutedAt = Date.now() - t0; },
      onAutoplayBlocked: () => blockedCb++,
    });
    assert.equal(mutedCb, 1, 'the page is told once to show its tap-for-sound affordance');
    assert.ok(mutedAt >= 0 && mutedAt < 300, `muted start is announced immediately (got ${mutedAt}ms), not after a multi-second sound-first attempt`);
    assert.equal(globalThis.__createdMuted, true, 'the player itself is built muted (autoplay=1&mute=1) — nothing to discover or poll for');
    await wait(4000);
    assert.equal(blockedCb, 0, 'the muted embed played: no blocked callback');
    ctl.destroy();
  } finally { if (prevMM === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prevMM; }
});

test('youtube on a touch device: even muted playback refused (Low Power Mode) → blocked callback for the tap-to-play affordance', async () => {
  const prevMM = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    setActivation(false);
    globalThis.__ytScenario = { startState: 5, delayToPlayMs: null, playsWithSound: false, mutedPlays: false };
    let mutedCb = 0, blockedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
      autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
    });
    assert.equal(mutedCb, 1);
    await wait(5000);
    assert.equal(blockedCb, 1, 'a totally blocked device still gets the blocked signal so the page can offer one tap');
    ctl.destroy();
  } finally { if (prevMM === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prevMM; }
});

test('youtube on a touch device AFTER a page gesture (normal in-app open): sound-first, never muted when allowed', async () => {
  const prevMM = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    // default activation (beforeEach) is TRUE: the tap that opened this video already activated the page,
    // so browsers grant sound playback now — we must build the player UNMUTED and let it play.
    globalThis.__ytScenario = { startState: 5, delayToPlayMs: 400, playsWithSound: true };
    let mutedCb = 0, blockedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
      autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
    });
    assert.equal(globalThis.__createdMuted, false, 'post-gesture phone plays build sound-first — audio starts immediately');
    await wait(4000);
    assert.equal(mutedCb, 0, 'sound autoplay succeeded → no mute fallback, no pill');
    assert.equal(blockedCb, 0);
    assert.equal(globalThis.__muted, false);
    ctl.destroy();
  } finally { if (prevMM === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prevMM; }
});

test('youtube on a touch device: the FIRST gesture anywhere unmutes a muted-started player (sound policy satisfied)', async () => {
  const prevMM = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  // Minimal window stand-in capturing the adapter's gesture listeners.
  const listeners = {};
  const prevWin = globalThis.window;
  globalThis.window = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((x) => x !== fn); },
  };
  const fireGesture = () => Object.values(listeners).flat().slice().forEach((fn) => fn({ type: 'pointerdown' }));
  try {
    setActivation(false);
    globalThis.__ytScenario = { startState: 5, delayToPlayMs: 300, playsWithSound: true };   // embed autoplays (muted)
    let mutedCb = 0, unmutedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
      autoplay: true,
      onAutoplayMuted: () => mutedCb++,
      onGestureUnmuted: () => unmutedCb++,
    });
    assert.equal(mutedCb, 1, 'started muted (pre-gesture instant path)');
    assert.ok((listeners.pointerdown || []).length > 0, 'a first-gesture listener is armed');
    await wait(800);                                  // muted playback underway
    fireGesture();                                    // viewer taps/scrolls anywhere
    assert.equal(unmutedCb, 1, 'the page is told sound switched on so it can hide the pill');
    assert.equal(globalThis.__unmuted, true, 'player.unMute() ran inside the gesture');
    assert.ok((listeners.pointerdown || []).length === 0, 'the listener disarms after one gesture');
    ctl.destroy();
  } finally {
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
    if (prevMM === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prevMM;
  }
});

test('youtube: no user gesture yet (deep link/reload) → instant muted start, no 5s dead time', async () => {
  const stubbed = setActivation(false);
  globalThis.__ytScenario = { startState: 5, delayToPlayMs: null, playsWithSound: false, mutedPlays: true };
  let mutedCb = 0; const t0 = Date.now(); let mutedAt = -1;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => { mutedCb++; mutedAt = Date.now() - t0; },
  });
  await wait(500);
  if (stubbed) {
    assert.equal(mutedCb, 1, 'onAutoplayMuted must fire immediately when activation is impossible');
    assert.ok(mutedAt < 200, `fallback should be near-instant (got ${mutedAt}ms)`);
  }
  ctl.destroy();
});

test('youtube: sound autoplay starts quickly → nothing is muted', async () => {
  globalThis.__ytScenario = { startState: 5, delayToPlayMs: 300, playsWithSound: true };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(1500);
  assert.equal(mutedCb, 0);
  assert.equal(blockedCb, 0);
  assert.equal(globalThis.__muted, false);
  ctl.destroy();
});

test('html5: play() rejected with NotAllowedError → muted fallback', async () => {
  globalThis.__html5Scenario = { reject: 'autoplay' };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'mp4', url: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(600);
  assert.equal(mutedCb, 1, 'onAutoplayMuted must fire on a genuine autoplay rejection');
  assert.equal(blockedCb, 0, 'muted retry plays fine');
  ctl.destroy();
});

test('html5: play() resolves → no fallback, video keeps sound', async () => {
  globalThis.__html5Scenario = { reject: null, playsAfterMs: 150 };
  let mutedCb = 0, blockedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'mp4', url: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
  });
  await wait(1500);
  assert.equal(mutedCb, 0);
  assert.equal(blockedCb, 0);
  assert.equal(globalThis.__muted, false);
  ctl.destroy();
});

test('html5: media error (NotSupportedError) must NOT trigger the mute fallback', async () => {
  globalThis.__html5Scenario = { reject: 'media' };
  let mutedCb = 0, errorCode = null;
  const ctl = await createPlayer(container, { source: { type: 'mp4', url: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++, onState: (s, code) => { if (s === 'error') errorCode = code; },
  });
  await wait(7500); // past the 6.6s safety net: a broken file must not get "recovered" by muting
  assert.equal(mutedCb, 0, 'a broken media file is not an autoplay block — the error event is the only signal');
  assert.equal(errorCode, 4, 'the media error must still reach the page');
  ctl.destroy();
});
