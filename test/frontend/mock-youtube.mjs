// Mock YouTube player for autoplay-logic tests. `globalThis.__ytScenario` controls behaviour:
//   { startState, delayToPlayMs, playsWithSound }
// - startState: initial player state (5=cued, -1=unstarted)
// - delayToPlayMs: ms until it reaches playing(1)/buffering(3); null = never (autoplay blocked)
// - playsWithSound: if true and autoplay allowed, it will actually start; otherwise it stays cued
export function createYouTubePlayer(container, videoId, opts) {
  const sc = globalThis.__ytScenario || { startState: 5, delayToPlayMs: null, playsWithSound: false };
  let state = sc.startState;
  let destroyed = false;
  const timers = [];
  const NAME = { 1: 'playing', 2: 'paused', 3: 'buffering', 0: 'ended' }; // PlayerState code → app state name
  const emit = (s) => { state = s; if (NAME[s]) opts.onState?.(NAME[s]); };
  if (sc.delayToPlayMs != null && sc.playsWithSound) {
    timers.push(setTimeout(() => { if (!destroyed) { emit(3); setTimeout(() => !destroyed && emit(1), 50); } }, sc.delayToPlayMs));
  }
  return {
    engine: 'youtube',
    state: () => state,
    time: () => 0, duration: () => 0,
    seek() {}, pause() {},
    mute() { globalThis.__muted = true; },
    unmute() { globalThis.__muted = false; },
    play() {
      if (sc.mutedPlays === false) return; // muted playback also refused (Low Power Mode etc.)
      // A muted play always succeeds on phones; an unmuted play only succeeds if the scenario allows it.
      if (globalThis.__muted || sc.playsWithSound) { state = 3; setTimeout(() => !destroyed && emit(1), 50); }
    },
    destroy() { destroyed = true; timers.forEach(clearTimeout); },
  };
}
export function loadYouTube() { return Promise.resolve({}); }
