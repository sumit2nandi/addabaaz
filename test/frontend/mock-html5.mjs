// Mock HTML5 player for the createPlayer() autoplay tests.
// `__html5Scenario.reject` can simulate an autoplay-policy rejection or a genuine media error.
export function createHtml5Player(container, video, opts) {
  const sc = { reject: null, playsAfterMs: 100, ...(globalThis.__html5Scenario || {}) };
  globalThis.__createdMuted = !!opts.muted;
  let destroyed = false, muted = !!opts.muted;
  const emit = (s, code) => { if (!destroyed) opts.onState?.(s, code); };
  globalThis.__muted = muted;

  let playPromise;
  if (sc.reject === 'autoplay') {
    const err = new Error('play() request interrupted'); err.name = 'NotAllowedError';
    playPromise = Promise.reject(err);
    if (!muted) {
      // Mirror createHtml5Player: after sound-first is denied, retry once with mute enabled.
      playPromise = playPromise.catch((reason) => {
        if (reason?.name !== 'NotAllowedError' && reason?.name !== 'AbortError') throw reason;
        muted = true; globalThis.__muted = true;
        return new Promise((resolve) => setTimeout(() => { emit('playing'); resolve(); }, 30));
      });
    }
  } else if (sc.reject === 'media') {
    const err = new Error('The source could not be loaded'); err.name = 'NotSupportedError';
    playPromise = Promise.reject(err);
    setTimeout(() => emit('error', 4), 30);
  } else {
    playPromise = new Promise((resolve) => setTimeout(() => { resolve(); setTimeout(() => emit('playing'), 30); }, sc.playsAfterMs));
  }
  playPromise.catch(() => {});
  return {
    engine: 'mp4',
    playPromise,
    time: () => 0, duration: () => 0,
    seek() {}, pause() {},
    play() { if (muted) return new Promise((resolve) => setTimeout(() => { emit('playing'); resolve(); }, 30)); },
    mute() { muted = true; globalThis.__muted = true; },
    unmute() { muted = false; globalThis.__muted = false; globalThis.__unmuted = true; },
    isMuted: () => muted,
    destroy() { destroyed = true; },
  };
}
