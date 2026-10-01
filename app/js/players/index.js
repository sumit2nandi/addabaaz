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
 * Autoplay strategy — the same one the main branch used in its createVideoPlayer():
 *   1. build the player MUTED (autoplay=1&mute=1): muted autoplay is allowed everywhere, so motion
 *      starts the instant the embed is ready — no sound-first attempt, no player-state polling, no
 *      multi-second dead screen on phones;
 *   2. lift the mute at 600/1500/3000ms (main postMessaged unMute + setVolume(100) on that schedule):
 *      the tap that opened this video already satisfies the browser's sound policy, so playback comes
 *      up with VOLUME on mobiles instead of staying muted until another gesture.
 * If the player still reports muted after the last lift, the page shows its "tap for sound" pill; the
 * first gesture anywhere also unmutes as a safety net. onAutoplayBlocked fires only when even the
 * muted start never ran (Low Power Mode, data saver) — never for a merely slow load.
 */
import { loadYouTube, createYouTubePlayer } from './youtube.js';
import { createHtml5Player } from './html5.js';

// How long a player gets before "it never started" counts as a full autoplay block (a genuine
// rejection on HTML5, a still-unstarted YouTube state at this point).
const AUTOPLAY_WAIT_MS = 2200;
// main's unmute schedule: try to lift the initial mute at 600ms, 1500ms and 3000ms after creation.
const UNMUTE_LIFTS_MS = [600, 1500, 3000];

/** Options (all optional): start, autoplay, muted, controls (false for reels), onProgress, onEnded, onState,
 *  onAutoplayMuted() - the player still runs muted after every unmute lift (show a "tap for sound" hint),
 *  onGestureUnmuted() - the first user gesture unmuted the player (hide the hint above),
 *  onAutoplayBlocked() - even muted playback did not start (Low Power Mode etc.); the viewer has to tap play. */
export async function createPlayer(container, video, opts = {}) {
  let playing = false, gone = false, errored = false;
  const timers = [];
  let cancelLifts = () => {};   // set once the unmute lifts exist; also called from destroy()
  const wrapped = { ...opts, onState: (s, code) => { if (s === 'playing' || s === 'buffering') playing = true; else if (s === 'error') errored = true; /* buffering = the browser did start it, just slowly; errored = an autoplay "recovery" would be pointless */ opts.onState?.(s, code); } };
  const src = video.source || {};
  const autoplay = opts.autoplay !== false;
  const wantSound = !opts.muted;   // the page did not force mute (e.g. the reels viewer chose silence)

  /* Instant-by-construction: every autoplaying player is BUILT muted (main's autoplay=1&mute=1 embed).
   * Muted autoplay never gets refused, so videos and reels start moving the moment the engine is ready
   * on every phone — the volume then arrives via the lifts below instead of by delaying playback. */
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
    armGestureUnmute();   // every muted autostart (incl. reels' explicit-muted builds) gains sound at the first gesture

    // The lift timers + the "still muted?" pill check: an explicit ctl.mute() from the page (the reels
    // sound button) cancels them, so the viewer's own mute choice is never overridden by a later lift.
    const soundTimers = [];
    cancelLifts = () => { soundTimers.forEach(clearTimeout); soundTimers.length = 0; };
    if (wantSound) {
      // main-branch volume: lift the mute on createVideoPlayer()'s 600/1500/3000ms schedule. On mobiles the
      // opening tap has already activated the page, so the lift succeeds without any extra gesture.
      let liftWorked = false;
      for (const ms of UNMUTE_LIFTS_MS) soundTimers.push(setTimeout(() => {
        if (gone) return;
        try { ctl.unmute(); if (!ctl.isMuted || !ctl.isMuted()) liftWorked = true; } catch { /* player already gone */ }
      }, ms));
      // Never lifted AND still muted → THIS is the "browser refuses sound" case: show the tap-for-sound pill.
      soundTimers.push(setTimeout(() => {
        if (gone || liftWorked) return;
        let stillMuted = false;
        try { stillMuted = ctl.isMuted ? ctl.isMuted() : false; } catch { return; }
        if (stillMuted) opts.onAutoplayMuted?.();
      }, UNMUTE_LIFTS_MS[UNMUTE_LIFTS_MS.length - 1] + 600));
    }
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
