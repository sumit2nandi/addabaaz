/* Native-shell hooks. Everything here is a no-op in a normal browser, so the same
 * bundle runs on the web, in a PWA and inside Capacitor (Android / iOS). */
import { HISTORY } from './mode.js';
export const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform?.());
export const platform = isNative ? window.Capacitor.getPlatform() : 'web';

export function initPlatform() {
  document.documentElement.dataset.platform = platform;
  if (!isNative) return;
  const P = window.Capacitor.Plugins || {};
  // Android hardware back button -> in-app history, exit only from home
  P.App?.addListener?.('backButton', () => {
    if ((window.__navDepth || 0) > 0) history.back();
    else if (location.hash && location.hash !== '#/' ) location.hash = '#/';
    else P.App.exitApp?.();
  });
  // Dark status bar to match the brand background
  P.StatusBar?.setStyle?.({ style: 'DARK' });
  P.StatusBar?.setBackgroundColor?.({ color: '#050505' }).catch?.(() => {});
  // Hide the native splash once the first view has painted
  window.addEventListener('ab:ready', () => P.SplashScreen?.hide?.(), { once: true });
  // Custom-scheme / universal links: addabaaz://show/shahid  ->  #/show/shahid
  P.App?.addListener?.('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url);
      const path = /^https?:$/.test(u.protocol) ? u.pathname + u.search : (u.hash.replace(/^#/, '') || (u.host + u.pathname)).replace(/^\/?/, '/');
      if (path.length > 1) location.hash = '#' + path;
    } catch { /* ignore malformed links */ }
  });
}

/** Where a shareable public URL for a route lives (native apps share the website URL). */
export const PUBLIC_URL = 'https://addabaaz.in/';
/** Website (server) → real URL; static hosting → hash URL; native apps share the public website's URL. */
export const shareUrl = (path) => (isNative ? PUBLIC_URL.replace(/\/$/, '') + path : HISTORY ? location.origin + path : location.origin + location.pathname + '#' + path);
