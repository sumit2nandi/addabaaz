/* Marks the NATIVE copy of index.html so the branded launch screen is the very first frame.
 *
 * Why this exists: on a native launch the compact WEB loader (.boot-web) must never paint - the user
 * should go straight from the OS splash to the red launch canvas with the ADDABAAZ logo and the
 * progress bar. The document can be marked before the first paint from JavaScript
 * (app/launch-platform.js, which runs from <head>), but that depends on Capacitor's runtime being
 * injected before our script runs, and on WHEN: Capacitor's getPlatform() still reports 'web' at
 * that moment, because its native bridge object (window.androidBridge /
 * window.webkit.messageHandlers.bridge) is only injected around then. Relying on JS for the first
 * frame is fragile by construction.
 *
 * So the marker is stamped straight into the HTML the WebView serves. `cap sync` regenerates
 * mobile/<platform>/.../public/index.html from ../www on every sync, and the platform patch scripts
 * (patch-android.mjs / patch-ios.mjs) run immediately after it, so the stamp is refreshed every
 * time and never goes stale. www/ itself stays unmarked: the same bundle is also the website's.
 *
 * The marker is data-app="native" - platform-agnostic on purpose. The exact data-platform is filled
 * in by app/js/platform.js once the Capacitor bridge is up, and app/css/styles.css turns the boot
 * screen into the launch canvas for either marker. */
import fs from 'node:fs';

export const NATIVE_LAUNCH_MARKER = 'data-app="native"';

/** true when the document already carries the marker (used as a "shape changed" guard). */
export function hasNativeLaunchMarker(html) {
  return new RegExp(`<html\\b[^>]*\\s${NATIVE_LAUNCH_MARKER}`).test(html);
}

/** Adds the marker to the <html> tag. Idempotent: stamping an already-stamped file is a no-op,
 *  so running it on every `cap sync` writes nothing when nothing changed. */
export function stampNativeLaunchHtml(html) {
  const stripped = html.replace(new RegExp(`\\s*${NATIVE_LAUNCH_MARKER}`, 'g'), '');
  const tag = stripped.match(/<html\b[^>]*>/i);
  if (!tag) throw new Error('index.html has no <html> tag to mark; the launch screen could flash the compact web loader.');
  return stripped.replace(tag[0], tag[0].replace(/>$/, ` ${NATIVE_LAUNCH_MARKER}>`));
}

/** Stamps one generated index.html in place. Returns true when the file was rewritten. */
export function stampNativeLaunchFile(file) {
  const before = fs.readFileSync(file, 'utf8');
  const after = stampNativeLaunchHtml(before);
  if (!hasNativeLaunchMarker(after)) throw new Error(`could not mark ${file} for the native launch screen; index.html changed shape.`);
  if (after === before) return false;
  fs.writeFileSync(file, after);
  return true;
}
