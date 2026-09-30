// Mock of app/js/players/index.js for the watch-page tests: records the options the page passed
// and counts play/unmute calls; the test drives the blocked/muted callbacks itself.
export async function createPlayer(container, media, opts = {}) {
  globalThis.__watchOpts = opts;
  const ctl = {
    engine: 'mock',
    __played: false, __unmuted: false, __destroyed: false,
    play() { this.__played = true; return Promise.resolve(); },
    pause() {}, mute() {}, unmute() { this.__unmuted = true; }, isMuted: () => !this.__unmuted,
    time: () => 0, duration: () => 0, seek() {}, destroy() { this.__destroyed = true; },
    castSupported: () => false,
  };
  globalThis.__watchCtl = ctl;
  return ctl;
}
export async function loadYouTube() { throw new Error('mock: no network'); }
