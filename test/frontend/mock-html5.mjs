// Mock HTML5 player for autoplay-logic tests. `globalThis.__html5Scenario` controls behaviour:
//   { reject: 'autoplay' | 'media' | null, playsAfterMs }
// - reject 'autoplay': initial play() rejects with NotAllowedError (browser blocked sound autoplay)
// - reject 'media':    initial play() rejects with NotSupportedError (broken file — must NOT trigger the mute fallback)
// - reject null:       play() resolves and the video starts
export function createHtml5Player(container, video, opts) {
  const sc = globalThis.__html5Scenario || { reject: null, playsAfterMs: 100 };
  let destroyed = false;
  const emit = (s, code) => { if (!destroyed) opts.onState?.(s, code); };
  let playPromise;
  if (sc.reject === 'autoplay') {
    const err = new Error('play() request interrupted'); err.name = 'NotAllowedError';
    playPromise = Promise.reject(err);
  } else if (sc.reject === 'media') {
    const err = new Error('The source could not be loaded'); err.name = 'NotSupportedError';
    playPromise = Promise.reject(err);
    setTimeout(() => emit('error', 4), 30);
  } else {
    playPromise = new Promise((res) => setTimeout(() => { res(); setTimeout(() => emit('playing'), 30); }, sc.playsAfterMs ?? 100));
  }
  playPromise.catch(() => {});
  let muted = false;
  return {
    engine: 'mp4',
    playPromise,
    time: () => 0, duration: () => 0,
    seek() {}, pause() {},
    mute() { muted = true; }, unmute() { muted = false; }, isMuted: () => muted,
    play() { if (muted) setTimeout(() => emit('playing'), 30); },
    destroy() { destroyed = true; },
  };
}
