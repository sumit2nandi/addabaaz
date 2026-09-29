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

export async function createPlayer(container, video, opts) {
  const src = video.source || {};
  if (src.type === 'youtube') return createYouTubePlayer(container, src.id, opts);
  if (src.type === 'mp4' || src.type === 'hls') return createHtml5Player(container, video, opts);
  throw new Error('Unsupported source type: ' + src.type);
}
export { loadYouTube };
