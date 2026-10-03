// Native app push registration is available to connected guests without uploading profile data.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const listeners = [];
let currentPermission = 'granted';
const messaging = {
  async checkPermissions() { return { receive: currentPermission }; },
  async requestPermissions() { return { receive: currentPermission }; },
  async getToken() { return { token: 'fcm-guest-unit-test-token-1234567890' }; },
  addListener(event, callback) { listeners.push({ event, callback }); return Promise.resolve({ remove() {} }); },
};
globalThis.window = {
  ADDABAAZ_ENV: { NATIVE_PUSH_ENABLED: true },
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { FirebaseMessaging: messaging } },
};

const { app } = await import('../../app/js/app.js');
const { attachNativePush, detachNativePush, initNativePush } = await import('../../app/js/push-native.js');

function makeUser() {
  const calls = { guest: [], account: [], removeGuest: [], removeAccount: [] };
  let accountChanged = null;
  const remote = {
    async registerGuestDevice(...args) { calls.guest.push(args); },
    async registerDevice(...args) { calls.account.push(args); },
    async removeGuestDevice(...args) { calls.removeGuest.push(args); },
    async removeDevice(...args) { calls.removeAccount.push(args); },
  };
  return {
    calls,
    user: { account: null, remote, on(event, callback) { if (event === 'account') accountChanged = callback; } },
    accountChanged: () => accountChanged?.(),
  };
}

function clearStorage() { values.clear(); }

test('connected guests register by default and explicit opt-out survives automatic retries', async () => {
  clearStorage();
  const { calls, user } = makeUser(); app.user = user;
  initNativePush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.guest.length, 1, 'guest registration starts on app boot');
  assert.deepEqual(calls.guest[0], ['fcm-guest-unit-test-token-1234567890', 'android', 'Android app']);
  assert.equal(localStorage.getItem('ab.pushOwner'), 'guest');
  assert.equal(await attachNativePush(), 'fcm-guest-unit-test-token-1234567890');
  assert.equal(calls.guest.length, 2, 'refreshing the app token is idempotent');

  await detachNativePush({ optOut: true });
  assert.equal(calls.removeGuest.length, 1, 'guest opt-out removes the anonymous server row');
  assert.equal(localStorage.getItem('ab.pushOptOut'), '1');
  assert.equal(await attachNativePush(), null, 'automatic registration respects opt-out');
  assert.equal(calls.guest.length, 2);

  await attachNativePush({ force: true });
  assert.equal(calls.guest.length, 3, 'the settings switch can explicitly re-enable notifications');
  assert.equal(localStorage.getItem('ab.pushOptOut'), null);
});

test('sign-in associates the current FCM token with the account', async () => {
  clearStorage(); currentPermission = 'granted';
  const { calls, user, accountChanged } = makeUser(); app.user = user;
  initNativePush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.guest.length, 1);
  user.account = { id: 'account-1' };
  await accountChanged();
  assert.equal(calls.account.length, 1);
  assert.equal(calls.account[0][0], 'fcm-guest-unit-test-token-1234567890');
  assert.equal(localStorage.getItem('ab.pushOwner'), 'account');
});

test('a revoked Android permission unregisters the token and blocks token-refresh re-registration', async () => {
  clearStorage(); currentPermission = 'granted';
  const { calls, user } = makeUser(); app.user = user;
  initNativePush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.guest.length, 1);

  currentPermission = 'denied';
  const tokenListener = [...listeners].reverse().find((listener) => listener.event === 'tokenReceived');
  await tokenListener.callback({ token: 'fcm-rotated-token-that-must-not-register' });
  assert.equal(calls.guest.length, 1, 'denied OS permission blocks refreshed registration');
  assert.equal(calls.removeGuest.length, 1, 'the prior anonymous token is removed');
  assert.equal(localStorage.getItem('ab.pushToken'), null);
  currentPermission = 'granted';
});
