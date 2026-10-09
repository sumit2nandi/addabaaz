/* Player adapter layer.
 * The watch page only knows this interface:
 *   const ctl = await createPlayer(container, video, { start, autoplay, onProgress(t,d), onEnded(), onState(s) })
 *   ctl.destroy() / ctl.seek(sec) / ctl.play() / ctl.pause() / ctl.time() / ctl.duration()
 * `video.source` decides the engine:
 *   { type: 'youtube', id }         – YouTube IFrame API (current catalogue)
 *   { type: 'mp4',  url }           – progressive video file
 *   { type: 'hls',  url }           – adaptive stream (.m3u8) via native HLS or hls.js
 * Move titles to your own CDN later by only changing `source` in data/catalog.json.
 *
 * Autoplay strategy:
 *   1. Unless the viewer explicitly chose mute, request sound on the first attempt on every platform.
 *   2. If browser policy rejects sound, the HTML5/YouTube adapters retry muted so playback can still
 *      start. Never unmute later on a timer: a muted fallback stays muted until a deliberate gesture.
 * A "tap for sound" pill appears only when sound-first autoplay fell back to muted playback.
 * `onAutoplayBlocked` is reserved for cases where even the muted fallback never starts.
 */
import { loadYouTube, createYouTubePlayer } from './youtube.js';
import { createHtml5Player } from './html5.js';

// How long a player gets before "it never started" counts as a full autoplay block (a genuine
// rejection on HTML5, a still-unstarted YouTube state at this point).
const AUTOPLAY_WAIT_MS = 2200;
// iOS pauses autoplaying media if script unmutes it without a direct user gesture. Include iPadOS
// desktop-mode Safari, whose user agent says Mac but whose touch-point count identifies an iPad.
function isIOSBrowser() {
  const nav = globalThis.navigator;
  if (!nav) return false;
  return nav.userAgentData?.platform === 'iOS'
    || /iPad|iPhone|iPod/i.test(nav.userAgent || '')
    || (nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1);
}

/** Options (all optional): start, autoplay, muted, controls (false for reels), onProgress, onEnded, onState,
 *  onAutoplayMuted() - autoplay is running muted and needs an explicit sound action (show a "tap for sound" hint),
 *  onGestureUnmuted() - the first fallback gesture unmuted the player (hide the hint above),
 *  onAutoplayBlocked() - even muted playback did not start (Low Power Mode etc.); the viewer has to tap play. */
export async function createPlayer(container, video, opts = {}) {
  let playing = false, playbackStarted = false, gone = false, errored = false;
  const timers = [];
  let checkMutedAutoplay = () => {}; // initialized after the adapter resolves; PLAYING may arrive before then
  const src = video.source || {};
  const autoplay = opts.autoplay !== false;
  const iosBrowser = isIOSBrowser();
  const wantSound = !opts.muted;   // the page did not force mute (e.g. the reels viewer chose silence)
  const wrapped = {
    ...opts,
    onState: (s, code) => {
      if (s === 'playing') { playing = true; playbackStarted = true; checkMutedAutoplay(); }
      else if (s === 'buffering') playing = true;
      else if (s === 'error') errored = true;
      opts.onState?.(s, code);
    },
  };

  // Respect the requested mute state on the first attempt. If autoplay with sound is prohibited,
  // each engine has its own muted retry; the muted fallback is never lifted automatically later.
  const playerOpts = autoplay ? { ...wrapped, muted: !wantSound } : wrapped;

  let ctl;
  if (src.type === 'youtube') ctl = await createYouTubePlayer(container, src.id, playerOpts);
  else if (src.type === 'mp4' || src.type === 'hls') ctl = await createHtml5Player(container, video, playerOpts);
  else throw Object.assign(new Error('This video can’t be played right now.'), { friendly: true });

  /* On browsers that auto-unmute is allowed, use the first genuine gesture (capture phase) as a safety net.
   * Skip dedicated sound buttons: their own click handlers toggle mute, and pre-unmuting in capture would
   * invert the button's intended action. iOS gets explicit sound controls rather than this broad fallback. */
  const armGestureUnmute = () => {
    const target = typeof window !== 'undefined' ? window : (typeof document !== 'undefined' ? document : null);
    if (!target || typeof target.addEventListener !== 'function') return;
    const EVENTS = ['pointerdown', 'touchstart', 'keydown'];
    const disarm = () => EVENTS.forEach((t) => target.removeEventListener(t, onGesture, true));
    let heard = false;
    const onGesture = (event) => {               // one physical tap fires SEVERAL of these in a row — react once
      if (heard || gone) return;
      if (event?.target?.closest?.('.unmute-pill, .ytp-vol-btn, .ytp-vol-slider, [data-reel-sound]')) return;
      heard = true;
      disarm();
      if (errored) return;                                  // a dead player gains nothing from unmuting
      try { if (!ctl.isMuted || ctl.isMuted()) ctl.unmute(); } catch { /* player already gone */ }
      opts.onGestureUnmuted?.();
    };
    EVENTS.forEach((t) => target.addEventListener(t, onGesture, true));
    timers.push(setTimeout(disarm, 90000));                 // stop listening eventually; destroy() clears this
  };

  if (autoplay) {
    if (!iosBrowser) armGestureUnmute();   // on iOS, only the explicit sound control should unmute media

    let mutePromptShown = false;
    checkMutedAutoplay = () => {
      if (!ctl || gone || !wantSound || mutePromptShown) return;
      let stillMuted = false;
      try { stillMuted = ctl.isMuted ? ctl.isMuted() : false; } catch { return; }
      if (stillMuted) { mutePromptShown = true; opts.onAutoplayMuted?.(); }
    };
    if (playbackStarted) checkMutedAutoplay(); // playback can start before the async adapter finishes returning

    // Total block (Low Power Mode, aggressive data saver…): even the muted fallback never ran.
    timers.push(setTimeout(() => {
      if (gone || playing || errored) return;          // a broken file is not an autoplay block: the page shows the error instead
      if (ctl.playPromise) {
        // HTML5: the play() promise is definitive. Pending (slow network) is NOT a block — only a real
        // NotAllowedError/AbortError rejection says the browser refused to start playback at all.
        ctl.playPromise.then(null, (err) => {
          if (!gone && !playing && !errored && err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) opts.onAutoplayBlocked?.();
        });
        return;
      }
      // YouTube's IFrame API and the API-less fallback both report player state; still unstarted/cued
      // here means the embed was refused entirely → offer the big "tap to play" affordance.
      try { const st = ctl.state?.(); if (st !== 1 && st !== 3) opts.onAutoplayBlocked?.(); } catch { /* player already gone */ }
    }, AUTOPLAY_WAIT_MS * 1.5));
  }

  const destroy = ctl.destroy;
  ctl.destroy = () => { gone = true; timers.forEach(clearTimeout); destroy(); };
  return ctl;
}
export { loadYouTube };
