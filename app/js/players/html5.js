// hls.js (needed for HLS in browsers without native support) is downloaded only when an HLS video is played.
let hlsPromise = null;
const loadHls = () => hlsPromise || (hlsPromise = new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
  s.onload = () => res(window.Hls); s.onerror = () => rej(new Error('hls.js failed to load'));
  document.head.appendChild(s);
}));

/** Subtitle files are fetched by us and attached as same-origin blob: URLs, so they work with any player origin and need no crossorigin attribute on the video. */
async function attachSubtitles(v, tracks = []) {
  const pref = localStorage.getItem('ab.subLang');           // 'off' | a language code | null (never chosen)
  for (const t of tracks) {
    try {
      const r = await fetch(t.url); if (!r.ok) continue;
      const el = document.createElement('track'); el.kind = 'subtitles'; el.label = t.label; el.srclang = t.lang;
      el.src = URL.createObjectURL(new Blob([await r.text()], { type: 'text/vtt' }));
      if (pref === t.lang) el.default = true;
      v.appendChild(el);
    } catch { /* one broken subtitle file must not stop the video */ }
  }
  const apply = () => { if (pref && pref !== 'off') for (const tt of v.textTracks) tt.mode = tt.language === pref ? 'showing' : 'disabled'; };
  apply(); v.textTracks.addEventListener?.('addtrack', apply);
  v.textTracks.addEventListener?.('change', () => { const on = [...v.textTracks].find((tt) => tt.mode === 'showing'); try { localStorage.setItem('ab.subLang', on ? on.language : 'off'); } catch { /* ignore */ } });
}

// Plays MP4 or HLS (including protected R2 video) in a <video> element and returns the same controller interface as the YouTube player (play, pause, seek, destroy…).
export async function createHtml5Player(container, video, { start = 0, autoplay = true, muted = false, controls = true, onProgress, onEnded, onState, onDimensions } = {}) {
  container.innerHTML = '';
  const v = document.createElement('video');
  v.controls = controls;
  // iOS WebKit checks muted + inline at the element level before allowing autoplay. Set both the
  // reflected attributes and live properties before inserting the element or assigning its source.
  const setMuted = (value) => {
    v.defaultMuted = value; v.muted = value;
    if (value) v.setAttribute('muted', ''); else v.removeAttribute('muted');
  };
  setMuted(muted);
  v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  v.autoplay = autoplay; if (autoplay) v.setAttribute('autoplay', ''); else v.removeAttribute('autoplay');
  v.preload = 'metadata';
  v.setAttribute('controlsList', 'nodownload');
  if (video.poster) v.poster = video.poster;
  container.appendChild(v);
  const subs = attachSubtitles(v, video.subtitles);

  let hls, lastEmit = 0;
  const { type, url } = video.source;
  if (type === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl')) {
    const Hls = await loadHls();
    if (Hls.isSupported()) { hls = new Hls({ startPosition: start || -1 }); hls.loadSource(url); hls.attachMedia(v); }
    else throw Object.assign(new Error('This video format isn’t supported on your device.'), { friendly: true });
  } else v.src = url;

  v.addEventListener('loadedmetadata', () => { if (start > 0 && !hls) v.currentTime = start; onDimensions?.(v.videoWidth, v.videoHeight); }, { once: true });
  v.addEventListener('timeupdate', () => { const n = Date.now(); if (n - lastEmit > 1000) { lastEmit = n; onProgress?.(v.currentTime, v.duration || 0); } });
  v.addEventListener('playing', () => onState?.('playing'));
  v.addEventListener('pause', () => { onProgress?.(v.currentTime, v.duration || 0); onState?.('paused'); });
  v.addEventListener('waiting', () => onState?.('buffering'));
  v.addEventListener('error', () => onState?.('error', v.error?.code));
  v.addEventListener('ended', () => { onState?.('ended'); onEnded?.(); });

  if ('mediaSession' in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: video.title, artist: 'ADDABAAZ', artwork: video.poster ? [{ src: video.poster }] : [] });
    navigator.mediaSession.setActionHandler('play', () => v.play());
    navigator.mediaSession.setActionHandler('pause', () => v.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => { v.currentTime = Math.max(0, v.currentTime - 10); });
    navigator.mediaSession.setActionHandler('seekforward', () => { v.currentTime += 10; });
  }
  // Try the requested sound mode first. If the browser rejects unmuted autoplay, immediately retry muted:
  // iOS commonly blocks the first attempt but permits muted inline playback without another gesture.
  let playPromise = null;
  if (autoplay) {
    try { playPromise = Promise.resolve(v.play()); }
    catch (err) { playPromise = Promise.reject(err); }
    if (!muted) {
      playPromise = playPromise.catch((err) => {
        if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') throw err; // broken media is not an autoplay-policy fallback
        setMuted(true);
        try { return v.play(); }
        catch (retryErr) { return Promise.reject(retryErr); }
      });
    }
    playPromise.catch(() => { /* a final refusal is reported through the normal blocked/error path */ });
  }
  await Promise.race([subs, new Promise((r) => setTimeout(r, 1500))]);   // give small subtitle files a moment so the first cue isn't missed
  // Casting support: Remote Playback API where available, AirPlay on Safari.
  const remote = v.remote, airplay = typeof v.webkitShowPlaybackTargetPicker === 'function';
  return {
    engine: type,
    playPromise, // resolves on requested-mode autoplay or its muted retry; rejects if the final attempt fails
    /** Chromecast/Android/Edge via the Remote Playback API, AirPlay on Safari. false when neither exists. */
    castSupported: () => !!(remote?.prompt || airplay),
    cast: async () => { if (remote?.prompt) await remote.prompt(); else if (airplay) v.webkitShowPlaybackTargetPicker(); },
    hasSubtitles: () => v.textTracks.length > 0,
    time: () => v.currentTime, duration: () => v.duration || 0,
    mute: () => { v.muted = true; }, unmute: () => { v.muted = false; }, isMuted: () => v.muted,
    seek: (s) => { v.currentTime = s; }, play: () => v.play(), pause: () => v.pause(),
    destroy() { hls?.destroy(); v.pause(); v.removeAttribute('src'); v.load(); container.innerHTML = ''; },
  };
}
