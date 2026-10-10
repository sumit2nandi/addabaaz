// Firebase Cloud Messaging (server/src/fcm.js): service-account parsing, the signed OAuth2 assertion,
// access-token caching, per-token results and dead-token detection — with a fake fetch, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFcm, serviceAccountFromEnv, isServiceAccount } from '../src/fcm.js';

// A throw-away service account: a real RSA key, but no Google credentials behind it.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
const creds = { project_id: 'addabaaz-test', client_email: 'sender@addabaaz-test.iam.gserviceaccount.com', private_key: KEY, token_uri: 'https://oauth2.googleapis.com/token' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('service accounts are read from FCM_SERVICE_ACCOUNT or FCM_SERVICE_ACCOUNT_FILE', () => {
  assert.equal(serviceAccountFromEnv({}), null);
  assert.equal(serviceAccountFromEnv({ FCM_SERVICE_ACCOUNT: 'not json' }), null);
  assert.equal(serviceAccountFromEnv({ FCM_SERVICE_ACCOUNT: JSON.stringify(creds) }).project_id, 'addabaaz-test');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-fcm-'));
  const file = path.join(dir, 'sa.json'); fs.writeFileSync(file, JSON.stringify(creds));
  assert.equal(serviceAccountFromEnv({ FCM_SERVICE_ACCOUNT_FILE: file }).client_email, creds.client_email);
  assert.equal(serviceAccountFromEnv({ FCM_SERVICE_ACCOUNT_FILE: path.join(dir, 'missing.json') }), null);
  assert.equal(isServiceAccount(creds), true);
  assert.equal(isServiceAccount({ project_id: 'x' }), false);
});

test('without credentials the service is off and never calls out', async () => {
  let calls = 0;
  const fcm = createFcm({ fetchImpl: async () => { calls++; return json({}); } });
  assert.equal(fcm.configured, false);
  assert.deepEqual(await fcm.sendOne('token', { title: 'T', body: 'B' }), { ok: false, dead: false, error: 'not_configured' });
  assert.equal((await fcm.send(['a', 'b'], { title: 'T' })).sent, 0);
  assert.equal(calls, 0);
});

test('sends through FCM HTTP v1: signed assertion, cached access token, correct project + message', async () => {
  const requests = [];
  const fcm = createFcm({
    credentials: creds,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url === creds.token_uri) return json({ access_token: 'ya29.fake', expires_in: 3600 });
      return json({ name: `projects/${creds.project_id}/messages/1` });
    },
  });
  assert.equal(fcm.configured, true);
  assert.equal(fcm.projectId, 'addabaaz-test');

  const r = await fcm.sendOne('device-token-1', { title: 'New episode', body: 'S2 E1 is live', url: '/watch/abc', image: 'https://img/x.jpg', tag: 'campaign-1' });
  assert.deepEqual(r, { ok: true, dead: false });

  // 1) the OAuth2 call: a JWT bearer assertion signed with the service account's key.
  const [auth, send] = requests;
  assert.equal(auth.url, creds.token_uri); assert.equal(auth.init.method, 'POST');
  const assertion = new URLSearchParams(auth.init.body).get('assertion');
  const [h, c, s] = assertion.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.iss, creds.client_email); assert.equal(claims.aud, creds.token_uri);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging'); assert.ok(claims.exp > claims.iat);
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url')), true, 'signature verifies');

  // 2) the send call: right endpoint, bearer token, and the message payload the app relies on.
  assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/addabaaz-test/messages:send');
  assert.equal(send.init.headers.authorization, 'Bearer ya29.fake');
  const msg = JSON.parse(send.init.body).message;
  assert.equal(msg.token, 'device-token-1');
  assert.deepEqual(msg.notification, { title: 'New episode', body: 'S2 E1 is live', image: 'https://img/x.jpg' });
  assert.deepEqual(msg.data, { url: '/watch/abc', tag: 'campaign-1' });
  assert.equal(msg.android.priority, 'normal'); assert.equal(msg.apns.payload.aps.sound, 'default');

  // 3) the access token is reused for the next send (one auth call for many messages).
  await fcm.sendOne('device-token-2', { title: 'T', body: 'B' });
  assert.equal(requests.filter((x) => x.url === creds.token_uri).length, 1);
  // Payload fields are trimmed to what FCM accepts.
  const long = await (async () => { await fcm.sendOne('t3', { title: 'x'.repeat(200), body: 'y'.repeat(400) }); return JSON.parse(requests.at(-1).init.body).message.notification; })();
  assert.equal(long.title.length, 100); assert.equal(long.body.length, 200);
});

test('a rejected token is reported as dead (404/410/UNREGISTERED); other failures are retried', async () => {
  const fcm = createFcm({ credentials: creds, log: { warn() {} }, fetchImpl: async (url) => {
    if (url === creds.token_uri) return json({ access_token: 't', expires_in: 3600 });
    return json({ error: { status: 'UNREGISTERED', message: 'Requested entity was not found.' } }, 404);
  } });
  assert.deepEqual(await fcm.sendOne('gone', { title: 'T' }), { ok: false, dead: true, error: 'Requested entity was not found.' });

  const down = createFcm({ credentials: creds, log: { warn() {} }, fetchImpl: async (url) => (url === creds.token_uri ? json({ access_token: 't', expires_in: 3600 }) : json({ error: { status: 'UNAVAILABLE', message: 'Try again' } }, 503)) });
  assert.deepEqual(await down.sendOne('busy', { title: 'T' }), { ok: false, dead: false, error: 'Try again' });

  const refused = createFcm({ credentials: creds, log: { warn() {} }, fetchImpl: async () => json({ error: 'invalid_grant', error_description: 'Invalid JWT' }, 400) });
  await assert.rejects(() => refused.sendOne('x', { title: 'T' }), /FCM auth failed \(400\): Invalid JWT/);
});

test('send() dedupes tokens, counts failures, and reports the dead ones for cleanup', async () => {
  const fcm = createFcm({ credentials: creds, log: { warn() {} }, fetchImpl: async (url, init) => {
    if (url === creds.token_uri) return json({ access_token: 't', expires_in: 3600 });
    const token = JSON.parse(init.body).message.token;
    if (token === 'dead') return json({ error: { status: 'UNREGISTERED' } }, 410);
    if (token === 'flaky') return json({ error: { status: 'UNAVAILABLE', message: 'nope' } }, 503);
    return json({ name: 'ok' });
  } });
  const r = await fcm.send(['good1', 'good2', 'dead', 'flaky', 'good1', null], { title: 'T', body: 'B' });
  assert.equal(r.sent, 2); assert.equal(r.failed, 1); assert.deepEqual(r.dead, ['dead']);
  assert.deepEqual(r.results.map(({ token, ok, dead: isDead }) => ({ token, ok, dead: isDead })), [
    { token: 'good1', ok: true, dead: false }, { token: 'good2', ok: true, dead: false },
    { token: 'dead', ok: false, dead: true }, { token: 'flaky', ok: false, dead: false },
  ]);
  assert.deepEqual(await fcm.send([], { title: 'T' }), { sent: 0, failed: 0, dead: [], results: [] });
});
