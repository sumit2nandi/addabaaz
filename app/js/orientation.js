/* Rotation in the Android app.
 *
 * The app is portrait-only (the AndroidManifest locks MainActivity, see
 * mobile/scripts/android-manifest.mjs) and NOTHING turns the screen while you are watching in
 * portrait - not the sensor, not turning the phone. The one exception is the player's own
 * fullscreen button (the native controls), exactly like the YouTube app:
 *
 *   - the video's fullscreen button puts the video full screen; the native side
 *     (mobile/scripts/android-fullscreen.mjs) hides both system bars and shows only the video;
 *   - the screen then turns to match the video (a landscape video goes landscape, a vertical one
 *     stays portrait) - this module locks the orientation for that;
 *   - leaving full screen locks the app back to portrait, where it stays.
 *
 * This module also keeps the app in portrait at start-up and on leaving a page, so a fullscreen
 * video can never leave the WebView in landscape behind it. */
import { isNative } from './platform.js';

const plugin = () => window.Capacitor?.Plugins?.ScreenOrientation;

async function lock(orientation) {
  if (!isNative || !plugin()?.lock) return;
  try { await plugin().lock({ orientation }); } catch { /* refused (e.g. a browser tab) - the layout still works */ }
}

/** The app's default, everywhere outside video fullscreen: portrait, sensors ignored. */
export const lockPortrait = () => lock('portrait');

/** True when `el` is a player element that should be full screen in landscape. */
function isLandscapeElement(el) {
  if (el && el.tagName === 'VIDEO') {
    if (el.videoWidth > 0 && el.videoHeight > 0) return el.videoWidth >= el.videoHeight;
    return true;                                            // metadata not ready: assume a normal landscape video
  }
  return true;                                              // YouTube embeds on the watch page are landscape videos
}

/** The screen turns only here: full screen was entered (or left) through the player's button. */
function applyFullscreen(active, el) {
  if (!active) return lockPortrait();                       // full screen ended: back to portrait-only
  lock(isLandscapeElement(el) ? 'landscape' : 'portrait');
}

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

/** Installed once at boot (main.js): the app stays portrait until a video really goes full screen. */
export function initFullscreenRotation() {
  document.addEventListener('fullscreenchange', () => applyFullscreen(!!fullscreenElement(), fullscreenElement()));
  // The native fullscreen client (mobile/scripts/android-fullscreen.mjs) also tells the page when
  // full screen starts and ends - some WebViews enter full screen without a fullscreenchange event.
  window.addEventListener('ab-video-fullscreen', (e) => {
    const el = fullscreenElement();
    const active = e?.detail?.active;
    applyFullscreen(active === undefined ? !!el : !!active, el);
  });
  lockPortrait();   // the app never rotates on its own
}
