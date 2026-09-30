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

/** Options (all optional): start, autoplay, muted, controls (false for reels), onProgress, onEnded, onState,
 *  onAutoplayMuted() - autoplay with sound was blocked, so we restarted it muted (show a "tap to unmute" hint),
 *  onAutoplayBlocked() - even muted playback did not start (Low Power Mode etc.); the viewer has to tap play. */
export async function createPlayer(container, video, opts = {}) {
  let playing = false, gone = false, fellBack = false, errored = false;
  const timers = [];
  const wrapped = { ...opts, onState: (s, code) => { if (s === 'playing' || s === 'buffering') playing = true; else if (s === 'error') errored = true; /* buffering = the browser did start it, just slowly; errored = a mute "recovery" would be pointless */ opts.onState?.(s, code); } };
  const src = video.source || {};
  let ctl;
  if (src.type === 'youtube') ctl = await createYouTubePlayer(container, src.id, wrapped);
  else if (src.type === 'mp4' || src.type === 'hls') ctl = await createHtml5Player(container, video, wrapped);
  else throw new Error('Unsupported source type: ' + src.type);

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
    timers.push(setTimeout(() => { if (!gone && !playing) opts.onAutoplayBlocked?.(); }, AUTOPLAY_WAIT_MS));
  };

  // Chrome/Firefox/Safari all refuse autoplay-with-sound until the user has interacted with the page.
  // `hasBeenActive` tells us that up front (deep link / reload): skip the wait and go straight to muted.
  const noActivation = !!(navigator.userActivation && !navigator.userActivation.hasBeenActive);

  if (ctl.engine === 'iframe') { /* plain-iframe fallback has no state events to watch */ }
  else if (opts.autoplay === false) { /* viewer asked for no autoplay: nothing to recover from */ }
  else if (opts.muted) {
    // Started muted on purpose: only detect a total block (Low Power Mode, data saver…).
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
    const poll = (roundsLeft) => {
      if (gone || playing || fellBack) return;
      const st = ctl.state();
      if (st === 3 || st === 1) return;                       // loading or playing: sound autoplay works
      if (roundsLeft > 0) timers.push(setTimeout(() => poll(roundsLeft - 1), 700));
      else startMuted();                                       // still unstarted/cued → blocked
    };
    timers.push(setTimeout(() => poll(4), AUTOPLAY_WAIT_MS)); // ~2.2s + 4×0.7s ≈ 5s of unstarted == blocked
  }

  const destroy = ctl.destroy;
  ctl.destroy = () => { gone = true; timers.forEach(clearTimeout); destroy(); };
  return ctl;
}
export { loadYouTube };
