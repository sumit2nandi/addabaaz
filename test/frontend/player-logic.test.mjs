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

const memStore = {};
globalThis.localStorage = {
  getItem: (k) => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: (k) => { delete memStore[k]; },
};

beforeEach(() => {
  globalThis.__ytScenario = null; globalThis.__html5Scenario = null; globalThis.__muted = false; globalThis.__createdMuted = false;
  Object.keys(memStore).forEach((k) => delete memStore[k]);
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

test('youtube on a touch device with a LEARNED sound refusal: player is built muted-autoplay at once — no seconds of dead wait', async () => {
  const prevMM = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    localStorage.setItem('addabaaz.autoplaySound', '0');     // a previous refusal was learned on this device
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
    localStorage.setItem('addabaaz.autoplaySound', '0');
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

test('youtube on a touch device with UNKNOWN policy: sound-first attempt, refusal is remembered (later plays start muted instantly)', async () => {
  const prevMM = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    globalThis.__ytScenario = { startState: 5, delayToPlayMs: null, playsWithSound: false, mutedPlays: true };
    let mutedCb = 0; const t0 = Date.now(); let mutedAt = -1;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
      autoplay: true, onAutoplayMuted: () => { mutedCb++; mutedAt = Date.now() - t0; },
    });
    assert.equal(globalThis.__createdMuted, false, 'policy unknown → the player is built unmuted (sound-first attempt)');
    await wait(5000);
    assert.equal(mutedCb, 1, 'the refusal is discovered by the short touch poll and muted playback starts');
    assert.ok(mutedAt >= 1800 && mutedAt <= 4200, `touch poll should land ~2.7s (got ${mutedAt}ms)`);
    assert.equal(localStorage.getItem('addabaaz.autoplaySound'), '0', 'the refusal is learned for next time');
    ctl.destroy();
  } finally { if (prevMM === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prevMM; }
});

test('youtube on a touch device with LEARNED sound success: sound-first keeps working, never muted', async () => {
  const prevMM = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    localStorage.setItem('addabaaz.autoplaySound', '1');
    globalThis.__ytScenario = { startState: 5, delayToPlayMs: 400, playsWithSound: true };
    let mutedCb = 0, blockedCb = 0;
    const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
      autoplay: true, onAutoplayMuted: () => mutedCb++, onAutoplayBlocked: () => blockedCb++,
    });
    assert.equal(globalThis.__createdMuted, false, 'sound is tried first when it is known to work');
    await wait(4000);
    assert.equal(mutedCb, 0, 'sound autoplay succeeded → no mute fallback, no pill');
    assert.equal(blockedCb, 0);
    assert.equal(localStorage.getItem('addabaaz.autoplaySound'), '1', 'success stays learned');
    ctl.destroy();
  } finally { if (prevMM === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prevMM; }
});

test('youtube (desktop): a successful sound autoplay is learned too', async () => {
  globalThis.__ytScenario = { startState: 5, delayToPlayMs: 800, playsWithSound: true };
  let mutedCb = 0;
  const ctl = await createPlayer(container, { source: { type: 'youtube', id: 'x' } }, {
    autoplay: true, onAutoplayMuted: () => mutedCb++,
  });
  await wait(3500);
  assert.equal(mutedCb, 0);
  assert.equal(localStorage.getItem('addabaaz.autoplaySound'), '1', 'observed sound success is recorded');
  ctl.destroy();
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
