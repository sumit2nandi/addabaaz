/* Player adapter layer.
 * The watch page only knows this interface:
 *   const ctl = await createPlayer(container, video, { start, autoplay, onProgress(t,d), onEnded(), onState(s) })
 *   ctl.destroy() / ctl.seek(sec) / ctl.play() / ctl.pause() / ctl.time() / ctl.duration()
 * `video.source` decides the engine:
 *   { type: 'youtube', id }         – YouTube IFrame API (current catalogue)
 *   { type: 'mp4',  url }           – progressive video file
 *   { type: 'hls',  url }           – adaptive stream (.m3u8) via native HLS or hls.js
 * Move titles to your own CDN later by only changing `source` in data/catalog.json.
 */
import { loadYouTube, createYouTubePlayer } from './youtube.js';
import { createHtml5Player } from './html5.js';

// How long the browser gets to start sound-autoplay before we check whether it was blocked.
const AUTOPLAY_WAIT_MS = 2200;

/* Phones: sound autoplay is refused in the large majority of cases, and the refusal is visible almost
 * immediately (a video that IS allowed moves to BUFFERING within ~1s of the API being ready — YouTube starts
 * loading the moment it may play). Polling the desktop cadence (~2.2s + 4×0.7s ≈ 5s) therefore just makes
 * mobile playback start needlessly late "by design". On touch devices check earlier and give up sooner:
 * playback then begins (muted, with the unmute pill) about 2.5s after the player is ready instead of ~5s. */
const coarseTouch = () => {
  try { if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true; } catch { /* no media queries */ }
  return (typeof navigator !== 'undefined' && navigator.maxTouchPoints || 0) > 1;
};

/** Options (all optional): start, autoplay, muted, controls (false for reels), onProgress, onEnded, onState,
 *  onAutoplayMuted() - autoplay with sound was blocked, so we restarted it muted (show a "tap to unmute" hint),
 *  onGestureUnmuted() - the first user gesture unmuted a muted-started player (hide the hint above),
 *  onAutoplayBlocked() - even muted playback did not start (Low Power Mode etc.); the viewer has to tap play. */
export async function createPlayer(container, video, opts = {}) {
  let playing = false, gone = false, fellBack = false, errored = false;
  const timers = [];
  const wrapped = { ...opts, onState: (s, code) => { if (s === 'playing' || s === 'buffering') playing = true; else if (s === 'error') errored = true; /* buffering = the browser did start it, just slowly; errored = a mute "recovery" would be pointless */ opts.onState?.(s, code); } };
  const src = video.source || {};
  // Sticky page activation: once the viewer has interacted with the page (any tap — e.g. the tap that opened
  // this video), browsers allow programmatic playback WITH sound for the rest of the page's life.
  const noActivation = !!(navigator.userActivation && !navigator.userActivation.hasBeenActive);
  /* Phones, first play before ANY gesture: build the player MUTED with autoplay from the first frame instead
   * of trying sound first and discovering the refusal seconds later (API ready → sound attempt → poll → muted
   * restart ≈ 2.5–5s of dead screen). Muted autoplay is allowed everywhere, so motion starts the moment the
   * embed is ready — the instant behaviour of an `autoplay=1&mute=1` plain embed. The page's unmute pill is
   * shown immediately, and the FIRST GESTURE anywhere (a tap, the swipe to the next reel…) unmutes
   * automatically. From then on the page is activated, so every later video builds sound-first — real audio
   * starts on the second video and beyond without any pill. */
  const touchMuted = coarseTouch() && opts.autoplay !== false && !opts.muted && noActivation;
  const effectiveMuted = !!opts.muted || touchMuted;
  const playerOpts = touchMuted ? { ...wrapped, muted: true } : wrapped;

  /* Unmute at the first genuine gesture (pointerdown/touchstart/keydown, capture phase, at most once per
   * playback): that interaction satisfies every browser's sound policy, so a muted start need not stay muted
   * beyond the viewer's first interaction. Views hear onGestureUnmuted() and hide their tap-for-sound pill. */
  let ctl;
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

  if (src.type === 'youtube') ctl = await createYouTubePlayer(container, src.id, playerOpts);
  else if (src.type === 'mp4' || src.type === 'hls') ctl = await createHtml5Player(container, video, playerOpts);
  else throw new Error('Unsupported source type: ' + src.type);
  if (touchMuted) opts.onAutoplayMuted?.();   // tells the page to show its "tap for sound" affordance now
  // (gesture-unmute is armed for every muted autostart below — the touchMuted path included).

  /* Mobile browsers (Chrome Android, iOS Safari) only allow autoplay WITH sound after a gesture, and the player is
   * created asynchronously, so that permission is often gone. Standard remedy: if the browser actually refused sound
   * autoplay, restart it muted (muted autoplay is always allowed) and tell the page so it can offer a "tap to unmute"
   * button. We must NOT do this merely because the video is slow to load — that used to mute perfectly good
   * sound-autoplay on mobile networks. */
  const startMuted = () => {
    if (gone || playing || fellBack || errored) return;   // a broken file is not an autoplay block: the page shows the error instead
    fellBack = true;
    try { ctl.mute(); Promise.resolve(ctl.play()).catch(() => {}); } catch { /* player already gone */ }
    opts.onAutoplayMuted?.();
    armGestureUnmute();                                   // first gesture after a muted restart gives sound too
    timers.push(setTimeout(() => { if (!gone && !playing) opts.onAutoplayBlocked?.(); }, AUTOPLAY_WAIT_MS));
  };

  // Chrome/Firefox/Safari all refuse autoplay-with-sound until the user has interacted with the page.
  // `noActivation` (computed above from `hasBeenActive`) tells us that up front (deep link / reload):
  // skip the wait and go straight to muted.

  if (ctl.engine === 'iframe') { /* plain-iframe fallback has no state events to watch */ }
  else if (opts.autoplay === false) { /* viewer asked for no autoplay: nothing to recover from */ }
  else if (effectiveMuted) {
    /* Started muted on purpose — viewer choice (reels) or the instant phone path above. ANY muted autostart
     * arms the first-gesture unmute below, so a reel built muted still gains sound at the next swipe/tap
     * even when it was muted by the page rather than by the phone path. Also watch for a total block
     * (Low Power Mode, data saver…): if muted playback can run at all, motion starts on its own. */
    armGestureUnmute();
    timers.push(setTimeout(() => { if (!gone && !playing) opts.onAutoplayBlocked?.(); }, AUTOPLAY_WAIT_MS * 1.5));
  } else if (noActivation) {
    // No gesture on this page yet → sound autoplay is certain to be blocked → start muted right away.
    startMuted();
  } else if (ctl.playPromise) {
    // HTML5: the initial play() promise is the definitive signal — it rejects with NotAllowedError exactly when
    // autoplay-with-sound is blocked. Nothing else (slow network, cold cache) may trigger the mute fallback.
    ctl.playPromise.then(null, (err) => {
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) startMuted();
      // Any other rejection is a real media error: the video element's 'error' event reports it.
    });
    // Safety net for exotic cases where the promise neither resolves nor rejects.
    timers.push(setTimeout(startMuted, AUTOPLAY_WAIT_MS * 3));
  } else if (ctl.state) {
    // YouTube IFrame: no play promise. Poll the player state — if it sits in unstarted(-1)/cued(5) for long enough
    // after the API is ready, sound autoplay was refused; if it ever reaches buffering/playing, it was just slow.
    const touch = coarseTouch();
    const firstCheck = touch ? 1200 : AUTOPLAY_WAIT_MS, gap = touch ? 500 : 700, rounds = touch ? 3 : 4;
    const poll = (roundsLeft) => {
      if (gone || playing || fellBack) return;
      const st = ctl.state();
      if (st === 3 || st === 1) return;                       // loading or playing: sound autoplay works
      if (roundsLeft > 0) timers.push(setTimeout(() => poll(roundsLeft - 1), gap));
      else startMuted();                                       // still unstarted/cued → blocked
    };
    timers.push(setTimeout(() => poll(rounds), firstCheck));   // desktop: ~2.2s + 4×0.7s ≈ 5s; phones: ~1.2s + 3×0.5s ≈ 2.7s
  }

  const destroy = ctl.destroy;
  ctl.destroy = () => { gone = true; timers.forEach(clearTimeout); destroy(); };
  return ctl;
}
export { loadYouTube };
