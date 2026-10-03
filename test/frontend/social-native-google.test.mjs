// Native Google sign-in must leave the WebView: the app opens the API's OAuth start URL in a
// Custom Tab and receives a one-time ticket over the in.addabaaz.app:// deep link.
// Run: node --test test/frontend/social-native-google.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.document = document;
globalThis.window = window;
window.ADDABAAZ_ENV = { API_BASE: 'https://api.test' };

const listeners = { appUrlOpen: [], browserFinished: [] };
let openedUrl = null;
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'android',
  Plugins: {
    App: {
      addListener: (name, cb) => { (listeners[name] ||= []).push(cb); return Promise.resolve({ remove: () => { listeners[name] = listeners[name].filter((x) => x !== cb); } }); },
    },
    Browser: {
      open: async (opts) => { openedUrl = opts.url; },
      close: async () => {},
      addListener: (name, cb) => { (listeners[name] ||= []).push(cb); return Promise.resolve({ remove: () => { listeners[name] = listeners[name].filter((x) => x !== cb); } }); },
    },
  },
};

const { nativeGoogleTicket, mountSocialButtons, forgetNativeSession } = await import('../../app/js/social.js');
const tick = () => new Promise((r) => setTimeout(r, 0));
const fire = (name, ev) => listeners[name].forEach((cb) => cb(ev));

// Mounts the native social buttons and taps "Continue with Google".
async function tapGoogle(providers) {
  const box = document.createElement('div');
  document.body.appendChild(box);
  const outcome = { cred: null, err: null };
  const shown = mountSocialButtons(box, providers, {
    onCredential: async (p, c) => { outcome.cred = { p, c }; },
    onError: (m) => { outcome.err = m; },
  });
  assert.equal(shown, true);
  const btn = box.querySelector('.btn-social[data-p="google"]');
  assert.ok(btn, 'native renders our own Google button (not the GIS div)');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  return outcome;
}

test('Continue with Google opens the system sheet and passes the returned ID token to the API flow', async () => {
  // Android Google sign-in = the Credential Manager "Use your account for …" sheet
  // (GetSignInWithGoogleOption) via the Capgo plugin. The result goes back as the plain ID
  // token string that signInSocial already posts to /auth/google.
  openedUrl = null;
  const initCalls = [], loginCalls = [];
  window.Capacitor.Plugins.SocialLogin = {
    initialize: async (opts) => { initCalls.push(opts); },
    login: async (opts) => { loginCalls.push(opts); return { provider: 'google', result: { idToken: 'idt-sheet-1' } }; },
    logout: async () => {},
  };
  const outcome = await tapGoogle({ google: { clientId: 'g-web' }, facebook: { appId: '1' } });
  await tick();
  assert.deepEqual(outcome.cred, { p: 'google', c: 'idt-sheet-1' }, 'the sheet’s ID token is the credential');
  assert.equal(outcome.err, null);
  assert.equal(openedUrl, null, 'no Custom Tab when the sheet succeeds');
  assert.deepEqual(loginCalls, [{ provider: 'google' }]);
  // Per-provider initialise: a half-configured Facebook (no clientToken) must not ride along
  // and take the Google initialise down with it.
  assert.equal(initCalls.length, 1);
  assert.deepEqual(Object.keys(initCalls[0]), ['google']);
  assert.equal(initCalls[0].google.webClientId, 'g-web');
  assert.equal(initCalls[0].google.mode, 'online');
});

test('when the Google sheet cannot run, Continue with Google falls back to the Custom Tab flow', async () => {
  // Missing/incorrect OAuth client, no Play services, plugin errors — any non-dismissal failure
  // must land in the Custom Tab flow instead of leaving the button dead.
  openedUrl = null;
  window.Capacitor.Plugins.SocialLogin = {
    initialize: async () => {},
    login: async () => { throw Object.assign(new Error('Google Sign-In failed: Failed to get access token')); },
    logout: async () => {},
  };
  const outcome = await tapGoogle({ google: { clientId: 'g-web' } });
  await tick();
  assert.equal(openedUrl, 'https://api.test/api/v1/auth/google/native-page', 'the Custom Tab opens as the fallback');
  fire('appUrlOpen', { url: 'in.addabaaz.app://oauth?ticket=tkt-fallback' });
  await tick();
  assert.deepEqual(outcome.cred, { p: 'google', c: { ticket: 'tkt-fallback' } });
  assert.equal(outcome.err, null);
});

test('a failing SocialLogin.initialize still falls back to the Custom Tab flow', async () => {
  openedUrl = null;
  window.Capacitor.Plugins.SocialLogin = {
    initialize: async () => { throw Object.assign(new Error('webClientId is null or empty')); },
    login: async () => { throw new Error('SocialLogin.login must never be reached'); },
    logout: async () => {},
  };
  const outcome = await tapGoogle({ google: { clientId: 'g-web' } });
  await tick();
  assert.equal(openedUrl, 'https://api.test/api/v1/auth/google/native-page');
  fire('appUrlOpen', { url: 'in.addabaaz.app://oauth?ticket=tkt-init-broken' });
  await tick();
  assert.deepEqual(outcome.cred, { p: 'google', c: { ticket: 'tkt-init-broken' } });
  assert.equal(outcome.err, null);
});

test('dismissing the Google sheet is a quiet cancel and does not open the Custom Tab', async () => {
  openedUrl = null;
  window.Capacitor.Plugins.SocialLogin = {
    initialize: async () => {},
    // The Credential Manager cancellation exception says exactly this on dismissal.
    login: async () => { throw Object.assign(new Error('Google Sign-In failed: Activity is cancelled by the user')); },
    logout: async () => {},
  };
  const outcome = await tapGoogle({ google: { clientId: 'g-web' } });
  await tick();
  assert.equal(outcome.cred, null);
  assert.equal(outcome.err, null, 'a dismissal shows no error');
  assert.equal(openedUrl, null, 'a dismissal must not shove the user into the web flow');
});

test('Continue with Google runs the Custom Tab flow when the SocialLogin plugin is missing entirely', async () => {
  delete window.Capacitor.Plugins.SocialLogin;
  openedUrl = null;
  const outcome = await tapGoogle({ google: { clientId: 'g-web' } });
  await tick();
  assert.equal(openedUrl, 'https://api.test/api/v1/auth/google/native-page', 'the Custom Tab opens without any social-login plugin');
  fire('appUrlOpen', { url: 'in.addabaaz.app://oauth?ticket=tkt-no-plugin' });
  await tick();
  assert.deepEqual(outcome.cred, { p: 'google', c: { ticket: 'tkt-no-plugin' } });
  assert.equal(outcome.err, null);
});

test('iOS keeps the Custom Tab flow (the sheet is Android-only for now)', async () => {
  openedUrl = null;
  window.Capacitor.getPlatform = () => 'ios';
  try {
    window.Capacitor.Plugins.SocialLogin = {
      initialize: async () => {},
      login: async () => { throw new Error('the sheet must never be used on iOS'); },
      logout: async () => {},
    };
    const outcome = await tapGoogle({ google: { clientId: 'g-web' } });
    await tick();
    assert.equal(openedUrl, 'https://api.test/api/v1/auth/google/native-page', 'iOS signs in through the Custom Tab');
    fire('appUrlOpen', { url: 'in.addabaaz.app://oauth?ticket=tkt-ios' });
    await tick();
    assert.deepEqual(outcome.cred, { p: 'google', c: { ticket: 'tkt-ios' } });
  } finally {
    window.Capacitor.getPlatform = () => 'android';
  }
});

test('forgetNativeSession clears each provider separately', async () => {
  const logoutCalls = [];
  window.Capacitor.Plugins.SocialLogin = {
    initialize: async () => {},
    login: async () => {},
    logout: async (opts) => { logoutCalls.push(opts); },
  };
  await forgetNativeSession();
  assert.deepEqual(logoutCalls, [{ provider: 'google' }, { provider: 'facebook' }, { provider: 'apple' }], 'the plugin rejects a logout without a provider — one call per provider');
});

test('native Google opens the OAuth start URL in a Custom Tab and resolves the deep-linked ticket', async () => {
  const p = nativeGoogleTicket();
  await tick();
  assert.equal(openedUrl, 'https://api.test/api/v1/auth/google/native-page', 'the sign-in happens in real Chrome, never in the WebView');
  assert.ok(listeners.appUrlOpen.length, 'the app listens for its own deep link');

  fire('appUrlOpen', { url: 'in.addabaaz.app://oauth?ticket=tkt-123' });
  await assert.doesNotReject(p);
  assert.deepEqual(await p, { ticket: 'tkt-123' });
});

test('the tab closing as the deep link hands off does NOT cancel the sign-in', async () => {
  const p = nativeGoogleTicket();
  await tick();
  // Chrome closes the Custom Tab the moment the ticket deep link launches the app -
  // browserFinished lands first; the ticket must still win.
  fire('browserFinished', {});
  fire('appUrlOpen', { url: 'in.addabaaz.app://oauth?ticket=tkt-race' });
  assert.deepEqual(await p, { ticket: 'tkt-race' });
});

test('closing the tab without signing in is a quiet cancel, and late deep links are ignored', async () => {
  const p = nativeGoogleTicket();
  await tick();
  fire('browserFinished', {});
  await assert.rejects(p, (e) => e.cancelled === true, 'closing the Custom Tab cancels quietly');

  // A stale deep link arriving after settlement must not resurrect the finished flow.
  fire('appUrlOpen', { url: 'in.addabaaz.app://oauth?ticket=late' });
  await tick();
});

test('unrelated deep links do not settle the flow', async () => {
  const p = nativeGoogleTicket();
  await tick();
  fire('appUrlOpen', { url: 'in.addabaaz.app://watch/abc' });
  await tick();
  fire('appUrlOpen', { url: 'https://example.com/whatever' });
  await tick();
  // Still pending: settle it via the real deep link so no listener leaks into other tests.
  fire('appUrlOpen', { url: 'in.addabaaz.app://oauth?ticket=ok' });
  assert.deepEqual(await p, { ticket: 'ok' });
});
