/* Native app push notifications, using one Firebase Cloud Messaging token on Android and iOS.
 *
 * The Firebase Messaging Capacitor plugin returns an FCM registration token on both platforms. The
 * app registers that token with the API (POST /api/v1/devices); Admin → Broadcast sends through
 * Firebase Cloud Messaging. Browser/PWA push remains separate Web Push (app/js/push.js).
 *
 * Native Capacitor injects a legacy Plugins proxy; newer Capacitor runtimes also expose registerPlugin.
 * Native push is enabled only in app builds whose CI job has the Firebase client config files.
 */
import { app } from './app.js';
import { resolveNativeMessagingPlugin } from './native-messaging-plugin.js';

const TOKEN_KEY = 'ab.pushToken';
const enabled = () => window.ADDABAAZ_ENV?.NATIVE_PUSH_ENABLED === true;
// The plugin proxy, or null in browsers / app builds without Firebase configuration.
const plugin = () => resolveNativeMessagingPlugin(window.Capacitor, enabled());
export const nativePushSupported = () => !!plugin();
const platformName = () => { try { return window.Capacitor?.getPlatform?.() || 'android'; } catch { return 'android'; } };
const label = () => { try { return window.Capacitor?.getPlatform?.() === 'ios' ? 'iPhone / iPad' : 'Android app'; } catch { return 'App'; } };
const knownToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const rememberToken = (token) => { try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

/** Calls a plugin method that may not exist in an older build (never throws). */
const tryCall = async (P, method, ...args) => { try { return await P[method]?.(...args); } catch { return null; } };

/** Requests permission if needed and returns the platform-independent FCM registration token. */
async function fetchToken() {
  const P = plugin();
  if (!P) throw Object.assign(new Error('Firebase push is not configured in this app build.'), { friendly: true });
  let perm = await tryCall(P, 'checkPermissions');
  if (['prompt', 'prompt-with-rationale'].includes(perm?.receive)) perm = await tryCall(P, 'requestPermissions');
  if (!perm || perm.receive !== 'granted') throw Object.assign(new Error('Notifications weren’t allowed.'), { friendly: true });
  const result = await P.getToken();
  const token = String(result?.token || '').trim();
  if (!token) throw new Error('Firebase did not return a push token.');
  return token;
}

/** Registers this device for the signed-in account (called after sign-in). Returns the token, or null. */
export async function attachNativePush({ force = false } = {}) {
  const u = app.user;
  if (!plugin() || !u?.remote || !u.account) return null;
  try {
    // Ask Firebase for the current token every sign-in; it can rotate while the app is closed.
    const token = await fetchToken();
    const previous = knownToken();
    rememberToken(token);
    if (previous && previous !== token) await u.remote.removeDevice(previous).catch(() => {});
    await u.remote.registerDevice(token, platformName(), label());
    return token;
  } catch (e) {
    console.warn('[push] app notifications are off:', e?.message || e);
    if (force) throw e;                                              // user-initiated (settings toggle): show the reason
    return null;                                                     // best effort after sign-in
  }
}

/** Sign-out / "notify me" off: this device stops receiving the account's notifications. */
export async function detachNativePush() {
  const token = knownToken();
  rememberToken('');
  if (!token) return;
  try { await app.user.remote?.removeDevice?.(token); } catch { /* best effort */ }
}

/** Taps on an app notification open the link the broadcast was sent with. */
function initTaps(P) {
  try { P.addListener('notificationActionPerformed', (action) => {
    const url = String(action?.notification?.data?.url || '');
    if (!url) return;
    if (/^https?:\/\//.test(url)) { try { window.open(url, '_blank'); } catch { /* popup blocked */ } return; }
    location.hash = '#' + (url.startsWith('/') ? url : `/${url}`);
  }); } catch { /* no listener support in this build */ }
}

/** Refreshes the server registration when Firebase rotates this installation's token. */
function listenForTokenRefresh(P) {
  try { P.addListener('tokenReceived', async ({ token: next } = {}) => {
    const token = String(next || '').trim(), u = app.user;
    if (!token || !u?.remote || !u.account) return;
    const previous = knownToken();
    rememberToken(token);
    if (previous && previous !== token) await u.remote.removeDevice(previous).catch(() => {});
    await u.remote.registerDevice(token, platformName(), label()).catch((e) => console.warn('[push] token refresh failed:', e?.message || e));
  }); } catch { /* no listener support in this build */ }
}

/**
 * Wires native push: after each sign-in the device token is registered for the account, and taps
 * open the linked page. Called by push.js's initPush().
 */
export function initNativePush() {
  const P = plugin(); if (!P) return;
  listenForTokenRefresh(P);
  app.user.on('account', () => attachNativePush().catch(() => {}));
  if (app.user.account) attachNativePush().catch(() => {});          // already signed in
  initTaps(P);
}

/** Is this device currently registered for the signed-in account? (settings screen) */
export async function nativePushState() {
  const u = app.user;
  const P = plugin();
  if (!P || !u?.remote || !u.account) return { supported: false };
  const [devices, permission] = await Promise.all([
    u.remote.devices?.().then((r) => r.devices || []).catch(() => []),
    tryCall(P, 'checkPermissions'),
  ]);
  return { supported: true, enabled: true, native: true, subscribed: !!knownToken() && !!devices?.length, permission: permission?.receive || 'prompt', prefs: null };
}
