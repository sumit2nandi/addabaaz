let hlsPromise = null;
const loadHls = () => hlsPromise || (hlsPromise = new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
  s.onload = () => res(window.Hls); s.onerror = () => rej(new Error('hls.js failed to load'));
  document.head.appendChild(s);
}));

export async function createHtml5Player(container, video, { start = 0, autoplay = true, muted = false, onProgress, onEnded, onState } = {}) {
  container.innerHTML = '';
  const v = document.createElement('video');
  v.controls = true; v.muted = muted; v.playsInline = true; v.preload = 'metadata';
  v.setAttribute('controlsList', 'nodownload');
  if (video.poster) v.poster = video.poster;
  container.appendChild(v);

  let hls, lastEmit = 0;
  const { type, url } = video.source;
  if (type === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl')) {
    const Hls = await loadHls();
    if (Hls.isSupported()) { hls = new Hls({ startPosition: start || -1 }); hls.loadSource(url); hls.attachMedia(v); }
    else throw new Error('HLS is not supported on this device');
  } else v.src = url;

  v.addEventListener('loadedmetadata', () => { if (start > 0 && !hls) v.currentTime = start; }, { once: true });
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
  if (autoplay) v.play().catch(() => { /* needs a tap – native controls are visible */ });
  return {
    engine: type,
    time: () => v.currentTime, duration: () => v.duration || 0,
    mute: () => { v.muted = true; }, unmute: () => { v.muted = false; }, isMuted: () => v.muted,
    seek: (s) => { v.currentTime = s; }, play: () => v.play(), pause: () => v.pause(),
    destroy() { hls?.destroy(); v.pause(); v.removeAttribute('src'); v.load(); container.innerHTML = ''; },
  };
}
