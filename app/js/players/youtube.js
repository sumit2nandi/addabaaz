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

const YT_SETTINGS_ICONS = {
  gear: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
  speed: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M10 8v8l6-4-6-4zm1.5-6C6.25 2 2 6.25 2 11.5S6.25 21 11.5 21 21 16.75 21 11.5 16.75 2 11.5 2zm0 17C7.36 19 4 15.64 4 11.5S7.36 4 11.5 4 19 7.36 19 11.5 15.64 19 11.5 19z"/></svg>',
  loop: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  chevRight: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>',
  chevLeft: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
};
const youtubeSpeedLabel = (rate) => rate === 1 ? 'Normal' : `${rate}x`;

// The embedded YouTube player is cross-origin: keep its built-in quality/captions controls intact,
// and offer a separate app-owned sheet for settings the IFrame API can actually change.
function createYouTubeSettingsSheet(shell, { getPlayer, getLoop, setLoop }) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ytp-youtube-settings-btn';
  trigger.setAttribute('aria-label', 'Player settings');
  trigger.title = 'Player settings';
  trigger.innerHTML = YT_SETTINGS_ICONS.gear;
  shell.appendChild(trigger);

  const overlay = document.createElement('div');
  overlay.className = 'ytp-settings-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <button type="button" class="ytp-settings-scrim" aria-label="Close player settings" tabindex="-1"></button>
    <section class="ytp-settings-sheet" role="dialog" aria-modal="true" aria-label="Player settings" tabindex="-1">
      <div class="ytp-settings-handle" aria-hidden="true"><span></span></div>
      <header class="ytp-settings-header">
        <button type="button" data-settings-back aria-label="Back to settings" hidden>${YT_SETTINGS_ICONS.chevLeft}</button>
        <h2 class="ytp-settings-title">Settings</h2>
        <button type="button" data-settings-close aria-label="Close settings">${YT_SETTINGS_ICONS.close}</button>
      </header>
      <div class="ytp-settings-body"></div>
    </section>`;
  const sheet = overlay.querySelector('.ytp-settings-sheet');
  const body = overlay.querySelector('.ytp-settings-body');
  const title = overlay.querySelector('.ytp-settings-title');
  const back = overlay.querySelector('[data-settings-back]');
  const ensureHost = () => {
    const host = document.fullscreenElement || document.webkitFullscreenElement || document.body || document.documentElement;
    if (host && overlay.parentNode !== host) host.appendChild(overlay);
  };
  const syncScrollLock = () => {
    const open = !!document.querySelector('.ytp-settings-overlay:not([hidden])');
    document.body?.classList.toggle('player-settings-open', open);
  };
  ensureHost();
  let view = null;
  const rates = () => {
    try {
      const result = getPlayer()?.getAvailablePlaybackRates?.();
      const list = Array.isArray(result) ? result.map(Number).filter((rate) => Number.isFinite(rate) && rate > 0) : [1];
      return [...new Set(list.length ? list : [1])].sort((a, b) => a - b);
    } catch { return [1]; }
  };
  const render = (next = 'main', { focus = true } = {}) => {
    const availableRates = rates();
    if (next === 'speed' && availableRates.length < 2) next = 'main';
    view = next;
    ensureHost();
    overlay.hidden = false;
    syncScrollLock();
    const player = getPlayer();
    let selectedRate = 1;
    try { selectedRate = Number(player?.getPlaybackRate?.()) || 1; } catch { /* the player may not be ready yet */ }
    const titles = { main: 'Settings', speed: 'Playback speed' };
    title.textContent = titles[view] || 'Settings';
    back.hidden = view === 'main';
    sheet.setAttribute('aria-label', view === 'main' ? 'Player settings' : `${titles[view]} settings`);
    body.scrollTop = 0;
    if (view === 'main') {
      body.innerHTML = `
        ${availableRates.length > 1 ? `<button type="button" class="ytp-menu-item" data-nav="speed">
          <span class="ytp-menu-lead">${YT_SETTINGS_ICONS.speed}<span>Playback Speed</span></span>
          <span class="ytp-menu-val"><span>${youtubeSpeedLabel(selectedRate)}</span>${YT_SETTINGS_ICONS.chevRight}</span>
        </button>` : ''}
        <button type="button" class="ytp-menu-item" data-act="loop">
          <span class="ytp-menu-lead">${YT_SETTINGS_ICONS.loop}<span>Loop</span></span>
          <span class="ytp-menu-val"><span class="ytp-menu-pill ${getLoop() ? 'on' : ''}">${getLoop() ? 'On' : 'Off'}</span></span>
        </button>
        <p class="ytp-settings-note">Tap the video to reveal YouTube’s controls for quality and subtitles.</p>`;
    } else if (view === 'speed') {
      body.innerHTML = `<div class="ytp-menu-list">
        ${availableRates.map((rate) => `<button type="button" class="ytp-menu-opt ${selectedRate === rate ? 'active' : ''}" data-speed="${rate}">
          <span class="ytp-opt-check">${selectedRate === rate ? YT_SETTINGS_ICONS.check : ''}</span>
          <span>${youtubeSpeedLabel(rate)}</span>
        </button>`).join('')}
      </div>`;
    }
    if (focus) {
      const target = view === 'main' ? body.querySelector('[data-nav], [data-act]') : body.querySelector('.ytp-menu-opt');
      (target || sheet).focus?.({ preventScroll: true });
    }
  };
  const close = (restoreFocus = true) => {
    view = null;
    overlay.hidden = true;
    syncScrollLock();
    if (restoreFocus) trigger.focus?.({ preventScroll: true });
  };
  const onFullscreen = () => ensureHost();
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (view) close(); else render('main');
  });
  overlay.addEventListener('pointerdown', (event) => event.stopPropagation());
  overlay.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target.closest?.('[data-settings-close], .ytp-settings-scrim')) { close(); return; }
    if (event.target.closest?.('[data-settings-back]')) { render('main'); return; }
    if (event.target.closest?.('[data-nav="speed"]')) { render('speed'); return; }
    if (event.target.closest?.('[data-act="loop"]')) { setLoop(!getLoop()); render('main'); return; }
    const speed = event.target.closest?.('[data-speed]');
    if (speed) {
      const rate = Number(speed.getAttribute('data-speed'));
      try { getPlayer()?.setPlaybackRate?.(rate); } catch { /* YouTube may refuse a rate not supported by this upload */ }
      close();
    }
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...sheet.querySelectorAll('button')].filter((button) => !button.hidden && !button.disabled);
    if (!buttons.length) { event.preventDefault(); sheet.focus?.(); return; }
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      event.preventDefault(); last.focus?.();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus?.();
    }
  });
  document.addEventListener('fullscreenchange', onFullscreen);
  document.addEventListener('webkitfullscreenchange', onFullscreen);

  return {
    refresh() { if (view) render(view, { focus: false }); },
    destroy() {
      close(false);
      overlay.remove();
      trigger.remove();
      syncScrollLock();
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
    },
  };
}

// Creates the player and a timer that reports playback position (used for Continue Watching and analytics).
export async function createYouTubePlayer(container, videoId, { start = 0, autoplay = true, muted = false, controls = true, onProgress, onEnded, onState } = {}) {
  container.innerHTML = '';
  const mount = document.createElement('div');
  let shell = null;
  if (controls) {
    shell = document.createElement('div');
    shell.className = 'ytp-youtube-shell';
    shell.appendChild(mount);
    container.appendChild(shell);
  } else container.appendChild(mount);
  let YT;
  try { YT = await loadYouTubeForPlayback(autoplay); }
  catch (e) {
    // The plain iframe must honor the requested sound mode too. If browser policy blocks unmuted
    // autoplay, the browser requires a user gesture; do not silently change the viewer's preference.
    return plainIframe(container, videoId, start, autoplay, muted, controls);
  }

  let player, timer, mutedFallbackTimer, mutedFallbackStartedAt = 0, destroyed = false, ready = false, mutedFallbackAttempted = false, loopEnabled = false;
  const settingsUI = controls && shell ? createYouTubeSettingsSheet(shell, {
    getPlayer: () => player,
    getLoop: () => loopEnabled,
    setLoop: (value) => { loopEnabled = !!value; },
  }) : null;
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
          settingsUI?.refresh();
          // Start explicitly in the requested mode; a muted retry is only for a refused sound-first attempt.
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
        onApiChange: () => settingsUI?.refresh(),
        onPlaybackRateChange: () => settingsUI?.refresh(),
        onError: (e) => { clearTimeout(mutedFallbackTimer); onState?.('error', e.data); resolve(); },
        onStateChange: (e) => {
          const S = YT.PlayerState;
          if (e.data === S.PLAYING) { clearTimeout(mutedFallbackTimer); mutedFallbackTimer = null; onState?.('playing'); clearInterval(timer); timer = setInterval(tick, 1000); }
          else if (e.data === S.PAUSED) { onState?.('paused'); tick(); clearInterval(timer); }
          else if (e.data === S.ENDED) {
            clearInterval(timer); timer = null; tick();
            if (loopEnabled && !destroyed) {
              try { player.seekTo(0, true); player.playVideo(); } catch { /* the embedded player may have been removed */ }
            } else { onState?.('ended'); onEnded?.(); }
          }
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
    destroy() { destroyed = true; settingsUI?.destroy(); clearTimeout(mutedFallbackTimer); clearInterval(timer); try { player.destroy(); } catch {} container.innerHTML = ''; },
  };
}

// Last-resort embed with no API (no progress tracking). Keep the requested mute mode and inline/autoplay parameters.
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
