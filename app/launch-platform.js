/* Mark the document as running inside the native shell BEFORE the first paint.
 *
 * app/js/platform.js marks it too, but that is an ES module: the browser parses the document and
 * paints once before a module runs. In that gap the default CSS shows the compact WEB loader
 * (.boot-web), so a native launch flashed the website loader for a frame or two before the native
 * launch screen took over.
 *
 * Capacitor injects its runtime as an inline script right after <head> (see Capacitor's
 * JSInjector.getInjectedStream), so window.Capacitor already exists by the time this runs - the
 * same native check platform.js makes, just early enough to matter.
 *
 * The marker is deliberately platform-AGNOSTIC (data-app="native"): Capacitor's getPlatform()
 * reports 'web' until its native bridge object (window.androidBridge /
 * window.webkit.messageHandlers.bridge) has been injected, which happens around - not before -
 * this point. Stamping data-platform here would therefore write "web" and KEEP the compact web
 * loader on screen, which is exactly the flash this file exists to prevent. The exact platform is
 * only claimed when it is already known; app/js/platform.js fills it in once the bridge is up, and
 * the launch CSS accepts either marker, so the very first frame is the branded launch screen.
 *
 * The generated native index.html carries the same marker (mobile/scripts/stamp-native-launch.mjs),
 * so the launch screen is right even if this script never runs - that stamp is the primary fix and
 * this is its safety net.
 *
 * Best effort on purpose: if the bridge is not up at all this does nothing and platform.js still
 * marks the document a moment later, exactly as before. */
try {
  if (window.Capacitor && window.Capacitor.isNativePlatform?.()) {
    const root = document.documentElement;
    root.dataset.app = 'native';
    const early = window.Capacitor.getPlatform?.();
    if (early && early !== 'web') root.dataset.platform = early;
  }
} catch (e) { /* platform.js will mark it */ }
