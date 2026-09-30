// Mock YouTube player for the main-style autoplay tests. `globalThis.__ytScenario`:
//   { autoplayBlocked = false, bufferingAfterMs = 80, playAfterMs = 200, startState = 5 }
// - autoplayBlocked: the embed never starts (Low Power Mode etc.) → state stays cued/unstarted
// - bufferingAfterMs: playback begins (state 3) this long after creation — a real allowed embed starts
//   loading within ~1s even on slow networks, so "slow" means slow TO PLAY, not slow to buffer
// - playAfterMs: reaches playing(1) at this point
// It also mirrors mute state: built muted sets `__muted`, unmute() clears it (like main's lifts).
export function createYouTubePlayer(container, videoId, opts) {
  const sc = { autoplayBlocked: false, bufferingAfterMs: 80, playAfterMs: 200, startState: 5, ...(globalThis.__ytScenario || {}) };
  globalThis.__createdMuted = !!opts.muted;   // records whether the adapter built the player muted (instant start)
  globalThis.__muted = !!opts.muted;
  let muted = !!opts.muted;
  let state = sc.startState;
  let destroyed = false;
  const timers = [];
  const NAME = { 1: 'playing', 2: 'paused', 3: 'buffering', 0: 'ended' }; // PlayerState code → app state name
  const emit = (s) => { state = s; if (NAME[s]) opts.onState?.(NAME[s]); };
  if (!sc.autoplayBlocked) {
    timers.push(setTimeout(() => {
      if (destroyed) return;
      emit(3);
      timers.push(setTimeout(() => { if (!destroyed) emit(1); }, Math.max(0, sc.playAfterMs - sc.bufferingAfterMs)));
    }, sc.bufferingAfterMs));
  }
  return {
    engine: 'youtube',
    state: () => state,
    time: () => 0, duration: () => 0,
    seek() {}, pause() {},
    play() {
      if (sc.autoplayBlocked) return;         // muted playback also refused (Low Power Mode etc.)
      state = 3; setTimeout(() => !destroyed && emit(1), 50);
    },
    mute() { muted = true; globalThis.__muted = true; },
    unmute() { muted = false; globalThis.__muted = false; globalThis.__unmuted = true; },
    isMuted: () => muted,
    destroy() { destroyed = true; timers.forEach(clearTimeout); },
  };
}
export function loadYouTube() { return Promise.resolve({}); }
