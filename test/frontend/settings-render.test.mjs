// The settings sub-pages must actually DRAW (a source-pattern test cannot catch escaped markup:
// interpolating a plain string into html`` renders visible tags instead of elements, and the wiring
// then throws on the missing nodes). Renders every group with a signed-in mock user.
// Run: node --test test/frontend/settings-render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body><main id="view"></main><div id="toasts"></div></body></html>');
globalThis.window = window; globalThis.document = document;
globalThis.location = { protocol: 'https:', origin: 'https://t.in', pathname: '/', hash: '', href: 'https://t.in/', search: '' };
window.location = globalThis.location;
globalThis.localStorage = window.localStorage ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch = async () => { throw new Error('offline'); };

const { app } = await import('../../app/js/app.js');
app.user = {
  account: { name: 'Tester', email: 't@example.in', emailVerified: true, hasPassword: true, providers: ['google'] },
  profile: { id: 'p1', name: 'Tester' },
  supportsAuth: true, isPremium: false, mode: 'remote', hasPin: false,
  pref: () => false, setPref: () => {}, clearHistory: () => {},
  on: () => () => {},
  remote: {
    resendVerification: async () => {}, forgotPassword: async () => {},
    devices: async () => ({ streamLimit: 2, devices: [] }), forgetDevice: async () => {},
  },
  changePassword: async () => {}, signOutEverywhere: async () => {},
  setPin: async () => ({}), verifyPin: async () => ({}), removePin: async () => ({}),
  credits: async () => null, inviteLink: async () => null, redeemInvite: async () => ({}),
  signOut: async () => {}, deleteAccount: async () => {},
};
const settings = (await import('../../app/js/views/settings.js')).default;

test('every settings group renders a real section with a back link', async () => {
  for (const id of ['playback', 'security', 'kids', 'refer', 'notify']) {
    const root = document.createElement('div');
    const ctx = { root, params: { group: id }, query: {}, path: `/account/${id}`, title: '', setTitle(t) { ctx.title = t; }, onCleanup: () => {} };
    await settings(ctx); // must not throw (wiring runs against the freshly drawn section)
    await new Promise((r) => setTimeout(r, 30)); // async slots (referral, notifications) settle
    assert.ok(ctx.title, `${id} sets a tab title`);
    assert.ok(root.querySelector('button.account-edit-back[data-page-back]'), `${id} offers a way back`);
    assert.ok(root.querySelector('.account-section'), `${id} draws a real section, not escaped markup`);
  }
});

test('the danger group bounces to the delete-account page without drawing a section', async () => {
  const savedHistory = globalThis.history, savedHash = globalThis.HashChangeEvent;
  let replaced = '';
  globalThis.history = { length: 2, state: null, replaceState(_s, _t, url) { replaced = url; }, pushState() {} };
  globalThis.HashChangeEvent = window.Event;
  try {
    const root = document.createElement('div');
    const ctx = { root, params: { group: 'danger' }, query: {}, path: '/account/danger', title: '', setTitle() {}, onCleanup: () => {} };
    await settings(ctx);
    assert.equal(replaced, '#/delete-account', 'danger redirects to the delete-account page');
    assert.equal(root.querySelector('.account-section'), null, 'nothing is drawn before the redirect');
  } finally {
    if (savedHistory === undefined) delete globalThis.history; else globalThis.history = savedHistory;
    if (savedHash === undefined) delete globalThis.HashChangeEvent; else globalThis.HashChangeEvent = savedHash;
  }
});
