/* Web Push (browser notifications) for signed-in viewers. The server decides who to notify (new episodes of shows you follow,
 * launches you set reminders for, optional announcements); this file only manages the browser side of the subscription. */
import { app } from './app.js';

// Helpers: convert the server's public VAPID key to bytes, and detect browser support.
const b64ToBytes = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !window.Capacitor?.isNativePlatform?.() && /^https?:$/.test(location.protocol);

// The service worker registration owns the push subscription.
const registration = async () => { const r = await navigator.serviceWorker.getRegistration(); return r || (await navigator.serviceWorker.ready); };
async function currentSubscription() {
  // Native apps (and any browser without push) must never wait on `serviceWorker.ready` —
  // the SW isn't registered there (main.js skips it under Capacitor), so `.ready` would hang
  // forever and, with it, `detachPush()` → `user.signOut()` → the Sign out button.
  if (!pushSupported()) return null;
  try { return await (await registration()).pushManager.getSubscription(); } catch { return null; }
}

/** → { supported, enabled (server has VAPID keys), permission, subscribed, prefs } */
export async function pushState() {
  const u = app.user;
  if (!pushSupported() || !u?.remote || !u.account) return { supported: false };
  const cfg = await u.remote.pushConfig(); if (!cfg.enabled) return { supported: true, enabled: false };
  const sub = await currentSubscription();
  const prefs = sub ? (await u.remote.pushStatus(sub.endpoint).catch(() => ({}))).prefs : null;
  return { supported: true, enabled: true, permission: Notification.permission, subscribed: !!(sub && prefs), prefs: prefs || { episodes: true, launches: true, news: false } };
}

// Ask permission, subscribe this browser to push, and send the subscription to the server.
export async function enablePush(prefs = {}) {
  const u = app.user, cfg = await u.remote.pushConfig();
  if (!cfg.enabled || !cfg.publicKey) throw Object.assign(new Error('Notifications aren’t available right now.'), { friendly: true });
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site — allow them in your browser’s site settings.' : 'Notifications weren’t allowed.');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.publicKey) });
  await u.remote.pushSubscribe(sub.toJSON(), prefs);
  return sub.endpoint;
}
// Unsubscribe on the server and in the browser.
export async function disablePush() {
  const sub = await currentSubscription(); if (!sub) return;
  await app.user.remote?.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
export async function setPushPrefs(prefs) { const sub = await currentSubscription(); if (sub) await app.user.remote.pushPrefs(sub.endpoint, prefs); }
/** On sign-out this device stops receiving the account's notifications (shared devices!) — the browser permission stays. */
export async function detachPush() { const sub = await currentSubscription(); if (sub) await app.user.remote?.pushUnsubscribe(sub.endpoint).catch(() => {}); }

/** After sign-in: if this browser already allowed notifications, attach its subscription to the account that just signed in. */
// Runs on sign-in so a returning user's browser is linked to their account again.
export function initPush() {
  if (!pushSupported()) return;
  const relink = async () => {
    const u = app.user; if (!u?.account || !u.remote || Notification.permission !== 'granted') return;
    const sub = await currentSubscription(); if (!sub) return;
    const cfg = await u.remote.pushConfig(); if (!cfg.enabled) return;
    const known = (await u.remote.pushStatus(sub.endpoint).catch(() => ({}))).prefs;
    if (!known) await u.remote.pushSubscribe(sub.toJSON(), {}).catch(() => {});
  };
  app.user.on('account', () => relink().catch(() => {}));
}
