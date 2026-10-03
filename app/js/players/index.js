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
 *   1. build every autoplaying player explicitly MUTED and inline; this is the form iOS browsers can
 *      permit, and makes the muted state visible before playback begins;
 *   2. only after a real `playing` event, try to lift mute at 600/1500/3000ms. Unmuting on a timer from
 *      player creation can race a slow iPhone/YouTube startup: Safari sees an unmuted player before its
 *      first frame and blocks the autoplay attempt. Browsers that require a gesture simply keep it muted.
 * A "tap for sound" pill appears if the lifts are refused; a later gesture unmutes as a safety net.
 * `onAutoplayBlocked` is reserved for cases where muted playback itself never starts.
 */
import { loadYouTube, createYouTubePlayer } from './youtube.js';
import { createHtml5Player } from './html5.js';

// How long a player gets before "it never started" counts as a full autoplay block (a genuine
// rejection on HTML5, a still-unstarted YouTube state at this point).
const AUTOPLAY_WAIT_MS = 2200;
// Optional sound schedule, measured from the first real PLAYING event (not player construction).
const UNMUTE_LIFTS_MS = [600, 1500, 3000];

/** Options (all optional): start, autoplay, muted, controls (false for reels), onProgress, onEnded, onState,
 *  onAutoplayMuted() - the player still runs muted after every unmute lift (show a "tap for sound" hint),
 *  onGestureUnmuted() - the first user gesture unmuted the player (hide the hint above),
 *  onAutoplayBlocked() - even muted playback did not start (Low Power Mode etc.); the viewer has to tap play. */
export async function createPlayer(container, video, opts = {}) {
  let playing = false, playbackStarted = false, gone = false, errored = false;
  const timers = [];
  let cancelLifts = () => {};   // set once the unmute lifts exist; also called from destroy()
  let startSoundLifts = () => {}; // initialized after the adapter resolves; PLAYING may arrive before then
  const src = video.source || {};
  const autoplay = opts.autoplay !== false;
  const wantSound = !opts.muted;   // the page did not force mute (e.g. the reels viewer chose silence)
  const wrapped = { ...opts, onState: (s, code) => {
    if (s === 'playing') { playing = true; playbackStarted = true; startSoundLifts(); }
    else if (s === 'buffering') playing = true; // accepted by the engine; wait for actual PLAYING before any unmute attempt
    else if (s === 'error') errored = true;
    opts.onState?.(s, code);
  } };

  /* Every autoplaying player is created muted and inline. Keep it muted until the browser reports a real
   * PLAYING state: lifting mute while iOS is still loading can turn a permitted muted autoplay into a
   * sound-first attempt, which Safari blocks. */
  const playerOpts = autoplay ? { ...wrapped, muted: true } : wrapped;

  let ctl;
  if (src.type === 'youtube') ctl = await createYouTubePlayer(container, src.id, playerOpts);
  else if (src.type === 'mp4' || src.type === 'hls') ctl = await createHtml5Player(container, video, playerOpts);
  else throw Object.assign(new Error('This video can’t be played right now.'), { friendly: true });

  /* Unmute at the first genuine gesture (pointerdown/touchstart/keydown, capture phase, at most once per
   * playback): that interaction satisfies every browser's sound policy, so a muted start need not stay muted
   * beyond the viewer's first interaction. Views hear onGestureUnmuted() and hide their tap-for-sound pill. */
  const armGestureUnmute = () => {
    const target = typeof window !== 'undefined' ? window : (typeof document !== 'undefined' ? document : null);
    if (!target || typeof target.addEventListener !== 'function') return;
    const EVENTS = ['pointerdown', 'touchstart', 'keydown'];
    const disarm = () => EVENTS.forEach((t) => target.removeEventListener(t, onGesture, true));
    let heard = false;
    const onGesture = () => {                    // one physical tap fires SEVERAL of these in a row — react once
      if (heard || gone) return;
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
    armGestureUnmute();   // later gestures unmute without relying on the navigation tap surviving async player setup

    // Start the optional sound lifts only after PLAYING. This avoids an early unmute racing iPhone startup.
    const soundTimers = [];
    let liftsStarted = false, liftWorked = false;
    cancelLifts = () => { soundTimers.forEach(clearTimeout); soundTimers.length = 0; };
    startSoundLifts = () => {
      if (!ctl || gone || !wantSound || liftsStarted) return;
      liftsStarted = true;
      // Some browsers allow sound after muted playback starts; iOS may keep it muted until a gesture.
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

  const destroy = ctl.destroy;
  ctl.destroy = () => { gone = true; cancelLifts(); timers.forEach(clearTimeout); destroy(); };
  return ctl;
}
export { loadYouTube };
