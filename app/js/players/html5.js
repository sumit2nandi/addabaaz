// hls.js (needed for HLS in browsers without native support) is downloaded only when an HLS video is played.
let hlsPromise = null;
const loadHls = () => hlsPromise || (hlsPromise = new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
  s.onload = () => res(window.Hls); s.onerror = () => rej(new Error('hls.js failed to load'));
  document.head.appendChild(s);
}));

// Format seconds as M:SS or H:MM:SS (YouTube time display format).
function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

// Inline SVG icons matching YouTube's player iconography.
const YT_ICONS = {
  play: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>',
  back10: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="15.5" text-anchor="middle" font-size="7.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><text x="12" y="15.5" text-anchor="middle" font-size="7.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">10</text></svg>',
  volHigh: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
  volLow: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M7 9v6h4l5 5V4l-5 5H7zm9.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>',
  volMute: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>',
  cc: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
  pip: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>',
  fsEnter: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
  fsExit: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>',
  speed: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M10 8v8l6-4-6-4zm1.5-6C6.25 2 2 6.25 2 11.5S6.25 21 11.5 21 21 16.75 21 11.5 16.75 2 11.5 2zm0 17C7.36 19 4 15.64 4 11.5S7.36 4 11.5 4 19 7.36 19 11.5 15.64 19 11.5 19z"/></svg>',
  quality: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>',
  loop: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  chevRight: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>',
  chevLeft: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const speedLabel = (r) => (r === 1 ? 'Normal' : `${r}x`);
const resLabel = (h) => {
  if (!h || h <= 0) return 'Auto';
  if (h >= 2160) return '2160p 4K';
  if (h >= 1440) return '1440p HD';
  if (h >= 1080) return '1080p HD';
  if (h >= 720) return '720p HD';
  if (h >= 480) return '480p';
  if (h >= 360) return '360p';
  return `${h}p`;
};

/** Subtitle files are fetched by us and attached as same-origin blob: URLs, so they work with any player origin and need no crossorigin attribute on the video. */
async function attachSubtitles(v, tracks = [], onChange) {
  let pref = null;
  try { pref = localStorage.getItem('ab.subLang'); } catch { /* ignore */ }
  for (const t of tracks) {
    try {
      const r = await fetch(t.url); if (!r.ok) continue;
      const el = document.createElement('track'); el.kind = 'subtitles'; el.label = t.label; el.srclang = t.lang;
      el.src = URL.createObjectURL(new Blob([await r.text()], { type: 'text/vtt' }));
      if (pref === t.lang) el.default = true;
      v.appendChild(el);
    } catch { /* one broken subtitle file must not stop the video */ }
  }
  const apply = () => {
    if (pref && pref !== 'off') {
      for (const tt of v.textTracks || []) tt.mode = tt.language === pref ? 'showing' : 'disabled';
    }
    onChange?.();
  };
  apply();
  v.textTracks?.addEventListener?.('addtrack', apply);
  v.textTracks?.addEventListener?.('change', () => {
    const on = [...(v.textTracks || [])].find((tt) => tt.mode === 'showing');
    try { localStorage.setItem('ab.subLang', on ? on.language : 'off'); } catch { /* ignore */ }
    onChange?.();
  });
}

// Plays MP4/MOV/WebM or HLS (including protected R2 video) in a <video> element wrapped in a YouTube-style
// player UI and settings menu (Playback speed, Quality, Subtitles/CC, Loop, PiP, Fullscreen) when controls !== false.
export async function createHtml5Player(container, video, { start = 0, autoplay = true, muted = false, controls = true, onProgress, onEnded, onState, onDimensions } = {}) {
  container.innerHTML = '';
  const v = document.createElement('video');
  v.className = 'ytp-video';
  v.controls = false;
  v.muted = muted;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.autoplay = autoplay;
  v.preload = 'metadata';
  v.setAttribute('controlsList', 'nodownload');
  if (video.poster) v.poster = video.poster;

  // Restore saved playback speed if the viewer picked one earlier in the session.
  let savedSpeed = 1;
  try {
    const sp = Number(sessionStorage.getItem('ab.playbackRate'));
    if (SPEEDS.includes(sp)) { savedSpeed = sp; v.playbackRate = sp; }
  } catch { /* ignore */ }

  let hls = null, lastEmit = 0, selectedQuality = -1; // -1 = Auto
  let uiUpdate = () => {}, uiCleanup = () => {};

  if (!controls) {
    container.appendChild(v);
  } else {
    const wrap = buildYouTubeUI(container, v, video, {
      getHls: () => hls,
      getSelectedQuality: () => selectedQuality,
      setSelectedQuality: (lvl) => {
        selectedQuality = lvl;
        if (hls) hls.currentLevel = lvl;
        uiUpdate();
      },
    });
    uiUpdate = wrap.update;
    uiCleanup = wrap.cleanup;
  }

  const subs = attachSubtitles(v, video.subtitles, () => uiUpdate());

  const { type, url } = video.source;
  if (type === 'hls' && !v.canPlayType?.('application/vnd.apple.mpegurl')) {
    const Hls = await loadHls();
    if (Hls.isSupported()) {
      hls = new Hls({ startPosition: start || -1 });
      hls.on?.(Hls.Events?.MANIFEST_PARSED || 'hlsManifestParsed', () => uiUpdate());
      hls.on?.(Hls.Events?.LEVEL_SWITCHED || 'hlsLevelSwitched', () => uiUpdate());
      hls.on?.(Hls.Events?.ERROR || 'hlsError', (_e, d) => { if (d?.fatal) onState?.('error', d.response?.code === 404 ? 4 : 2); });
      hls.loadSource(url);
      hls.attachMedia(v);
    } else {
      throw Object.assign(new Error('This video format isn’t supported on your device.'), { friendly: true });
    }
  } else {
    v.src = url;
  }

  v.addEventListener('loadedmetadata', () => {
    if (start > 0 && !hls) v.currentTime = start;
    onDimensions?.(v.videoWidth, v.videoHeight);
    uiUpdate();
  }, { once: true });
  v.addEventListener('durationchange', () => uiUpdate());
  v.addEventListener('progress', () => uiUpdate());
  v.addEventListener('ratechange', () => uiUpdate());
  v.addEventListener('volumechange', () => uiUpdate());
  v.addEventListener('timeupdate', () => {
    uiUpdate();
    const n = Date.now();
    if (n - lastEmit > 1000) { lastEmit = n; onProgress?.(v.currentTime, v.duration || 0); }
  });
  v.addEventListener('playing', () => { uiUpdate(); onState?.('playing'); });
  v.addEventListener('pause', () => { uiUpdate(); onProgress?.(v.currentTime, v.duration || 0); onState?.('paused'); });
  v.addEventListener('waiting', () => { uiUpdate(); onState?.('buffering'); });
  v.addEventListener('error', () => { uiUpdate(); onState?.('error', v.error?.code); });
  v.addEventListener('ended', () => { uiUpdate(); onState?.('ended'); onEnded?.(); });

  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof window !== 'undefined' && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: video.title, artist: 'ADDABAAZ', artwork: video.poster ? [{ src: video.poster }] : [] });
    navigator.mediaSession.setActionHandler('play', () => v.play());
    navigator.mediaSession.setActionHandler('pause', () => v.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => { v.currentTime = Math.max(0, v.currentTime - 10); });
    navigator.mediaSession.setActionHandler('seekforward', () => { v.currentTime += 10; });
  }

  let playPromise = null;
  if (autoplay) {
    playPromise = v.play();
    if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => { /* needs a tap */ });
  }
  await Promise.race([subs, new Promise((r) => setTimeout(r, 1500))]);
  const remote = v.remote, airplay = typeof v.webkitShowPlaybackTargetPicker === 'function';
  return {
    engine: type,
    playPromise,
    castSupported: () => !!(remote?.prompt || airplay),
    cast: async () => { if (remote?.prompt) await remote.prompt(); else if (airplay) v.webkitShowPlaybackTargetPicker(); },
    hasSubtitles: () => (v.textTracks?.length || 0) > 0,
    time: () => v.currentTime,
    duration: () => v.duration || 0,
    mute: () => { v.muted = true; uiUpdate(); },
    unmute: () => { v.muted = false; if (v.volume === 0) v.volume = 1; uiUpdate(); },
    isMuted: () => v.muted,
    seek: (s) => { v.currentTime = s; uiUpdate(); },
    play: () => v.play(),
    pause: () => v.pause(),
    destroy() {
      uiCleanup();
      hls?.destroy();
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
      container.innerHTML = '';
    },
  };
}

// Builds the YouTube-look player shell, scrubber, control bar, double-tap seek, and Settings menu around <video>.
function buildYouTubeUI(container, v, video, { getHls, getSelectedQuality, setSelectedQuality }) {
  const wrap = document.createElement('div');
  wrap.className = 'ytp is-paused show-controls';
  wrap.tabIndex = 0;
  const initDur = fmtTime(video.duration || 0);
  wrap.innerHTML = `
    <div class="ytp-video-slot"></div>
    <div class="ytp-top-gradient"></div>
    <div class="ytp-spinner" aria-hidden="true"><svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke-width="4"/></svg></div>
    <div class="ytp-bezel" aria-hidden="true"><div class="ytp-bezel-icon">${YT_ICONS.play}</div></div>
    <div class="ytp-seek-ind left" aria-hidden="true"><span>« 10s</span></div>
    <div class="ytp-seek-ind right" aria-hidden="true"><span>10s »</span></div>
    <div class="ytp-menu" hidden role="menu" aria-label="Player settings"></div>
    <div class="ytp-chrome">
      <div class="ytp-progress" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="${Math.round(video.duration || 0)}" aria-valuenow="0">
        <div class="ytp-hover-time" hidden>0:00</div>
        <div class="ytp-bar-bg">
          <div class="ytp-bar-buf"></div>
          <div class="ytp-bar-play"><span class="ytp-scrubber-dot"></span></div>
        </div>
      </div>
      <div class="ytp-bar">
        <div class="ytp-left">
          <button type="button" class="ytp-btn ytp-play" aria-label="Play">${YT_ICONS.play}</button>
          <button type="button" class="ytp-btn ytp-skip-back" aria-label="Rewind 10 seconds" title="Rewind 10s">${YT_ICONS.back10}</button>
          <button type="button" class="ytp-btn ytp-skip-fwd" aria-label="Forward 10 seconds" title="Forward 10s">${YT_ICONS.fwd10}</button>
          <div class="ytp-vol-group">
            <button type="button" class="ytp-btn ytp-vol-btn" aria-label="Mute">${YT_ICONS.volHigh}</button>
            <input type="range" class="ytp-vol-slider" min="0" max="1" step="0.05" value="1" aria-label="Volume">
          </div>
          <div class="ytp-time"><span class="ytp-cur">0:00</span><span class="ytp-sep"> / </span><span class="ytp-dur">${initDur}</span></div>
        </div>
        <div class="ytp-right">
          <button type="button" class="ytp-btn ytp-cc-btn" aria-label="Subtitles/closed captions" title="Subtitles/closed captions (c)" hidden>${YT_ICONS.cc}</button>
          <button type="button" class="ytp-btn ytp-gear-btn" aria-label="Settings" aria-expanded="false" title="Settings">${YT_ICONS.gear}<span class="ytp-gear-badge" hidden>HD</span></button>
          <button type="button" class="ytp-btn ytp-pip-btn" aria-label="Picture-in-Picture" title="Miniplayer / Picture-in-Picture" hidden>${YT_ICONS.pip}</button>
          <button type="button" class="ytp-btn ytp-fs-btn" aria-label="Full screen" title="Full screen (f)">${YT_ICONS.fsEnter}</button>
        </div>
      </div>
    </div>`;
  wrap.querySelector('.ytp-video-slot').appendChild(v);
  container.appendChild(wrap);

  const $ = (sel) => wrap.querySelector(sel);
  const playBtn = $('.ytp-play');
  const backBtn = $('.ytp-skip-back');
  const fwdBtn = $('.ytp-skip-fwd');
  const volBtn = $('.ytp-vol-btn');
  const volSlider = $('.ytp-vol-slider');
  const curEl = $('.ytp-cur');
  const durEl = $('.ytp-dur');
  const prog = $('.ytp-progress');
  const hoverTime = $('.ytp-hover-time');
  const bufBar = $('.ytp-bar-buf');
  const playBar = $('.ytp-bar-play');
  const ccBtn = $('.ytp-cc-btn');
  const gearBtn = $('.ytp-gear-btn');
  const gearBadge = $('.ytp-gear-badge');
  const pipBtn = $('.ytp-pip-btn');
  const fsBtn = $('.ytp-fs-btn');
  const menu = $('.ytp-menu');
  const bezel = $('.ytp-bezel');
  const bezelIcon = $('.ytp-bezel-icon');
  const seekLeft = $('.ytp-seek-ind.left');
  const seekRight = $('.ytp-seek-ind.right');

  // Enable PiP button when supported.
  const pipSupported = !!(
    (typeof document !== 'undefined' && document.pictureInPictureEnabled && !v.disablePictureInPicture) ||
    typeof v.webkitSetPresentationMode === 'function'
  );
  if (pipSupported) pipBtn.hidden = false;

  // Auto-hide controls after 3s of playback inactivity (keep visible when paused, scrubbing, or settings menu open).
  let hideTimer = null, menuView = null, scrubbing = false;
  const showControls = () => {
    wrap.classList.add('show-controls');
    clearTimeout(hideTimer);
    if (!v.paused && !v.ended && !menuView && !scrubbing) {
      hideTimer = setTimeout(() => {
        if (!v.paused && !v.ended && !menuView && !scrubbing) wrap.classList.remove('show-controls');
      }, 3000);
      hideTimer.unref?.();
    }
  };

  // Pulse the YouTube center bezel icon briefly on play/pause.
  let bezelTimer = null;
  const flashBezel = (svg) => {
    bezelIcon.innerHTML = svg;
    bezel.classList.remove('animate');
    void bezel.offsetWidth;
    bezel.classList.add('animate');
    clearTimeout(bezelTimer);
    bezelTimer = setTimeout(() => bezel.classList.remove('animate'), 520);
    bezelTimer.unref?.();
  };

  const togglePlay = () => {
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      flashBezel(YT_ICONS.play);
    } else {
      v.pause();
      flashBezel(YT_ICONS.pause);
    }
    showControls();
  };

  let seekIndTimer = null;
  const skipBy = (delta) => {
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
    v.currentTime = Math.max(0, Math.min(d, (v.currentTime || 0) + delta));
    const ind = delta < 0 ? seekLeft : seekRight;
    ind.classList.add('active');
    clearTimeout(seekIndTimer);
    seekIndTimer = setTimeout(() => { seekLeft.classList.remove('active'); seekRight.classList.remove('active'); }, 550);
    showControls();
    update();
  };

  // Tap/click and double-tap handling on the video surface (like YouTube).
  let lastTapAt = 0, singleTapTimer = null;
  wrap.querySelector('.ytp-video-slot')?.addEventListener('click', (e) => {
    if (menuView) { closeMenu(); return; }
    const now = Date.now();
    const rect = wrap.getBoundingClientRect?.() || { left: 0, width: 300 };
    const relX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    if (now - lastTapAt < 280 && (relX < 0.35 || relX > 0.65)) {
      clearTimeout(singleTapTimer);
      lastTapAt = 0;
      skipBy(relX < 0.35 ? -10 : 10);
      return;
    }
    lastTapAt = now;
    const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
    if (isTouch) {
      singleTapTimer = setTimeout(() => {
        if (wrap.classList.contains('show-controls') && !v.paused) {
          togglePlay();
        } else if (!wrap.classList.contains('show-controls')) {
          showControls();
        } else {
          togglePlay();
        }
      }, 220);
    } else {
      togglePlay();
    }
  });

  wrap.addEventListener('pointermove', () => showControls());
  wrap.addEventListener('pointerleave', () => {
    if (!v.paused && !v.ended && !menuView && !scrubbing) wrap.classList.remove('show-controls');
  });

  playBtn?.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
  backBtn?.addEventListener('click', (e) => { e.stopPropagation(); skipBy(-10); });
  fwdBtn?.addEventListener('click', (e) => { e.stopPropagation(); skipBy(10); });

  // Volume button & slider.
  volBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 1;
    update();
    showControls();
  });
  volSlider?.addEventListener('input', (e) => {
    e.stopPropagation();
    const val = Number(volSlider.value);
    v.volume = Number.isFinite(val) ? val : 1;
    v.muted = v.volume === 0;
    update();
    showControls();
  });

  // Scrubber / Timeline bar (hover preview + drag seek).
  const ratioFromEvent = (e) => {
    const r = prog.getBoundingClientRect?.() || { left: 0, width: 1 };
    return Math.max(0, Math.min(1, ((e.clientX ?? 0) - r.left) / (r.width || 1)));
  };
  const previewAt = (e) => {
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (video.duration || 0);
    const ratio = ratioFromEvent(e);
    if (d > 0 && hoverTime) {
      hoverTime.hidden = false;
      hoverTime.textContent = fmtTime(ratio * d);
      hoverTime.style.left = `${(ratio * 100).toFixed(2)}%`;
    }
    return { ratio, d };
  };
  prog?.addEventListener('pointermove', (e) => {
    const { ratio, d } = previewAt(e);
    if (scrubbing && d > 0) {
      playBar.style.width = `${(ratio * 100).toFixed(2)}%`;
      curEl.textContent = fmtTime(ratio * d);
    }
  });
  prog?.addEventListener('pointerleave', () => { if (!scrubbing && hoverTime) hoverTime.hidden = true; });
  prog?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    scrubbing = true;
    prog.classList.add('is-scrubbing');
    prog.setPointerCapture?.(e.pointerId);
    const { ratio, d } = previewAt(e);
    if (d > 0) v.currentTime = ratio * d;
    update();
  });
  prog?.addEventListener('pointerup', (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    prog.classList.remove('is-scrubbing');
    if (hoverTime) hoverTime.hidden = true;
    const { ratio, d } = previewAt(e);
    if (d > 0) v.currentTime = ratio * d;
    showControls();
    update();
  });

  // Subtitles / CC button.
  const getTracks = () => [...(v.textTracks || [])];
  const activeTrack = () => getTracks().find((t) => t.mode === 'showing') || null;
  const setTrack = (lang) => {
    for (const t of getTracks()) t.mode = lang && t.language === lang ? 'showing' : 'disabled';
    try { localStorage.setItem('ab.subLang', lang || 'off'); } catch { /* ignore */ }
    update();
  };
  ccBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const tracks = getTracks();
    if (!tracks.length) return;
    const cur = activeTrack();
    setTrack(cur ? null : tracks[0].language);
    showControls();
  });

  // Picture-in-Picture toggle.
  pipBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (v.requestPictureInPicture) await v.requestPictureInPicture();
      else if (typeof v.webkitSetPresentationMode === 'function') {
        v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      }
    } catch { /* ignore */ }
  });

  // Fullscreen toggle (works on desktop, Android WebView FullscreenClient, and iOS Safari).
  const isFullscreen = () => !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    v.webkitDisplayingFullscreen
  );
  const toggleFullscreen = async () => {
    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (v.webkitExitFullscreen) v.webkitExitFullscreen();
      } else if (wrap.requestFullscreen) {
        await wrap.requestFullscreen();
      } else if (wrap.webkitRequestFullscreen) {
        wrap.webkitRequestFullscreen();
      } else if (v.webkitEnterFullscreen) {
        v.webkitEnterFullscreen();
      } else if (v.requestFullscreen) {
        await v.requestFullscreen();
      }
    } catch {
      try { v.webkitEnterFullscreen?.(); } catch { /* ignore */ }
    }
    update();
  };
  fsBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', () => update());
    document.addEventListener('webkitfullscreenchange', () => update());
  }
  v.addEventListener('webkitbeginfullscreen', () => update());
  v.addEventListener('webkitendfullscreen', () => update());

  // Settings Menu (Playback speed, Quality, Subtitles/CC, Loop).
  const closeMenu = () => {
    menuView = null;
    menu.hidden = true;
    gearBtn.classList.remove('is-open');
    gearBtn.setAttribute('aria-expanded', 'false');
  };

  const qualityOptions = () => {
    const h = getHls();
    if (h?.levels?.length > 1) {
      const seen = new Set();
      const items = [{ id: -1, label: 'Auto', sub: h.levels[h.currentLevel]?.height ? `(${resLabel(h.levels[h.currentLevel].height)})` : '' }];
      h.levels
        .map((lv, idx) => ({ idx, height: lv.height || 0 }))
        .sort((a, b) => b.height - a.height)
        .forEach(({ idx, height }) => {
          const lbl = resLabel(height);
          if (!seen.has(lbl)) { seen.add(lbl); items.push({ id: idx, label: lbl, sub: '' }); }
        });
      return items;
    }
    const nativeH = v.videoHeight || 0;
    const items = [{ id: -1, label: 'Auto', sub: nativeH ? `(${resLabel(nativeH)})` : '' }];
    if (nativeH > 0) items.push({ id: 0, label: resLabel(nativeH), sub: '' });
    return items;
  };

  const currentQualitySummary = () => {
    const sel = getSelectedQuality();
    const opts = qualityOptions();
    const found = opts.find((o) => o.id === sel) || opts[0];
    return `${found.label}${found.sub ? ' ' + found.sub : ''}`;
  };

  const renderMenu = (view = 'main') => {
    menuView = view;
    menu.hidden = false;
    gearBtn.classList.add('is-open');
    gearBtn.setAttribute('aria-expanded', 'true');
    const tracks = getTracks();
    const curSub = activeTrack();

    if (view === 'main') {
      menu.innerHTML = `
        <button type="button" class="ytp-menu-item" data-nav="speed">
          <span class="ytp-menu-lead">${YT_ICONS.speed}<span>Playback speed</span></span>
          <span class="ytp-menu-val"><span>${speedLabel(v.playbackRate || 1)}</span>${YT_ICONS.chevRight}</span>
        </button>
        <button type="button" class="ytp-menu-item" data-nav="quality">
          <span class="ytp-menu-lead">${YT_ICONS.quality}<span>Quality</span></span>
          <span class="ytp-menu-val"><span>${currentQualitySummary()}</span>${YT_ICONS.chevRight}</span>
        </button>
        <button type="button" class="ytp-menu-item" data-nav="subs">
          <span class="ytp-menu-lead">${YT_ICONS.cc}<span>Subtitles/CC</span></span>
          <span class="ytp-menu-val"><span>${curSub ? curSub.label || curSub.language : 'Off'}</span>${YT_ICONS.chevRight}</span>
        </button>
        <button type="button" class="ytp-menu-item" data-act="loop">
          <span class="ytp-menu-lead">${YT_ICONS.loop}<span>Loop</span></span>
          <span class="ytp-menu-val"><span class="ytp-menu-pill ${v.loop ? 'on' : ''}">${v.loop ? 'On' : 'Off'}</span></span>
        </button>`;
    } else if (view === 'speed') {
      menu.innerHTML = `
        <button type="button" class="ytp-menu-head" data-nav="main">${YT_ICONS.chevLeft}<span>Playback speed</span></button>
        <div class="ytp-menu-list">
          ${SPEEDS.map((s) => `<button type="button" class="ytp-menu-opt ${(v.playbackRate || 1) === s ? 'active' : ''}" data-speed="${s}">
            <span class="ytp-opt-check">${(v.playbackRate || 1) === s ? YT_ICONS.check : ''}</span>
            <span>${speedLabel(s)}</span>
          </button>`).join('')}
        </div>`;
    } else if (view === 'quality') {
      const sel = getSelectedQuality();
      menu.innerHTML = `
        <button type="button" class="ytp-menu-head" data-nav="main">${YT_ICONS.chevLeft}<span>Quality</span></button>
        <div class="ytp-menu-list">
          ${qualityOptions().map((o) => `<button type="button" class="ytp-menu-opt ${sel === o.id ? 'active' : ''}" data-quality="${o.id}">
            <span class="ytp-opt-check">${sel === o.id ? YT_ICONS.check : ''}</span>
            <span>${o.label} ${o.sub ? `<small class="ytp-opt-sub">${o.sub}</small>` : ''}</span>
          </button>`).join('')}
        </div>`;
    } else if (view === 'subs') {
      menu.innerHTML = `
        <button type="button" class="ytp-menu-head" data-nav="main">${YT_ICONS.chevLeft}<span>Subtitles/CC</span></button>
        <div class="ytp-menu-list">
          <button type="button" class="ytp-menu-opt ${!curSub ? 'active' : ''}" data-sub="">
            <span class="ytp-opt-check">${!curSub ? YT_ICONS.check : ''}</span>
            <span>Off</span>
          </button>
          ${tracks.map((t) => `<button type="button" class="ytp-menu-opt ${curSub === t ? 'active' : ''}" data-sub="${t.language}">
            <span class="ytp-opt-check">${curSub === t ? YT_ICONS.check : ''}</span>
            <span>${t.label || t.language}</span>
          </button>`).join('')}
        </div>`;
    }
  };

  gearBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuView) closeMenu();
    else renderMenu('main');
    showControls();
  });

  menu?.addEventListener('click', (e) => {
    e.stopPropagation();
    const nav = e.target.closest?.('[data-nav]');
    if (nav) { renderMenu(nav.getAttribute('data-nav')); return; }
    const act = e.target.closest?.('[data-act="loop"]');
    if (act) { v.loop = !v.loop; renderMenu('main'); return; }
    const sp = e.target.closest?.('[data-speed]');
    if (sp) {
      const rate = Number(sp.getAttribute('data-speed')) || 1;
      v.playbackRate = rate;
      try { sessionStorage.setItem('ab.playbackRate', String(rate)); } catch { /* ignore */ }
      closeMenu();
      update();
      return;
    }
    const q = e.target.closest?.('[data-quality]');
    if (q) {
      setSelectedQuality(Number(q.getAttribute('data-quality')));
      closeMenu();
      update();
      return;
    }
    const sb = e.target.closest?.('[data-sub]');
    if (sb) {
      setTrack(sb.getAttribute('data-sub') || null);
      closeMenu();
      return;
    }
  });

  // Keyboard shortcuts when player is focused (Space/K play, Left/Right 5s, J/L 10s, M mute, F fullscreen, C captions).
  wrap.addEventListener('keydown', (e) => {
    if (e.target?.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'k' || e.key === 'K') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); skipBy(-5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); skipBy(5); }
    else if (e.key === 'j' || e.key === 'J') { e.preventDefault(); skipBy(-10); }
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); skipBy(10); }
    else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); v.muted = !v.muted; update(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
    else if (e.key === 'Escape' && menuView) { e.preventDefault(); closeMenu(); }
  });

  // Sync UI with current <video> state.
  function update() {
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (video.duration || 0);
    const cur = Number.isFinite(v.currentTime) && v.currentTime >= 0 ? v.currentTime : 0;
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;

    wrap.classList.toggle('is-paused', !!(v.paused || v.ended));
    wrap.classList.toggle('is-playing', !v.paused && !v.ended);
    wrap.classList.toggle('is-buffering', v.readyState > 0 && v.readyState < 3 && !v.paused && !v.ended);

    if (playBtn) {
      playBtn.innerHTML = v.ended ? YT_ICONS.replay : v.paused ? YT_ICONS.play : YT_ICONS.pause;
      playBtn.setAttribute('aria-label', v.ended ? 'Replay' : v.paused ? 'Play' : 'Pause');
    }
    if (volBtn) {
      const vol = v.muted ? 0 : (v.volume ?? 1);
      volBtn.innerHTML = vol === 0 ? YT_ICONS.volMute : vol < 0.5 ? YT_ICONS.volLow : YT_ICONS.volHigh;
      volBtn.setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute');
      if (volSlider) volSlider.value = String(vol);
    }
    if (!scrubbing && playBar) playBar.style.width = `${pct.toFixed(2)}%`;
    if (bufBar && dur > 0 && v.buffered?.length) {
      try {
        const end = v.buffered.end(v.buffered.length - 1);
        bufBar.style.width = `${Math.min(100, (end / dur) * 100).toFixed(2)}%`;
      } catch { /* ignore */ }
    }
    if (!scrubbing && curEl) curEl.textContent = fmtTime(cur);
    if (durEl && dur > 0) durEl.textContent = fmtTime(dur);
    if (prog && dur > 0) {
      prog.setAttribute('aria-valuemax', String(Math.round(dur)));
      prog.setAttribute('aria-valuenow', String(Math.round(cur)));
    }

    const tracks = getTracks();
    if (ccBtn) {
      ccBtn.hidden = tracks.length === 0;
      ccBtn.classList.toggle('is-active', !!activeTrack());
    }
    if (gearBadge) {
      const h = getHls()?.levels?.[getHls()?.currentLevel]?.height || v.videoHeight || 0;
      const rate = v.playbackRate || 1;
      if (rate !== 1) { gearBadge.hidden = false; gearBadge.textContent = `${rate}x`; }
      else if (h >= 720) { gearBadge.hidden = false; gearBadge.textContent = 'HD'; }
      else gearBadge.hidden = true;
    }
    if (fsBtn) {
      const fs = isFullscreen();
      fsBtn.innerHTML = fs ? YT_ICONS.fsExit : YT_ICONS.fsEnter;
      fsBtn.setAttribute('aria-label', fs ? 'Exit full screen' : 'Full screen');
    }
  }

  update();
  const cleanup = () => { clearTimeout(hideTimer); clearTimeout(bezelTimer); clearTimeout(seekIndTimer); };
  return { wrap, update, cleanup };
}
