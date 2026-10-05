/* Native app push notifications, using one Firebase Cloud Messaging token on Android and iOS.
 *
 * Signed-in viewers register at POST /api/v1/devices. Connected guests register at
 * POST /api/v1/devices/guest, which stores the token without an account link. General broadcasts
 * can reach guest installations; account-specific episode and launch notifications cannot use the
 * guest's local-only profile data. Browser/PWA push remains separate Web Push (app/js/push.js).
 *
 * Native Capacitor injects a legacy Plugins proxy; newer Capacitor runtimes also expose registerPlugin.
 * Native push is enabled only in app builds whose CI job has the Firebase client config files.
 */
import { app } from './app.js';
import { resolveNativeMessagingPlugin } from './native-messaging-plugin.js';

const reportClientIssue = (error, where) => {
  if (Number.isInteger(error?.status) && error.status > 0 && error.status < 500) return;
  import('./errors.js').then(({ reportClientError }) => reportClientError(error, { where })).catch(() => {});
};

const TOKEN_KEY = 'ab.pushToken';
const OWNER_KEY = 'ab.pushOwner';
const OPT_OUT_KEY = 'ab.pushOptOut';
const enabled = () => window.ADDABAAZ_ENV?.NATIVE_PUSH_ENABLED === true;
// The plugin proxy, or null in browsers / app builds without Firebase configuration.
const plugin = () => resolveNativeMessagingPlugin(window.Capacitor, enabled());
export const nativePushSupported = () => !!plugin();
const platformName = () => { try { return window.Capacitor?.getPlatform?.() || 'android'; } catch { return 'android'; } };
const label = () => { try { return window.Capacitor?.getPlatform?.() === 'ios' ? 'iPhone / iPad' : 'Android app'; } catch { return 'App'; } };
const knownToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const knownOwner = () => { try { return localStorage.getItem(OWNER_KEY) || ''; } catch { return ''; } };
const rememberToken = (token) => { try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };
const rememberOwner = (owner) => { try { owner ? localStorage.setItem(OWNER_KEY, owner) : localStorage.removeItem(OWNER_KEY); } catch { /* private mode */ } };
const isOptedOut = () => { try { return localStorage.getItem(OPT_OUT_KEY) === '1'; } catch { return false; } };
const setOptOut = (off) => { try { off ? localStorage.setItem(OPT_OUT_KEY, '1') : localStorage.removeItem(OPT_OUT_KEY); } catch { /* private mode */ } };
const stateChanged = () => { try { app.user?.emit?.('push'); } catch { /* UI refresh is best effort */ } };

/** Calls a plugin method that may not exist in an older build (never throws). */
const tryCall = async (P, method, ...args) => {
  try { return await P[method]?.(...args); }
  catch (error) { reportClientIssue(error, `native-push-${method}`); return null; }
};

/** Requests permission if needed and returns the platform-independent FCM registration token. */
async function fetchToken() {
  const P = plugin();
  if (!P) throw Object.assign(new Error('Firebase push is not configured in this app build.'), { friendly: true });
  let perm = await tryCall(P, 'checkPermissions');
  if (['prompt', 'prompt-with-rationale'].includes(perm?.receive)) perm = await tryCall(P, 'requestPermissions');
  if (!perm || perm.receive !== 'granted') {
    throw Object.assign(new Error('Notifications weren’t allowed.'), { friendly: true, code: 'notification_permission_denied' });
  }
  const result = await P.getToken();
  const token = String(result?.token || '').trim();
  if (!token) throw new Error('Firebase did not return a push token.');
  return token;
}

/** Best-effort removal using the association the server last acknowledged. */
async function removeRegisteredToken(token, owner, u = app.user, { anyOwner = false } = {}) {
  if (!token) return true;
  if (!u?.remote) return false;
  try {
    // The public token-delete is safe for guest devices and also cleans a stale association after
    // account changes or token rotation; sign-out of the current account uses its authenticated route.
    if (anyOwner || !u.account || owner === 'guest') await u.remote.removeGuestDevice?.(token);
    else await u.remote.removeDevice?.(token);
    return true;
  } catch { return false; }
}

/** Register / refresh the current token for the active account or as an anonymous guest device. */
async function registerToken(token, u) {
  const owner = u.account ? 'account' : 'guest';
  const previous = knownToken();
  // Before guest registration existed, saved tokens belonged to a signed-in account.
  const previousOwner = knownOwner() || 'account';
  if (owner === 'account') await u.remote.registerDevice(token, platformName(), label());
  else await u.remote.registerGuestDevice(token, platformName(), label());
  if (previous && previous !== token) await removeRegisteredToken(previous, previousOwner, u, { anyOwner: true });
  rememberToken(token);
  rememberOwner(owner);
  stateChanged();
  return token;
}

/** Registers this device for the current account or guest (called on app start and account changes). Returns token, or null. */
export async function attachNativePush({ force = false } = {}) {
  const u = app.user;
  if (!plugin() || !u?.remote) return null;
  if (force) setOptOut(false);                                      // the user explicitly switched notifications on
  else if (isOptedOut()) {
    // Retry an opt-out cleanup after a temporary network failure; never re-register this token.
    const pending = knownToken(), owner = knownOwner() || 'account';
    if (pending && await removeRegisteredToken(pending, owner, u)) { rememberToken(''); rememberOwner(''); stateChanged(); }
    return null;
  }
  try {
    // Ask Firebase for the current token every start/sign-in; it can rotate while the app is closed.
    const token = await fetchToken();
    return await registerToken(token, u);
  } catch (e) {
    // If Android permission was revoked, stop sending to the old token too. Network errors keep the
    // last-known registration so a temporary outage does not silently unsubscribe the device.
    if (e?.code !== 'notification_permission_denied') reportClientIssue(e, 'native-push-registration');
    if (e?.code === 'notification_permission_denied') {
      const previous = knownToken(), owner = knownOwner() || 'account';
      if (await removeRegisteredToken(previous, owner, u)) { rememberToken(''); rememberOwner(''); }
      stateChanged();
    }
    console.warn('[push] app notifications are off:', e?.message || e);
    if (force) throw e;                                              // user-initiated (settings toggle): show the reason
    return null;                                                     // best effort after app start / sign-in
  }
}

/** Sign-out / explicit "notify me" opt-out: detach this token from its current audience. */
export async function detachNativePush({ optOut = true } = {}) {
  if (optOut) setOptOut(true);
  const token = knownToken(), owner = knownOwner() || 'account';
  if (!token) { rememberOwner(''); stateChanged(); return; }
  if (await removeRegisteredToken(token, owner)) { rememberToken(''); rememberOwner(''); }
  stateChanged();
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
    if (!token || !u?.remote || isOptedOut()) return;
    const permission = await tryCall(P, 'checkPermissions');
    if (permission?.receive !== 'granted') {
      if (permission?.receive === 'denied') {
        const previous = knownToken(), owner = knownOwner() || 'account';
        if (await removeRegisteredToken(previous, owner, u)) { rememberToken(''); rememberOwner(''); }
        stateChanged();
      }
      return;
    }
    try { await registerToken(token, u); }
    catch (e) { console.warn('[push] token refresh failed:', e?.message || e); reportClientIssue(e, 'native-push-token-refresh'); }
  }); } catch { /* no listener support in this build */ }
}

/**
 * Wires native push: connected guests are registered anonymously by default, and signed-in
 * installations attach to their account. Taps open the linked page. Called by push.js's initPush().
 */
export function initNativePush() {
  const P = plugin(); if (!P) return;
  listenForTokenRefresh(P);
  const registerCurrentViewer = () => attachNativePush().catch(() => {});
  app.user.on('account', registerCurrentViewer);
  if (app.user.remote) registerCurrentViewer();                       // includes an already-loaded guest
  initTaps(P);
}

/** Is this device registered for its current account / as a guest? (settings screen) */
export async function nativePushState() {
  const u = app.user;
  const P = plugin();
  if (!P || !u?.remote) return { supported: false };
  const [devices, permission] = await Promise.all([
    u.account ? u.remote.devices?.().then((r) => r.devices || []).catch(() => []) : Promise.resolve([]),
    tryCall(P, 'checkPermissions'),
  ]);
  const permissionState = permission?.receive || 'prompt';
  const localToken = !!knownToken();
  const registeredForViewer = u.account ? !!devices?.length : localToken && knownOwner() === 'guest';
  // The choices stored for THIS device (episodes / launches / news) — the app's Account page shows the same
  // three switches the browser has. A guest installation has no account to target episode or launch sends
  // with, so it keeps only the master switch and never asks for these. A token the server does not know yet
  // falls back to the server defaults: all three on.
  const token = u.account ? knownToken() : '';
  const prefs = token ? (await u.remote.deviceStatus?.(token).catch(() => ({})))?.prefs : null;
  return {
    supported: true, enabled: true, native: true, guest: !u.account,
    subscribed: !isOptedOut() && localToken && registeredForViewer && (!permission || permissionState === 'granted'),
    permission: permissionState, prefs: prefs || { episodes: true, launches: true, news: true },
  };
}

/** Sets the notification choices for this installation's token (no-op in a browser). */
export async function setNativePushPrefs(prefs) {
  const u = app.user, token = knownToken();
  if (!u?.remote || !token) return;
  await u.remote.devicePrefs(token, prefs);
  stateChanged();
}
