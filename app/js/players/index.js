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

// How long to wait for playback to begin before assuming the browser blocked autoplay-with-sound.
const AUTOPLAY_WAIT_MS = 2200;

/** Options (all optional): start, autoplay, muted, controls (false for reels), onProgress, onEnded, onState,
 *  onAutoplayMuted() - autoplay with sound was blocked, so we restarted it muted (show a "tap to unmute" hint),
 *  onAutoplayBlocked() - even muted playback did not start (Low Power Mode etc.); the viewer has to tap play. */
export async function createPlayer(container, video, opts = {}) {
  let playing = false, gone = false;
  // REMOVED: Forced mute based on userActivation.hasBeenActive.
  // Let the browser decide. If it blocks autoplay with sound, onAutoplayMuted will fire.
  const timers = [];
  const wrapped = { ...opts, onState: (s, code) => { if (s === 'playing' || s === 'buffering') playing = true; opts.onState?.(s, code); } };
  const src = video.source || {};
  let ctl;
  if (src.type === 'youtube') ctl = await createYouTubePlayer(container, src.id, wrapped);
  else if (src.type === 'mp4' || src.type === 'hls') ctl = await createHtml5Player(container, video, wrapped);
  else throw new Error('Unsupported source type: ' + src.type);

  /* Mobile browsers (Chrome Android, iOS Safari) only allow autoplay WITH sound after a tap on the page itself, and the player is
   * created asynchronously, so that permission is often gone. Standard remedy: if nothing is playing shortly after start, retry muted
   * (muted autoplay is always allowed) and tell the page so it can offer a "tap to unmute" button. */
  if (ctl.engine === 'iframe') { /* plain-iframe fallback has no state events to watch */ }
  else if (opts.autoplay !== false && !opts.muted) {
    timers.push(setTimeout(() => {
      if (gone || playing) return;
      try { ctl.mute(); Promise.resolve(ctl.play()).catch(() => {}); } catch { /* player already gone */ }
      opts.onAutoplayMuted?.();
      timers.push(setTimeout(() => { if (!gone && !playing) opts.onAutoplayBlocked?.(); }, AUTOPLAY_WAIT_MS));
    }, AUTOPLAY_WAIT_MS));
  } else if (opts.autoplay !== false) {
    timers.push(setTimeout(() => { if (!gone && !playing) opts.onAutoplayBlocked?.(); }, AUTOPLAY_WAIT_MS * 1.5));
  }
  const destroy = ctl.destroy;
  ctl.destroy = () => { gone = true; timers.forEach(clearTimeout); destroy(); };
  return ctl;
}
export { loadYouTube };
