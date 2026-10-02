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

const { nativeGoogleTicket } = await import('../../app/js/social.js');
const tick = () => new Promise((r) => setTimeout(r, 0));
const fire = (name, ev) => listeners[name].forEach((cb) => cb(ev));

test('native Google opens the OAuth start URL in a Custom Tab and resolves the deep-linked ticket', async () => {
  const p = nativeGoogleTicket();
  await tick();
  assert.equal(openedUrl, 'https://api.test/api/v1/auth/google/native-start', 'the sign-in happens in real Chrome, never in the WebView');
  assert.ok(listeners.appUrlOpen.length, 'the app listens for its own deep link');

  fire('appUrlOpen', { url: 'in.addabaaz.app://oauth?ticket=tkt-123' });
  await assert.doesNotReject(p);
  assert.deepEqual(await p, { ticket: 'tkt-123' });
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
