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

const httpOrigin = () => (/^https?:$/.test(location.protocol) ? location.origin : undefined);

export async function createYouTubePlayer(container, videoId, { start = 0, autoplay = true, muted = false, onProgress, onEnded, onState } = {}) {
  container.innerHTML = '';
  const mount = document.createElement('div');
  container.appendChild(mount);
  let YT;
  try { YT = await loadYouTube(); } catch (e) { return plainIframe(container, videoId, start, autoplay); }

  let player, timer, destroyed = false, ready = false;
  const tick = () => {
    if (!ready || destroyed) return;
    try { onProgress?.(player.getCurrentTime(), player.getDuration()); } catch { /* player torn down */ }
  };
  await new Promise((resolve) => {
    player = new YT.Player(mount, {
      videoId,
      width: '100%', height: '100%',
      playerVars: { autoplay: autoplay ? 1 : 0, playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(start), origin: httpOrigin(), iv_load_policy: 3, mute: muted ? 1 : 0 },
      events: {
        onReady: () => { ready = true; resolve(); },
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
    time: () => { try { return player.getCurrentTime(); } catch { return 0; } },
    duration: () => { try { return player.getDuration(); } catch { return 0; } },
    seek: (s) => player.seekTo?.(s, true),
    mute: () => player.mute?.(), unmute: () => { player.unMute?.(); player.setVolume?.(100); }, isMuted: () => !!player.isMuted?.(),
    play: () => player.playVideo?.(),
    pause: () => player.pauseVideo?.(),
    destroy() { destroyed = true; clearInterval(timer); try { player.destroy(); } catch {} container.innerHTML = ''; },
  };
}

function plainIframe(container, videoId, start, autoplay) {
  const o = httpOrigin();
  container.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=${autoplay ? 1 : 0}&playsinline=1&rel=0&modestbranding=1&start=${Math.floor(start)}${o ? '&origin=' + encodeURIComponent(o) : ''}" title="Video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  return { engine: 'iframe', mute() {}, unmute() {}, isMuted: () => false, time: () => 0, duration: () => 0, seek() {}, play() {}, pause() {}, destroy() { container.innerHTML = ''; } };
}
