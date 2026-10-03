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
 *   1. iOS browsers (Safari) block unmuted autoplay outright, and a JS play() retry without a
 *      gesture is a no-op there — so the web starts the player MUTED at the embed level (the one
 *      start iOS always allows: mute=1&autoplay=1) and offers a deliberate "tap for sound" control.
 *      The app's WKWebView permits the sound-first attempt (its media playback policy is off), so
 *      native iOS still tries unmuted autoplay first and falls back to muted inline playback.
 *   2. on other browsers, start muted/inline and try to lift mute at 600/1500/3000ms after PLAYING.
 * A "tap for sound" pill appears when iOS falls back to muted or other browsers refuse the lifts.
 * `onAutoplayBlocked` is reserved for cases where muted playback itself never starts.
 */
import { loadYouTube, createYouTubePlayer } from './youtube.js';
import { createHtml5Player } from './html5.js';

// How long a player gets before "it never started" counts as a full autoplay block (a genuine
// rejection on HTML5, a still-unstarted YouTube state at this point).
const AUTOPLAY_WAIT_MS = 2200;
// Optional sound schedule, measured from the first real PLAYING event (not player construction).
const UNMUTE_LIFTS_MS = [600, 1500, 3000];

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
  let cancelLifts = () => {};   // set once the unmute lifts exist; also called from destroy()
  let startSoundLifts = () => {}; // initialized after the adapter resolves; PLAYING may arrive before then
  const src = video.source || {};
  const autoplay = opts.autoplay !== false;
  const iosBrowser = isIOSBrowser();
  const wantSound = !opts.muted;   // the page did not force mute (e.g. the reels viewer chose silence)
  const wrapped = {
    ...opts,
    onUserMute: () => cancelLifts(),
    onState: (s, code) => {
      if (s === 'playing') { playing = true; playbackStarted = true; startSoundLifts(); }
      else if (s === 'buffering') playing = true; // accepted by the engine; wait for actual PLAYING before any unmute attempt
      else if (s === 'error') errored = true;
      opts.onState?.(s, code);
    },
  };

  /* Prefer the sound-first attempt on iOS ONLY in the native app (its WKWebView allows it); Safari
   * blocks unmuted autoplay and ignores a gesture-less play() retry, so an iOS browser starts muted
   * at the embed level — the one autoplay start iOS reliably allows — and the tap-for-sound pill
   * offers audio. All other autoplay starts muted as well. The adapters retry muted playback if an
   * unmuted attempt is refused. */
  const nativeApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
  const tryUnmutedOnIOS = autoplay && iosBrowser && wantSound && nativeApp;
  const playerOpts = autoplay ? { ...wrapped, muted: !tryUnmutedOnIOS } : wrapped;

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

    // Start optional sound handling only after PLAYING. iOS must stay muted unless a sound control is tapped.
    const soundTimers = [];
    let liftsStarted = false, liftWorked = false;
    cancelLifts = () => { soundTimers.forEach(clearTimeout); soundTimers.length = 0; };
    startSoundLifts = () => {
      if (!ctl || gone || !wantSound || liftsStarted) return;
      liftsStarted = true;
      if (iosBrowser) {
        // Safari stops autoplay when a timer makes a playing video audible. Keep it muted and surface
        // the explicit tap-for-sound UI; the view's click handler unmutes inside the user's gesture.
        let stillMuted = true;
        try { stillMuted = ctl.isMuted ? ctl.isMuted() : true; } catch { return; }
        if (stillMuted) opts.onAutoplayMuted?.();
        return;
      }
      // Other browsers may allow sound after muted playback starts; try the gradual lift schedule.
      for (const ms of UNMUTE_LIFTS_MS) soundTimers.push(setTimeout(() => {
        if (gone) return;
        try { ctl.unmute(); if (!ctl.isMuted || !ctl.isMuted()) liftWorked = true; } catch { /* player already gone */ }
      }, ms));
      // Still muted after the post-start lifts → offer an explicit tap for sound.
      soundTimers.push(setTimeout(() => {
        if (gone || liftWorked) return;
        let stillMuted = false;
        try { stillMuted = ctl.isMuted ? ctl.isMuted() : false; } catch { return; }
        if (stillMuted) opts.onAutoplayMuted?.();
      }, UNMUTE_LIFTS_MS[UNMUTE_LIFTS_MS.length - 1] + 600));
    };
    if (playbackStarted) startSoundLifts();  // playback can start before the async adapter finishes returning
    const baseMute = ctl.mute;
    ctl.mute = () => { cancelLifts(); try { baseMute(); } catch { /* player already gone */ } };

    // Total block (Low Power Mode, aggressive data saver…): even the always-allowed muted start never ran.
    timers.push(setTimeout(() => {
      if (gone || playing || errored) return;          // a broken file is not an autoplay block: the page shows the error instead
      if (ctl.engine === 'iframe') return;             // plain embed: no state events to inspect
      if (ctl.playPromise) {
        // HTML5: the play() promise is definitive. Pending (slow network) is NOT a block — only a real
        // NotAllowedError/AbortError rejection says the browser refused to start playback at all.
        ctl.playPromise.then(null, (err) => {
          if (!gone && !playing && !errored && err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) opts.onAutoplayBlocked?.();
        });
        return;
      }
      // YouTube IFrame API: a player that is allowed starts loading within ~1s; still unstarted/cued at
      // this point means the embed was refused entirely → offer the big "tap to play" affordance.
      try { const st = ctl.state?.(); if (st !== 1 && st !== 3) opts.onAutoplayBlocked?.(); } catch { /* player already gone */ }
    }, AUTOPLAY_WAIT_MS * 1.5));
  }

  // The last-resort YouTube iframe has no API events, so it cannot report whether sound-first autoplay
  // was blocked. That fallback is deliberately muted to preserve motion; expose the sound hint after load.
  if (iosBrowser && autoplay && wantSound && ctl.engine === 'iframe') {
    timers.push(setTimeout(() => {
      if (gone) return;
      let stillMuted = true;
      try { stillMuted = ctl.isMuted ? ctl.isMuted() : true; } catch { return; }
      if (stillMuted) opts.onAutoplayMuted?.();
    }, 1000));
  }

  const destroy = ctl.destroy;
  ctl.destroy = () => { gone = true; cancelLifts(); timers.forEach(clearTimeout); destroy(); };
  return ctl;
}
export { loadYouTube };
