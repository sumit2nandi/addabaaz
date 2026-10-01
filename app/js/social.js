/* Google & Facebook sign-in on the client.
 *
 * The client only obtains a credential from the provider; the ADDABAAZ API verifies it
 * (POST /auth/google {idToken}, POST /auth/facebook {accessToken}) and returns our own session token.
 *   - Web:            Google Identity Services button + Facebook JS SDK popup
 *   - Android / iOS:  native SDKs through the Capacitor plugin @capgo/capacitor-social-login
 *                     (Google's/Facebook's web flows are blocked or unreliable inside app WebViews)
 * Provider ids come from GET /auth/providers, so they're configured once, on the server.
 */
import { html, $ } from './util.js';
import { icon } from './icons.js';
import { isNative } from './platform.js';

// Loads a third-party SDK script once; rejects if it cannot load (ad blockers, offline).
const loaded = {};
// Locally-written messages that are safe to show (flagged so run()/friendly() pass them through).
const soft = (m) => Object.assign(new Error(m), { friendly: true });
const loadScript = (key, src) => loaded[key] || (loaded[key] = new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.async = true;
  s.onload = res; s.onerror = () => { delete loaded[key]; rej(soft('Couldn’t load the sign-in service — check your connection or ad-blocker.')); };
  document.head.appendChild(s);
}));

/* ---------- web: Google ---------- */
async function initGoogle(clientId, onCredential) {
  await loadScript('gis', 'https://accounts.google.com/gsi/client');
  window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => r.credential && onCredential(r.credential), auto_select: false, cancel_on_tap_outside: true, use_fedcm_for_prompt: true });
  // Never silently continue with the Google id that signed in last time — the user always picks.
  try { window.google.accounts.id.disableAutoSelect(); } catch { /* older GIS builds */ }
  return window.google.accounts.id;
}

/**
 * Forgets the native SDK's remembered account (call on sign-out): the Capgo plugin's logout runs
 * CredentialManager.clearCredentialState — so the next "Continue with Google" opens with a clean
 * chooser instead of the previously-used id — and wipes its cached token. Bounded and best-effort:
 * sign-out must never hang or fail because of it.
 */
export async function forgetNativeSession() {
  if (!isNative) return;
  try {
    const SL = window.Capacitor?.Plugins?.SocialLogin;
    if (!SL?.logout) return;
    await Promise.race([SL.logout(), new Promise((res) => setTimeout(res, 5000))]);
  } catch { /* offline mode / older plugin — nothing to clear */ }
}

/* ---------- web: Facebook ---------- */
// Facebook JS SDK initialisation (once).
let fbReady = null;
function initFacebook({ appId, version = 'v21.0' }) {
  return fbReady || (fbReady = new Promise((res, rej) => {
    window.fbAsyncInit = () => { window.FB.init({ appId, cookie: false, xfbml: false, version }); res(window.FB); };
    loadScript('fb', 'https://connect.facebook.net/en_US/sdk.js').catch((e) => { fbReady = null; rej(e); });
  }));
}
const facebookWeb = (FB) => new Promise((res, rej) => FB.login((r) => (r.authResponse?.accessToken ? res(r.authResponse.accessToken) : rej(Object.assign(new Error('cancelled'), { cancelled: true }))), { scope: 'public_profile,email' }));

/* ---------- web: Apple ---------- */
// Sign in with Apple on the web: popup flow; the name is only provided on first authorisation.
async function appleWeb({ clientId }) {
  await loadScript('apple', 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
  window.AppleID.auth.init({ clientId, scope: 'name email', redirectURI: location.origin, usePopup: true });
  try {
    const r = await window.AppleID.auth.signIn();
    const n = r.user?.name; return { identityToken: r.authorization?.id_token, name: n ? [n.firstName, n.lastName].filter(Boolean).join(' ') : '' };
  } catch (e) { if (e?.error === 'popup_closed_by_user' || e?.error === 'user_cancelled_authorize') e.cancelled = true; throw e; }
}

/* ---------- native (Capacitor) ---------- */
// Native apps use the Capacitor social-login plugin; it is initialised once with the ids from the server.
let nativeInit = false;
function nativePlugin(providers) {
  const SL = window.Capacitor?.Plugins?.SocialLogin;
  if (!SL) throw soft('Social sign-in isn’t available right now.');
  const ios = window.Capacitor?.getPlatform?.() === 'ios';
  const ready = nativeInit ? Promise.resolve() : Promise.race([
    SL.initialize({
      ...(providers.google ? { google: { webClientId: providers.google.clientId, iOSClientId: providers.google.iosClientId, iOSServerClientId: providers.google.clientId, mode: 'online' } } : {}),
      // Apple is iOS-only here: sending `apple: {}` to Android makes initialize reject (it wants
      // redirectUrl/clientId) and takes the other providers down with it — Capgo issue #197.
      ...(providers.apple && ios ? { apple: {} } : {}),
      ...(providers.facebook ? { facebook: { appId: providers.facebook.appId, clientToken: providers.facebook.clientToken } } : {}),
    }).then(() => { nativeInit = true; }),
    new Promise((_, rej) => setTimeout(() => rej(soft('Sign-in couldn’t start — please try again.')), 12000)),
  ]);
  return { SL, ready };
}
// Native flow: get an ID token (Google/Apple) or access token (Facebook) from the platform SDK; user cancellation is flagged, not treated as an error.
// Every native call also races a timeout: a stuck SDK must produce a visible message, never a dead button.
// Silent ONLY for a plain dismissal ("…canceled", "Login cancelled"). Long errors that merely mention
// cancelling — notably "…activity is cancelled by the user", which actually means the Google OAuth
// client / SHA-1 is misconfigured — must be shown, or sign-in dies with no feedback at all.
const benignCancel = (e) => /(^|[\s:])(cancel(ed|led)?)\.?$/i.test(String(e?.message || '').trim());
async function nativeCredential(provider, providers) {
  const { SL, ready } = nativePlugin(providers); await ready;
  const call = (opts, msg) => Promise.race([
    SL.login(opts),
    new Promise((_, rej) => setTimeout(() => rej(soft(msg)), 30000)),
  ]);
  try {
    if (provider === 'apple') { const r = await call({ provider: 'apple', options: { scopes: ['email', 'name'] } }, 'Apple sign-in didn’t respond — please try again.'); const n = r.result?.profile; return { identityToken: r.result?.idToken, name: n ? [n.givenName, n.familyName].filter(Boolean).join(' ') : '' }; }
    // No `scopes` on the Google call on purpose: the plugin ALWAYS requests email+profile+openid
    // itself, and passing custom scopes is rejected on Android unless MainActivity implements the
    // plugin's marker interface ("You CANNOT use scopes without modifying the main activity").
    if (provider === 'google') {
      const r = await call({ provider: 'google' }, 'Google sign-in didn’t respond — please try again.');
      const idToken = r?.result?.idToken;
      if (!idToken) throw soft('Google sign-in returned nothing — please try again.');
      return idToken;
    }
    const r = await call({ provider: 'facebook', options: { permissions: ['email', 'public_profile'] } }, 'Facebook sign-in didn’t respond — please try again.');
    const token = r?.result?.accessToken?.token;
    if (!token) throw soft('Facebook sign-in returned nothing — please try again.');
    return token;
  } catch (e) { if (benignCancel(e)) e.cancelled = true; throw e; }
}

// Brand logos for the buttons.
const FB_LOGO = html`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z"/></svg>`;
const APPLE_LOGO = html`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>`;
const G_LOGO = html`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h5.9a5.05 5.05 0 0 1-2.19 3.31v2.75h3.55c2.08-1.91 3.24-4.73 3.24-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.55-2.75c-.98.66-2.24 1.06-3.73 1.06-2.87 0-5.3-1.94-6.17-4.55H2.16v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.83 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.16a11 11 0 0 0 0 9.88l3.67-2.84z"/><path fill="#EA4335" d="M12 5.35c1.62 0 3.06.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.16 7.06L5.83 9.9C6.7 7.29 9.13 5.35 12 5.35z"/></svg>`;

/**
 * Fills `box` with "Continue with Google / Facebook" buttons for the providers the server has enabled.
 * @param {(provider:'google'|'facebook'|'apple', credential:string|{identityToken,name}) => Promise<void>} onCredential
 * @param {(msg:string) => void} onError
 * @returns {boolean} whether any button was rendered
 */
// Google on the web uses Google's own rendered button; the others are ours.
export function mountSocialButtons(box, providers, { signup = false, onCredential, onError }) {
  const wanted = ['google', 'facebook', 'apple'].filter((p) => providers?.[p]);
  if (!wanted.length) return false;
  box.innerHTML = wanted.map((p) => (p === 'google' && !isNative
    ? '<div class="social-g" id="gBtn"></div>'
    : html`<button type="button" class="btn-social btn-${p}" data-p="${p}">${p === 'google' ? G_LOGO : p === 'apple' ? APPLE_LOGO : FB_LOGO}<span>Continue with ${p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : 'Facebook'}</span></button>`.s)).join('');
  const run = async (provider, get) => {
    try { const cred = await get(); if (cred) await onCredential(provider, cred); }
    catch (e) {
      if (e?.cancelled) return;
      // Only the server's or our own flagged messages are shown; SDK/provider internals (for example
      // Google's "activity is cancelled by the user") go to the console, never into the UI.
      if (e?.friendly || e?.status !== undefined) { onError(String(e.message || 'Sign-in failed. Please try again.')); return; }
      console.error('[social]', provider, e);
      onError(provider === 'facebook' ? 'Couldn’t sign you in with Facebook. Please try again or use your email.'
        : provider === 'apple' ? 'Couldn’t sign you in with Apple. Please try again or use your email.'
        : 'Couldn’t sign you in with Google. Please try again or use your email.');
    }
  };
  if (wanted.includes('google') && !isNative) {
    initGoogle(providers.google.clientId, (cred) => run('google', async () => cred)).then((gid) => {
      const el = $('#gBtn', box); if (!el) return;
      gid.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text: signup ? 'signup_with' : 'continue_with', logo_alignment: 'left', width: Math.min(400, Math.max(200, box.clientWidth || 340)) });
    }).catch(() => { const el = $('#gBtn', box); if (el) el.outerHTML = html`<button type="button" class="btn-social btn-google" disabled>${G_LOGO}<span>Google unavailable</span></button>`.s; });
  }
  // Facebook's SDK must already be loaded when the user taps (popup blockers), so preload it now.
  if (wanted.includes('facebook') && !isNative) initFacebook(providers.facebook).catch(() => {});
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.btn-social[data-p]'); if (!b) return;
    const p = b.dataset.p;
    if (isNative) return run(p, () => nativeCredential(p, providers));
    if (p === 'apple') return run(p, () => appleWeb(providers.apple));
    if (p === 'facebook') { if (!window.FB) return onError('Facebook is still loading — try again in a moment.'); run(p, () => facebookWeb(window.FB)); }
  });
  return true;
}
