/* Native-shell hooks. Everything here is a no-op in a normal browser, so the same
 * bundle runs on the web, in a PWA and inside Capacitor (Android / iOS). */
import { HISTORY } from './mode.js';
// Detect the Capacitor native shell and which platform (android / ios / web).
export const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform?.());
export const platform = isNative ? window.Capacitor.getPlatform() : 'web';

// One-time native set-up: back button, status bar, splash screen and deep links.
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
  // White status-bar icons sit on the red launch screen. Restore the regular dark app chrome
  // after the router has rendered its first route.
  P.StatusBar?.setStyle?.({ style: 'LIGHT' });
  P.StatusBar?.setBackgroundColor?.({ color: '#b80000' }).catch?.(() => {});
  window.addEventListener('ab:ready', () => {
    P.StatusBar?.setStyle?.({ style: 'DARK' });
    P.StatusBar?.setBackgroundColor?.({ color: '#050505' }).catch?.(() => {});
  }, { once: true });
  // Hand off quickly from the OS splash to the full-screen HTML loader. Keep that loader visible
  // until ab:ready, rather than leaving the native splash up until the first route is complete.
  const hideNativeSplash = () => {
    const pending = P.SplashScreen?.hide?.();
    pending?.catch?.(() => {});
  };
  const afterPaint = window.requestAnimationFrame?.bind(window) || ((callback) => setTimeout(callback, 0));
  afterPaint(() => afterPaint(hideNativeSplash));
  // Custom-scheme / universal links: addabaaz://show/shahid  ->  #/show/shahid
  P.App?.addListener?.('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url);
      // The Google sign-in ticket deep-link (in.addabaaz.app://oauth?ticket=…) is consumed by
      // social.js's own appUrlOpen listener - routing it as a page would show "Scene not found".
      if (u.host === 'oauth') return;
      const path = /^https?:$/.test(u.protocol) ? u.pathname + u.search : (u.hash.replace(/^#/, '') || (u.host + u.pathname)).replace(/^\/?/, '/');
      if (path.length > 1) location.hash = '#' + path;
    } catch { /* ignore malformed links */ }
  });
}

/** Where a shareable public URL for a route lives (native apps share the website URL). */
// Native apps have no shareable address of their own, so shared links point to the website.
export const PUBLIC_URL = 'https://addabaaz.in/';
/** Website (server) → real URL; static hosting → hash URL; native apps share the public website's URL. */
export const shareUrl = (path) => (isNative ? PUBLIC_URL.replace(/\/$/, '') + path : HISTORY ? location.origin + path : location.origin + location.pathname + '#' + path);
