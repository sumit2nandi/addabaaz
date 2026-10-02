/* Native-only rotate-to-fullscreen. The APK is locked to portrait in the AndroidManifest (the app
 * itself must never rotate), but while a LANDSCAPE video is actively playing the activity is
 * unlocked via @capacitor/screen-orientation: turning the phone then rotates the WebView and the
 * watch page full-screens the player (body.rot-fs). Pausing, ending or leaving the page locks
 * portrait again. Reels never unlock - they stay portrait-only. */
import { isNative } from './platform.js';

const plugin = () => window.Capacitor?.Plugins?.ScreenOrientation;
export const rotationAvailable = () => isNative && !!plugin()?.unlock;

/** Let the sensor decide (only meaningful while a landscape video plays). */
export async function unlockRotation() {
  if (!rotationAvailable()) return;
  try { await plugin().unlock(); } catch { /* older plugin build */ }
}

/** Back to the app's default: portrait only. */
export async function lockPortrait() {
  if (!isNative || !plugin()?.lock) return;
  try { await plugin().lock({ orientation: 'portrait' }); } catch { /* ignore */ }
}

export const angleNow = () => ((globalThis.screen ?? globalThis.window?.screen)?.orientation?.angle ?? globalThis.window?.orientation ?? 0);
export const landscapeNow = () => Math.abs(angleNow() % 180) === 90;
