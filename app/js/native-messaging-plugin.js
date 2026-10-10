/** Resolve the Firebase Messaging proxy across Capacitor's legacy native bridge and module runtime. */
export function resolveNativeMessagingPlugin(C, pushEnabled) {
  if (pushEnabled !== true || !C?.isNativePlatform?.()) return null;
  // Capacitor's native bridge injects proxies in `Capacitor.Plugins`; plain HTML apps don't import
  // @capacitor/core, so `registerPlugin` may not exist even though the native plugin is installed.
  const injected = C.Plugins?.FirebaseMessaging;
  if (injected) return injected;
  if (typeof C.registerPlugin !== 'function') return null;
  try { return C.registerPlugin('FirebaseMessaging'); } catch { return null; }
}
