// Push adapters expose per-endpoint outcomes to campaign reporting without exposing push tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPush, endpointHash } from '../src/push.js';

const quietLog = { warn() {} };

test('web and native push report sent, failed, and expired recipients with account context', async () => {
  const subscriptions = [
    { id: 'web-good', userId: 'account-web-1', name: 'Priya Das', email: 'priya@example.com', endpoint: 'web-good', keys: {} },
    { id: 'web-gone', userId: 'account-web-2', name: 'Ravi Sen', email: 'ravi@example.com', endpoint: 'web-gone', keys: {} },
    { id: 'web-failed', userId: 'account-web-3', name: 'Nita Roy', email: 'nita@example.com', endpoint: 'web-failed', keys: {} },
  ];
  const devices = [
    { token: 'fcm-good', tokenHash: 'a'.repeat(64), userId: 'account-app-1', name: 'Mina Das', email: 'mina@example.com', platform: 'android', label: 'Pixel' },
    { token: 'fcm-dead', tokenHash: 'b'.repeat(64), userId: 'account-app-2', name: 'Sayan Roy', email: 'sayan@example.com', platform: 'ios', label: 'iPhone' },
    { token: 'fcm-failed', tokenHash: 'c'.repeat(64), userId: null, name: null, email: null, platform: 'android', label: 'Guest phone' },
  ];
  const removedSubscriptions = [], removedDevices = [], webFailures = [], reports = [];
  const db = {
    push: {
      async audience() { return subscriptions; },
      async ok() {},
      async failed(id) { webFailures.push(id); },
      async removeId(id) { removedSubscriptions.push(id); },
    },
    devices: {
      async audienceFor() { return devices; },
      async removeHash(hash) { removedDevices.push(hash); },
    },
  };
  const fcm = {
    configured: true,
    async send(tokens) {
      const results = tokens.map((token) => ({
        token, ok: token === 'fcm-good', dead: token === 'fcm-dead',
        error: token === 'fcm-failed' ? 'FCM temporarily unavailable.' : null,
      }));
      return { sent: 1, failed: 1, dead: ['fcm-dead'], results };
    },
  };
  const push = createPush({
    db, fcm, vapid: { publicKey: 'public' }, log: quietLog,
    sender: async (subscription) => {
      if (subscription.endpoint === 'web-gone') throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (subscription.endpoint === 'web-failed') throw Object.assign(new Error('provider down'), { statusCode: 503 });
    },
  });

  const result = await push.notify({ kind: 'all' }, { title: 'Hello', body: 'World' }, {
    onDelivery: async (entry) => reports.push({ ...entry }),
  });
  assert.deepEqual([result.sent, result.failed, result.removed], [2, 2, 2]);
  assert.deepEqual(removedSubscriptions, ['web-gone']);
  assert.deepEqual(removedDevices, [endpointHash('fcm-dead')]);
  assert.deepEqual(webFailures, ['web-failed']);

  const final = new Map();
  for (const report of reports) final.set(report.recipientKey, report);
  assert.deepEqual([...final.values()].map((d) => [d.status, d.transport]).sort(), [
    ['failed', 'app_push'], ['failed', 'web_push'], ['sent', 'app_push'], ['sent', 'web_push'],
    ['skipped', 'app_push'], ['skipped', 'web_push'],
  ]);
  assert.deepEqual([final.get('web-good').name, final.get('web-good').email], ['Priya Das', 'priya@example.com']);
  assert.deepEqual([final.get('a'.repeat(64)).name, final.get('a'.repeat(64)).destination], ['Mina Das', 'Android · Pixel']);
  assert.deepEqual([final.get('c'.repeat(64)).name, final.get('c'.repeat(64)).destination], ['Guest device', 'Android · Guest phone']);
  assert.match(final.get('web-failed').error, /HTTP 503/);
  assert.match(final.get('c'.repeat(64)).error, /temporarily unavailable/);
  assert.ok(reports.every((d) => !('token' in d) && !('endpoint' in d)), 'report callbacks never receive persisted raw targets');
});
