/* App push for the native Android / iOS shells (Firebase Cloud Messaging via @capacitor/push-notifications).
 *
 * The phone app gets an FCM/APNs token from the plugin and registers it with the server
 * (POST /api/v1/devices); Admin → Broadcast then sends app notifications to every registered device.
 * The web build never runs this file's native path — in a browser `nativePushSupported()` is false and
 * the browser's own Web-Push subscription (push.js) is used instead.
 *
 * The plugin is reached through `Capacitor.registerPlugin`, so the web bundle needs no npm import and
 * works even in a build that was made before the plugin was added (it just reports "not supported").
 */
import { app } from './app.js';

const TOKEN_KEY = 'ab.pushToken';
// The plugin proxy, or null when this is not a native build / the plugin is missing from the shell.
const plugin = () => {
  const C = window.Capacitor;
  if (!C?.isNativePlatform?.() || typeof C.registerPlugin !== 'function') return null;
  try { return C.registerPlugin('PushNotifications'); } catch { return null; }
};
export const nativePushSupported = () => !!plugin();
const platformName = () => { try { return window.Capacitor?.getPlatform?.() || 'android'; } catch { return 'android'; } };
// The last token this device registered (kept so sign-out can clean it up and so a returning
// sign-in does not have to wait for `register()` again).
const knownToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const rememberToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };
const label = () => { try { const p = window.Capacitor?.getPlatform?.(); return p === 'ios' ? 'iPhone / iPad' : 'Android app'; } catch { return 'App'; } };

/** Calls a plugin method that may not exist in this build (never throws). */
const tryCall = async (P, method, ...args) => { try { return await P[method]?.(...args); } catch { return null; } };

/** Asks for permission (if needed) and returns this device's push token. */
async function fetchToken() {
  const P = plugin();
  if (!P) throw Object.assign(new Error('This app build has no push support.'), { friendly: true });
  let perm = await tryCall(P, 'checkPermissions');
  if (perm && perm.receive !== 'granted') perm = await tryCall(P, 'requestPermissions');
  if (perm && perm.receive !== 'granted') throw Object.assign(new Error('Notifications weren’t allowed.'), { friendly: true });
  const token = await new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(t); fn(v); } };
    const t = setTimeout(() => done(reject, new Error('The device did not return a push token.')), 20_000);
    Promise.resolve()
      // Listeners must exist before register(), otherwise the first token is missed.
      .then(() => P.addListener('registration', (tok) => done(resolve, tok?.value || '')))
      .then(() => P.addListener('registrationError', (e) => done(reject, new Error(e?.error || 'Push registration failed.'))))
      .then(() => P.register?.())
      .catch((e) => done(reject, e));
  });
  if (!token) throw new Error('The device did not return a push token.');
  return token;
}

/** Registers this device for the signed-in account (called after sign-in). Returns the token, or null. */
export async function attachNativePush({ force = false } = {}) {
  const u = app.user;
  if (!plugin() || !u?.remote || !u.account) return null;
  try {
    const token = (!force && knownToken()) || await fetchToken();
    rememberToken(token);
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

/** Taps on an app notification open the page the broadcast pointed at (see the admin Broadcast page). */
function initTaps() {
  const P = plugin(); if (!P) return;
  try { P.addListener('pushNotificationActionPerformed', (action) => {
    const url = String(action?.notification?.data?.url || '');
    if (!url) return;
    if (/^https?:\/\//.test(url)) { try { window.open(url, '_blank'); } catch { /* popup blocked */ } return; }
    location.hash = '#' + (url.startsWith('/') ? url : `/${url}`);
  }); } catch { /* no listener support in this build */ }
}

/**
 * Wires app push for a native shell: after each sign-in the device token is registered for the
 * account, and taps open the linked page. Called by push.js's initPush().
 */
export function initNativePush() {
  if (!plugin()) return;
  app.user.on('account', () => attachNativePush().catch(() => {}));
  if (app.user.account) attachNativePush().catch(() => {});          // already signed in
  initTaps();
}

/** Is this device currently registered for the signed-in account? (settings screen) */
export async function nativePushState() {
  const u = app.user;
  if (!plugin() || !u?.remote || !u.account) return { supported: false };
  const devices = await u.remote.devices?.().then((r) => r.devices || []).catch(() => []);
  return { supported: true, enabled: true, native: true, subscribed: !!knownToken() && !!devices?.length, permission: 'prompt', prefs: null };
}
