// YouTube player adapter. Loads the IFrame API on demand and wraps it in the shared player interface (see players/index.js). Falls back to a plain iframe if the API is blocked.
// The IFrame API script is loaded once and shared.
let apiPromise = null;
export function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error('YouTube API blocked or offline')); };
    document.head.appendChild(s);
    setTimeout(() => { if (!window.YT?.Player) { apiPromise = null; reject(new Error('YouTube API timeout')); } }, 8000);
  });
  return apiPromise;
}

// YouTube needs the page origin for the postMessage handshake, but native apps run on non-http origins.
const httpOrigin = () => (/^https?:$/.test(location.protocol) ? location.origin : undefined);

// Creates the player and a timer that reports playback position (used for Continue Watching and analytics).
export async function createYouTubePlayer(container, videoId, { start = 0, autoplay = true, muted = false, controls = true, onProgress, onEnded, onState } = {}) {
  container.innerHTML = '';
  const mount = document.createElement('div');
  container.appendChild(mount);
  let YT;
  try { YT = await loadYouTube(); } catch (e) { return plainIframe(container, videoId, start, autoplay, muted, controls); }

  let player, timer, destroyed = false, ready = false;
  const tick = () => {
    if (!ready || destroyed) return;
    try { onProgress?.(player.getCurrentTime(), player.getDuration()); } catch { /* player torn down */ }
  };
  await new Promise((resolve) => {
    player = new YT.Player(mount, {
      videoId,
      width: '100%', height: '100%',
      playerVars: { autoplay: autoplay ? 1 : 0, playsinline: 1, controls: controls ? 1 : 0, rel: 0, modestbranding: 1, start: Math.floor(start), origin: httpOrigin(), iv_load_policy: 3, mute: muted ? 1 : 0 },
      events: {
        onReady: (event) => {
          ready = true;
          // Enforce the muted inline start on YouTube's actual iOS iframe, not just in the URL
          // parameters. The extra play command is harmless on desktop and helps WebKit start reliably.
          if (autoplay && muted) { try { event.target.mute(); event.target.playVideo(); } catch { /* the browser may still require a tap */ } }
          resolve();
        },
        onError: (e) => { onState?.('error', e.data); resolve(); },
        onStateChange: (e) => {
          const S = YT.PlayerState;
          if (e.data === S.PLAYING) { onState?.('playing'); clearInterval(timer); timer = setInterval(tick, 1000); }
          else if (e.data === S.PAUSED) { onState?.('paused'); tick(); clearInterval(timer); }
          else if (e.data === S.ENDED) { clearInterval(timer); tick(); onState?.('ended'); onEnded?.(); }
          else if (e.data === S.BUFFERING) onState?.('buffering');
        },
      },
    });
  });
  return {
    engine: 'youtube',
    /** PlayerState code (-1 unstarted, 5 cued, 3 buffering, 1 playing…) so the autoplay fallback can tell "blocked" from "still loading".
     *  A player whose state is unreadable is NOT playing: report unstarted so the muted fallback still fires
     *  (returning "playing" here used to leave broken embeds stuck on the loading spinner forever on phones). */
    state: () => { try { return player.getPlayerState(); } catch { return -1; } },
    time: () => { try { return player.getCurrentTime(); } catch { return 0; } },
    duration: () => { try { return player.getDuration(); } catch { return 0; } },
    seek: (s) => player.seekTo?.(s, true),
    mute: () => player.mute?.(), unmute: () => { player.unMute?.(); player.setVolume?.(100); }, isMuted: () => !!player.isMuted?.(),
    play: () => player.playVideo?.(),
    pause: () => player.pauseVideo?.(),
    destroy() { destroyed = true; clearInterval(timer); try { player.destroy(); } catch {} container.innerHTML = ''; },
  };
}

// Last-resort embed with no API (no progress tracking). Same trick as main's createVideoPlayer(): the
// iframe loads with mute=1 (autoplay is then allowed instantly) and the mute is lifted through the
// postMessage command API on the 600/1500/3000ms schedule, so it still starts with volume.
function plainIframe(container, videoId, start, autoplay, muted, controls) {
  const o = httpOrigin();
  container.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=${autoplay ? 1 : 0}&mute=${muted ? 1 : 0}&enablejsapi=1&controls=${controls ? 1 : 0}&playsinline=1&rel=0&modestbranding=1&start=${Math.floor(start)}${o ? '&origin=' + encodeURIComponent(o) : ''}" title="Video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  const iframe = container.querySelector('iframe');
  let isMuted = !!muted;
  const cmd = (line) => { try { iframe?.contentWindow?.postMessage(line, '*'); } catch { /* frame already gone */ } };
  return {
    engine: 'iframe',
    mute() { isMuted = true; cmd('{"event":"command","func":"mute","args":""}'); },
    unmute() { isMuted = false; cmd('{"event":"command","func":"unMute","args":""}'); cmd('{"event":"command","func":"setVolume","args":"[100]"}'); },
    isMuted: () => isMuted,
    // Drive the frame through the postMessage command API (enablejsapi=1) so the custom controls
    // still work on native even when the IFrame API itself failed to load.
    play() { cmd('{"event":"command","func":"playVideo","args":""}'); },
    pause() { cmd('{"event":"command","func":"pauseVideo","args":""}'); },
    seek(s) { cmd(`{"event":"command","func":"seekTo","args":[${Math.max(0, Math.floor(s))},true]}`); },
    time: () => 0, duration: () => 0,
    destroy() { container.innerHTML = ''; },
  };
}
