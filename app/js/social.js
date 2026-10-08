/* Google & Facebook sign-in on the client.
 *
 * The client only obtains a credential from the provider; the ADDABAAZ API verifies it
 * (POST /auth/google {idToken}, POST /auth/facebook {accessToken}) and returns our own session token.
 *   - Web:            Google Identity Services button + Facebook JS SDK popup
 *   - Android:        Google shows the system "Use your account for …" sheet (Credential Manager via
 *                     @capgo/capacitor-social-login), falling back to the Custom Tab flow (see below)
 *   - iOS:            Google opens the API's native-page in a Chrome Custom Tab (one-time ticket
 *                     deep-linked back — Google's web flows are blocked inside app WebViews and the
 *                     native SDK needs extra URL-scheme setup on iOS); Facebook/Apple use native SDKs
 *                     through the Capacitor plugin @capgo/capacitor-social-login
 * Provider ids come from GET /auth/providers, so they're configured once, on the server.
 */
import { html, $ } from './util.js';
import { icon } from './icons.js';
import { isNative } from './platform.js';
import { CONFIG } from './config.js';
import { reportClientError } from './errors.js';

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
    // The plugin clears ONE provider per call (an empty provider is rejected), so clear each in
    // turn. Google's clearCredentialState is what makes the next "Use your account for …" sheet
    // show the account chooser instead of silently continuing as the previous account.
    const clear = (provider) => Promise.resolve(SL.logout({ provider })).catch(() => {});
    await Promise.race([
      Promise.all(['google', 'facebook', 'apple'].map(clear)),
      new Promise((res) => setTimeout(res, 5000)),
    ]);
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
// Facebook / Apple / Google-sheet use the Capacitor social-login plugin, initialised PER PROVIDER
// with the ids from the server: its initialize() rejects the whole call when any provider config is
// incomplete (Facebook without FACEBOOK_CLIENT_TOKEN, Apple on Android…), which must only break
// that provider. Google on iOS skips it entirely (see nativeGoogleTicket below).
function nativePlugin(providers, provider) {
  const SL = window.Capacitor?.Plugins?.SocialLogin;
  if (!SL) throw soft('Social sign-in isn’t available right now.');
  const ios = window.Capacitor?.getPlatform?.() === 'ios';
  const config =
    provider === 'google' && providers.google
      ? {
          google: {
            webClientId: providers.google.clientId,
            iOSClientId: providers.google.iosClientId,
            iOSServerClientId: providers.google.clientId,
            // Online mode: the flow returns both the ID token (verified by the API) and an access
            // token for the plugin's second step. Offline mode needs MainActivity edits — avoid it.
            mode: 'online',
          },
        }
      : // Apple is iOS-only here: sending `apple: {}` to Android makes initialize reject (it wants
        // redirectUrl/clientId) — Capgo issue #197.
        provider === 'apple' && providers.apple && ios
        ? { apple: {} }
        : // Facebook needs BOTH the app id and the client token: the plugin rejects the initialize
          // when either is missing ("facebook.clientToken is null or empty").
          provider === 'facebook' && providers.facebook?.appId && providers.facebook?.clientToken
          ? {
              facebook: {
                appId: providers.facebook.appId,
                clientToken: providers.facebook.clientToken,
              },
            }
          : null;
  if (!config) throw soft('Social sign-in isn’t available right now.');
  const ready = Promise.race([
    SL.initialize(config),
    new Promise((_, rej) => setTimeout(() => rej(soft('Sign-in couldn’t start — please try again.')), 12000)),
  ]);
  return { SL, ready };
}
// Native flow: get an ID token (Google/Apple) or access token (Facebook) from the platform SDK; user cancellation is flagged, not treated as an error.
// Every native call also races a timeout: a stuck SDK must produce a visible message, never a dead button.
// Silent ONLY for a plain dismissal ("…canceled", "Login cancelled"). Long errors that merely mention
// cancelling are shown, or sign-in dies with no feedback at all.
const benignCancel = (e) => /(^|[\s:])(cancel(ed|led)?)\.?$/i.test(String(e?.message || '').trim());
// For the native Google sheet, a dismissal really is "…cancelled by the user" (the system's
// cancellation exception) — treat that pattern as the user's decision; every other sheet failure
// (missing OAuth client/SHA-1, no Play services, plugin errors) falls back to the Custom Tab flow.
const userCancelled = (e) => {
  const m = String(e?.message || '');
  return benignCancel(e) || (/cancel/i.test(m) && /(user|dismiss)/i.test(m));
};

/* ---------- native: Google via the system browser (Chrome Custom Tab) ----------
 * Opens the API's /auth/google/native-page (the website's own Google button) in real Chrome;
 * after the user signs in, that page deep-links in.addabaaz.app://oauth?ticket=… back into the
 * app (MainActivity has an intent filter for that scheme), and the ticket is exchanged for our
 * session by signInSocial. platform.js's generic deep-link router skips the `oauth` host. */
const APP_SCHEME = 'in.addabaaz.app';
export function nativeGoogleTicket() {
  const Browser = window.Capacitor?.Plugins?.Browser, App = window.Capacitor?.Plugins?.App;
  if (!Browser?.open || !App?.addListener) throw soft('Google sign-in isn’t available in this app build.');
  return new Promise((resolve, reject) => {
    let settled = false;
    let urlHandle = null, closeHandle = null, timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      Promise.resolve(urlHandle).then((h) => h?.remove?.()).catch(() => {});
      Promise.resolve(closeHandle).then((h) => h?.remove?.()).catch(() => {});
      try { Browser.close?.(); } catch { /* already closed */ }
    };
    const settle = (fn) => { if (settled) return; settled = true; cleanup(); fn(); };
    timer = setTimeout(() => settle(() => reject(soft('Google sign-in timed out — please try again.'))), 120_000);
    urlHandle = App.addListener('appUrlOpen', (ev) => {
      const url = String(ev?.url || '');
      if (!url.startsWith(`${APP_SCHEME}://oauth`)) return;
      const ticket = new URL(url).searchParams.get('ticket');
      settle(() => (ticket ? resolve({ ticket }) : reject(Object.assign(new Error('cancelled'), { cancelled: true }))));
    });
    // Closing the tab without finishing = the user changed their mind: a quiet cancel, not an error.
    // BUT the tab also closes by itself when the ticket deep link hands off to the app, so a closed
    // tab is only a cancel once the deep link has had a moment to land (otherwise sign-in silently
    // dies right after the user picked their Google profile).
    closeHandle = Browser.addListener?.('browserFinished', () => {
      setTimeout(() => settle(() => reject(Object.assign(new Error('cancelled'), { cancelled: true }))), 2000);
    });
    const base = CONFIG.apiBase && CONFIG.apiBase !== 'off' ? CONFIG.apiBase : '';
    Browser.open({ url: `${base}/api/v1/auth/google/native-page` })
      .catch(() => settle(() => reject(soft('Couldn’t open Google — check your connection.'))));
  });
}
async function nativeCredential(provider, providers) {
  // Google on Android shows the system "Use your account for …" sheet (Credential Manager /
  // Sign in with Google) and returns the ID token that the API already verifies via /auth/google.
  // The sheet needs a Google console Android client (package + signing-key SHA-1) for the build,
  // so whenever it cannot run — OAuth client not registered yet, no Play services, plugin error —
  // fall back to the Custom Tab flow below instead of leaving the user stuck.
  if (provider === 'google') {
    // iOS keeps the Custom Tab flow: the native Google flow there needs extra URL-scheme setup.
    if (window.Capacitor?.getPlatform?.() !== 'ios') {
      try {
        const { SL, ready } = nativePlugin(providers, 'google');
        await ready;
        const r = await Promise.race([
          SL.login({ provider: 'google' }),
          new Promise((_, rej) =>
            setTimeout(() => rej(soft('Google sign-in timed out — please try again.')), 30000)
          ),
        ]);
        const idToken = r?.result?.idToken;
        if (!idToken) throw soft('Google sign-in returned nothing — please try again.');
        return idToken;
      } catch (e) {
        // Dismissing the sheet is a decision, not a failure. Anything else falls through to the
        // Custom Tab flow so the button can never die quietly.
        if (userCancelled(e)) {
          throw Object.assign(e instanceof Error ? e : new Error(String(e?.message || 'cancelled')), {
            cancelled: true,
          });
        }
      }
    }
    return nativeGoogleTicket();
  }
  const { SL, ready } = nativePlugin(providers, provider); await ready;
  const call = (opts, msg) => Promise.race([
    SL.login(opts),
    new Promise((_, rej) => setTimeout(() => rej(soft(msg)), 30000)),
  ]);
  try {
    if (provider === 'apple') { const r = await call({ provider: 'apple', options: { scopes: ['email', 'name'] } }, 'Apple sign-in didn’t respond — please try again.'); const n = r.result?.profile; return { identityToken: r.result?.idToken, name: n ? [n.givenName, n.familyName].filter(Boolean).join(' ') : '' }; }
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
  box.classList.add('social-compact');
  box.innerHTML = wanted.map((p) => (p === 'google' && !isNative
    ? '<div class="social-g" id="gBtn"><div class="gsi-real"></div></div>'
    : html`<button type="button" class="btn-social btn-${p}" data-p="${p}" aria-label="Continue with ${p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : 'Facebook'}" title="Continue with ${p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : 'Facebook'}">${p === 'google' ? G_LOGO : p === 'apple' ? APPLE_LOGO : FB_LOGO}</button>`.s)).join('');
  const run = async (provider, get) => {
    try { const cred = await get(); if (cred) await onCredential(provider, cred); }
    catch (e) {
      if (e?.cancelled) return;
      // Only the server's or our own flagged messages are shown; SDK/provider internals (for example
      // Google's "activity is cancelled by the user") go to the console, never into the UI.
      if (e?.friendly || e?.status !== undefined) {
        if (e?.friendly && e?.status === undefined) reportClientError(e, { where: `social-signin-${provider}` });
        onError(String(e.message || 'Sign-in failed. Please try again.')); return;
      }
      reportClientError(e, { where: `social-signin-${provider}` });
      console.error('[social]', provider, e);
      onError(provider === 'facebook' ? 'Couldn’t sign you in with Facebook. Please try again or use your email.'
        : provider === 'apple' ? 'Couldn’t sign you in with Apple. Please try again or use your email.'
        : 'Couldn’t sign you in with Google. Please try again or use your email.');
    }
  };
  if (wanted.includes('google') && !isNative) {
    initGoogle(providers.google.clientId, (cred) => run('google', async () => cred)).then((gid) => {
      const el = $('#gBtn', box); if (!el) return;
      // Google's button is the only thing in this slot: it stays blank until Google has drawn it, then fades in.
      // A fixed numeric width means Google never re-measures it.
      const real = $('.gsi-real', el);
      gid.renderButton(real, { type: 'standard', theme: 'filled_black', size: 'medium', shape: 'pill', text: signup ? 'signup_with' : 'continue_with', logo_alignment: 'left', width: Math.max(200, Math.min(280, Math.round(real.clientWidth || el.clientWidth || 260))) });
      const reveal = () => el.classList.add('ready');
      real.querySelector('iframe')?.addEventListener('load', reveal, { once: true });
      setTimeout(reveal, 1500);
    }).catch(() => { const el = $('#gBtn', box); if (el) el.outerHTML = html`<button type="button" class="btn-social btn-google" disabled aria-label="Google sign-in unavailable" title="Google sign-in unavailable">${G_LOGO}</button>`.s; });
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
