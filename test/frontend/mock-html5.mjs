// Mock HTML5 player for the main-style autoplay tests. `globalThis.__html5Scenario`:
//   { reject: 'autoplay' | 'media' | null, playsAfterMs }
// - reject 'autoplay': initial play() rejects with NotAllowedError (browser blocked autoplay outright)
// - reject 'media':    initial play() rejects with NotSupportedError (broken file — must NOT be
//                      mistaken for an autoplay block; the media 'error' event is the only signal)
// - reject null:       play() resolves and the video starts
// It mirrors mute state: built muted sets `__muted`, unmute() clears it (like main's lifts).
export function createHtml5Player(container, video, opts) {
  const sc = { reject: null, playsAfterMs: 100, ...(globalThis.__html5Scenario || {}) };
  globalThis.__createdMuted = !!opts.muted;
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
  let muted = !!opts.muted;
  globalThis.__muted = muted;
  return {
    engine: 'mp4',
    playPromise,
    time: () => 0, duration: () => 0,
    seek() {}, pause() {},
    play() { if (muted) setTimeout(() => emit('playing'), 30); },
    mute() { muted = true; globalThis.__muted = true; },
    unmute() { muted = false; globalThis.__muted = false; globalThis.__unmuted = true; },
    isMuted: () => muted,
    destroy() { destroyed = true; },
  };
}
