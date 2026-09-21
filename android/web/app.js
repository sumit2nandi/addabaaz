import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

// Adapt the shared website behavior inside this bundle only. The contact form
// is not present, and the mobile feed must never autoplay background video.
function generateCaptcha() {}
startHeroVideoForCurrentSlide = () => {};

// Inline handlers in the shared, repository-owned templates need these globals
// even though the native bundle itself uses a private scope.
Object.assign(window, {
  openModal, closeModal, openPosterModal, playFirstEpisode, playStandalone,
  playMedia, playVideo, scrollRail, openTab, goToHeroSlide, toggleHeroMute,
  toggleCardPreviewSound
});
const root = document.getElementById('siteRoot');
const splash = document.getElementById('siteSplash');
const back = document.getElementById('appBack');
let ready = false;

function updateScreen() {
  const tab = document.querySelector('.tab-content.active')?.id;
  back.hidden = !ready || tab === 'homeTab';
}
function backWithinApp() {
  if (document.getElementById('modalBackdrop').classList.contains('show')) {
    closeModal();
    return true;
  }
  if (document.querySelector('.tab-content.active')?.id !== 'homeTab') {
    history.back();
    return true;
  }
  return false;
}
back.addEventListener('click', backWithinApp);
new MutationObserver(updateScreen).observe(root, { subtree: true, attributes: true, attributeFilter: ['class'] });

function connectionChanged() {
  document.getElementById('connectionStatus').hidden = navigator.onLine;
}
window.addEventListener('online', connectionChanged);
window.addEventListener('offline', connectionChanged);
connectionChanged();

function backgroundChanged(active) {
  if (!ready) return;
  if (!active) {
    stopHeroBanner();
    hideCardPreview();
    hidePosterPreview();
    const frame = document.getElementById('ytPlayerIframe');
    frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube.com');
  } else if (document.querySelector('.tab-content.active')?.id === 'homeTab') initHeroBanner();
}
document.addEventListener('visibilitychange', () => backgroundChanged(!document.hidden));
if (Capacitor.isNativePlatform()) {
  App.addListener('backButton', () => { if (!ready || !backWithinApp()) App.exitApp(); });
  App.addListener('appStateChange', ({ isActive }) => backgroundChanged(isActive));
}

// A real fallback for videos that disallow embedding. Never build URLs from
// arbitrary workbook links; extract only the validated YouTube video ID.
new MutationObserver(() => {
  const box = document.getElementById('videoPlayerBox');
  const iframe = box.querySelector('iframe');
  document.querySelector('.watch-external')?.remove();
  if (!iframe) return;
  const videoId = new URL(iframe.src).pathname.split('/').pop();
  if (!/^[\w-]{11}$/.test(videoId)) return;
  const link = document.createElement('a');
  link.className = 'watch-external';
  link.href = `https://www.youtube.com/watch?v=${videoId}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Video not playing? Open on YouTube ↗';
  document.getElementById('playerDesc').after(link);
}).observe(document.getElementById('videoPlayerBox'), { childList: true });

async function startApp() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let data;
  try {
    const response = await fetch('content.json', { signal: controller.signal });
    if (!response.ok) throw new Error('The bundled catalogue is missing. Please reinstall the app.');
    data = await response.json();
    if (data.schemaVersion !== 1 || !data.runtime || !data.copy) throw new Error('Unsupported app content. Please update the app.');
  } finally { clearTimeout(timeout); }
  // Text and attributes were validated from Excel at build time, not evaluated as HTML.
  for (const node of root.querySelectorAll('[data-copy]')) node.textContent = data.copy[node.dataset.copy] ?? '';
  for (const attr of ['aria-label', 'title']) {
    for (const node of root.querySelectorAll(`[data-copy-${attr}]`)) {
      const value = data.copy[node.getAttribute(`data-copy-${attr}`)];
      if (value) node.setAttribute(attr, value);
    }
  }
  Object.assign(window, data.runtime);
  initializeSite();
  const finish = () => {
    if (ready) return;
    ready = true;
    splash.remove();
    document.body.classList.remove('site-loading');
    root.inert = false;
    root.setAttribute('aria-busy', 'false');
    updateScreen();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
  else {
    splash.addEventListener('animationend', event => { if (event.target === splash) finish(); });
    splash.classList.add('is-leaving');
    setTimeout(finish, 850);
  }
}
startApp().catch(error => {
  splash.classList.add('has-error');
  const status = document.getElementById('siteStatus');
  status.textContent = error.name === 'AbortError' ? 'The app took too long to open. Please try again.' : error.message;
  status.setAttribute('role', 'alert');
  document.getElementById('loadRecovery').hidden = false;
});
