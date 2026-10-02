/* Rotation in the Android app.
 *
 * The app is portrait-only (the AndroidManifest locks MainActivity, see
 * mobile/scripts/android-manifest.mjs) and NOTHING turns the screen while you are watching in
 * portrait - not the sensor, not turning the phone. The one exception is full-screen video
 * (started with the player's own fullscreen button), exactly like the YouTube app:
 *
 *   - the video goes full screen; the native side (mobile/scripts/android-fullscreen.mjs) hides
 *     both system bars and shows only the video;
 *   - the screen then FOLLOWS THE PHONE: the native client switches the activity to
 *     SCREEN_ORIENTATION_FULL_SENSOR, so the video is portrait while the phone is held upright,
 *     turns landscape when the phone is turned, and back - in both directions, even when the
 *     device's own auto-rotate switch is off;
 *   - leaving full screen locks the app back to portrait, where it stays.
 *
 * The page deliberately does NOT set an orientation on the way in: Capacitor's
 * ScreenOrientation.unlock() maps to Android's SCREEN_ORIENTATION_UNSPECIFIED, which defers to the
 * system - with auto-rotate off that means "stay portrait" - and any lock() would pin the screen
 * again (that is what used to force full-screen videos into landscape only). */
import { isNative } from './platform.js';

const plugin = () => window.Capacitor?.Plugins?.ScreenOrientation;

async function lock(orientation) {
  if (!isNative || !plugin()?.lock) return;
  try { await plugin().lock({ orientation }); } catch { /* refused (e.g. a browser tab) - the layout still works */ }
}

/** The app's default, everywhere outside video fullscreen: portrait, sensors ignored. */
export const lockPortrait = () => lock('portrait');

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

/** Full screen started: the native client owns the orientation (the screen follows the phone).
 *  Full screen ended: the app locks back to portrait. */
function applyFullscreen(active) {
  if (!active) lockPortrait();
}

/** Installed once at boot (main.js): the app stays portrait until a video goes full screen, where
 *  the phone's own direction decides the orientation. */
export function initFullscreenRotation() {
  document.addEventListener('fullscreenchange', () => applyFullscreen(!!fullscreenElement()));
  // The native fullscreen client (mobile/scripts/android-fullscreen.mjs) also tells the page when
  // full screen starts and ends - some WebViews enter full screen without a fullscreenchange event.
  window.addEventListener('ab-video-fullscreen', (e) => {
    const el = fullscreenElement();
    const active = e?.detail?.active;
    applyFullscreen(active === undefined ? !!el : !!active);
  });
  lockPortrait();   // the app never rotates on its own
}
