// YouTube player adapter. Loads the IFrame API on demand and wraps it in the shared player interface (see players/index.js). Falls back to a plain iframe if the API is blocked.
// The IFrame API script is loaded once and shared.
let apiPromise = null;
const API_LOAD_TIMEOUT_MS = 8000;
const PLAYER_API_BUDGET_MS = 1500;
const MUTED_AUTOPLAY_FALLBACK_MS = 1200;
const MUTED_AUTOPLAY_BUFFERING_GRACE_MS = 3000;
export function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    let settled = false, timeout;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      if (error) { apiPromise = null; reject(error); }
      else resolve(window.YT);
    };
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { prev?.(); } catch { /* don't strand the player if another ready hook fails */ }
      finish(window.YT?.Player ? null : new Error('YouTube API is not ready'));
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => finish(new Error('YouTube API blocked or offline'));
    timeout = setTimeout(() => finish(window.YT?.Player ? null : new Error('YouTube API timeout')), API_LOAD_TIMEOUT_MS);
    try { document.head.appendChild(s); } catch (err) { finish(err); }
  });
  return apiPromise;
}

// Don't hold playback behind a slow API script: the same YouTube iframe can start directly while the
// IFrame API continues downloading for the next view or reel.
async function loadYouTubeForPlayback(autoplay) {
  const api = loadYouTube();
  let timeout;
  const budget = autoplay ? PLAYER_API_BUDGET_MS : API_LOAD_TIMEOUT_MS;
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('YouTube player API startup is slow')), budget); });
  try { return await Promise.race([api, deadline]); }
  finally { clearTimeout(timeout); }
}

// YouTube needs the page origin for the postMessage handshake, but native apps run on non-http origins.
const httpOrigin = () => (/^https?:$/.test(location.protocol) ? location.origin : undefined);

// Creates the player and a timer that reports playback position (used for Continue Watching and analytics).
export async function createYouTubePlayer(container, videoId, { start = 0, autoplay = true, muted = false, controls = true, onProgress, onEnded, onState } = {}) {
  container.innerHTML = '';
  const mount = document.createElement('div');
  container.appendChild(mount);
  let YT;
  try { YT = await loadYouTubeForPlayback(autoplay); }
  catch (e) {
    // Without the API there is no onAutoplayBlocked signal to recover an unmuted iOS attempt, so
    // preserve automatic motion in the simple iframe by making that fallback muted.
    const fallbackMuted = autoplay ? true : muted;
    return plainIframe(container, videoId, start, autoplay, fallbackMuted, controls);
  }

  let player, timer, mutedFallbackTimer, mutedFallbackStartedAt = 0, destroyed = false, ready = false, mutedFallbackAttempted = false;
  const retryMutedAutoplay = (target = player) => {
    if (!autoplay || muted || mutedFallbackAttempted || destroyed || !target) return;
    mutedFallbackAttempted = true;
    clearTimeout(mutedFallbackTimer); mutedFallbackTimer = null;
    try { target.mute(); target.playVideo(); } catch { /* shared timeout handles a refused fallback */ }
  };
  const tick = () => {
    if (!ready || destroyed) return;
    try { onProgress?.(player.getCurrentTime(), player.getDuration()); } catch { /* player torn down */ }
  };
  await new Promise((resolve) => {
    player = new YT.Player(mount, {
      videoId,
      width: '100%', height: '100%',
      playerVars: { autoplay: autoplay ? 1 : 0, playsinline: 1, controls: controls ? 1 : 0, fs: controls ? 1 : 0, rel: 0, modestbranding: 1, start: Math.floor(start), origin: httpOrigin(), iv_load_policy: 3, cc_load_policy: 0, hl: 'en', mute: muted ? 1 : 0 },
      events: {
        onReady: (event) => {
          ready = true;
          // Start explicitly in the requested mode; iOS gets a sound-first attempt when requested.
          if (autoplay) {
            try { if (muted) event.target.mute(); event.target.playVideo(); }
            catch { /* the browser may still require a tap */ }
            if (!muted && !mutedFallbackAttempted) {
              // Some iOS/YouTube combinations omit onAutoplayBlocked. If the player remains unstarted
              // after the sound-first attempt, retry muted; give genuine network buffering extra time.
              mutedFallbackStartedAt = Date.now();
              const checkMutedFallback = () => {
                if (destroyed || mutedFallbackAttempted) return;
                let state = -1;
                try { state = player.getPlayerState(); } catch { /* treat unreadable state as blocked */ }
                const S = YT.PlayerState || {};
                if (state === S.PLAYING) { mutedFallbackTimer = null; return; }
                if (state === S.BUFFERING && Date.now() - mutedFallbackStartedAt < MUTED_AUTOPLAY_BUFFERING_GRACE_MS) {
                  mutedFallbackTimer = setTimeout(checkMutedFallback, 500);
                  return;
                }
                retryMutedAutoplay(player);
              };
              mutedFallbackTimer = setTimeout(checkMutedFallback, MUTED_AUTOPLAY_FALLBACK_MS);
            }
          }
          resolve();
        },
        // Retry immediately when the browser reports blocked unmuted autoplay; the watchdog above
        // covers WebKit versions which don't emit this event.
        onAutoplayBlocked: (event) => retryMutedAutoplay(event?.target),
        onError: (e) => { clearTimeout(mutedFallbackTimer); onState?.('error', e.data); resolve(); },
        onStateChange: (e) => {
          const S = YT.PlayerState;
          if (e.data === S.PLAYING) { clearTimeout(mutedFallbackTimer); mutedFallbackTimer = null; onState?.('playing'); clearInterval(timer); timer = setInterval(tick, 1000); }
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
    pause: () => { clearTimeout(mutedFallbackTimer); mutedFallbackTimer = null; player.pauseVideo?.(); },
    destroy() { destroyed = true; clearTimeout(mutedFallbackTimer); clearInterval(timer); try { player.destroy(); } catch {} container.innerHTML = ''; },
  };
}

// Last-resort embed with no API (no progress tracking). Keep the requested inline/autoplay parameters;
// createYouTubePlayer passes muted=true for autoplay when sound-block detection is unavailable.
function plainIframe(container, videoId, start, autoplay, muted, controls) {
  const o = httpOrigin();
  container.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=${autoplay ? 1 : 0}&mute=${muted ? 1 : 0}&enablejsapi=1&controls=${controls ? 1 : 0}&fs=${controls ? 1 : 0}&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&cc_load_policy=0&hl=en&start=${Math.floor(start)}${o ? '&origin=' + encodeURIComponent(o) : ''}" title="Video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
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
