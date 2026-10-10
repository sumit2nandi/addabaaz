// The generic deep-link router (platform.js) must route shared scheme/https links into the app,
// but leave the Google sign-in ticket link (in.addabaaz.app://oauth?ticket=…) for social.js -
// routing it as a page showed "Scene not found" right after the user picked their Google profile.
// Run: node --test test/frontend/platform-deeplink.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.document = document;
globalThis.window = window;
globalThis.location = { hash: '' };   // platform.js assigns to bare `location`

let appListener = null;
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'android',
  Plugins: {
    App: { addListener: (name, cb) => { if (name === 'appUrlOpen') appListener = cb; return Promise.resolve({ remove() {} }); } },
    StatusBar: { setStyle: async () => {}, setBackgroundColor: async () => {} },
    SplashScreen: { hide: async () => {} },
  },
};

const { initPlatform } = await import('../../app/js/platform.js');
initPlatform();

test('the platform registers its deep-link router on native shells', () => {
  assert.ok(appListener, 'appUrlOpen is handled');
});

test('the OAuth ticket deep link is NOT routed as a page (social.js consumes it)', () => {
  globalThis.location.hash = '#/';
  appListener({ url: 'in.addabaaz.app://oauth?ticket=tkt-1' });
  assert.equal(globalThis.location.hash, '#/', 'stays on the current view instead of "Scene not found"');
});

test('regular scheme deep links still route into the app', () => {
  globalThis.location.hash = '';
  appListener({ url: 'in.addabaaz.app://show/shahid' });
  assert.equal(globalThis.location.hash, '#/show/shahid');
});

test('https share links still route into the app, path and query included', () => {
  globalThis.location.hash = '';
  appListener({ url: 'https://addabaaz.in/show/shahid?x=1' });
  assert.equal(globalThis.location.hash, '#/show/shahid?x=1');
});
