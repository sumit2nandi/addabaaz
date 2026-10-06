import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaigns } from '../src/campaigns.js';
import { createMailer } from '../src/mailer.js';
import { normalizeImage } from '../src/admin-extra.js';
import { createR2 } from '../src/r2.js';

function fixture(overrides = {}) {
  const row = {
    id: 'campaign-1', channel: 'push', audience: 'all', title: 'New episode', body: 'Watch now', url: '/', button: null,
    status: 'queued', total: 0, sent: 0, failed: 0, skipped: 0, cursor: 0, error: null,
    claimToken: null, claimUntil: 0, ...overrides,
  };
  const deliveries = [];
  const db = {
    campaigns: {
      async get(id) { return id === row.id ? { ...row } : null; },
      async recordDelivery(id, delivery) {
        assert.equal(id, row.id);
        const index = deliveries.findIndex((item) => item.deliveryKey === delivery.deliveryKey);
        if (index < 0) deliveries.push({ ...delivery }); else deliveries[index] = { ...deliveries[index], ...delivery };
      },
      async claim(id, token, leaseSeconds) {
        if (id !== row.id || !['queued', 'sending'].includes(row.status) || (row.claimToken && row.claimUntil > Date.now())) return false;
        row.status = 'sending'; row.claimToken = token; row.claimUntil = Date.now() + leaseSeconds * 1000;
        return true;
      },
      async renew(id, token, leaseSeconds) {
        if (id !== row.id || row.status !== 'sending' || row.claimToken !== token || row.claimUntil <= Date.now()) return false;
        row.claimUntil = Date.now() + leaseSeconds * 1000;
        return true;
      },
      async progress(id, values, token) {
        if (id !== row.id || row.status !== 'sending' || row.claimToken !== token || row.claimUntil <= Date.now()) return false;
        for (const key of ['sent', 'failed', 'skipped']) row[key] += Number(values[key]) || 0;
        row.total = Math.max(row.total, Number(values.total) || 0);
        row.cursor = Number(values.cursor) || 0;
        row.claimUntil = Date.now() + 300_000;
        return true;
      },
      async finish(id, status, error = null, token = null) {
        if (id !== row.id || (token && row.claimToken !== token)) return false;
        row.status = status; row.error = error; row.claimToken = null; row.claimUntil = 0;
        return true;
      },
      async unfinished() { return row.status === 'queued' || row.claimUntil <= Date.now() ? [{ ...row }] : []; },
    },
  };
  return { db, row, deliveries };
}

const quietLog = { log() {}, warn() {}, error() {} };

test('broadcast image URLs accept uploaded, R2, media, and https paths in canonical form', () => {
  const uploadPath = 'uploads/dc4d24a1667f00aabbccdde1.webp';
  const mediaPath = 'media/bts/song-bts-1-lg.webp';
  const r2Path = 'r2-assets/broadcast/dc4d24a1667f00aabbccdde1.webp';
  assert.equal(normalizeImage(uploadPath), `/${uploadPath}`);
  assert.equal(normalizeImage(`/${uploadPath}`), `/${uploadPath}`);
  assert.equal(normalizeImage(mediaPath), `/${mediaPath}`);
  assert.equal(normalizeImage(`/${mediaPath}`), `/${mediaPath}`);
  assert.equal(normalizeImage(r2Path), `/${r2Path}`);
  assert.equal(normalizeImage(`/${r2Path}`), `/${r2Path}`);
  assert.equal(normalizeImage('https://cdn.example.com/broadcast.webp'), 'https://cdn.example.com/broadcast.webp');
  assert.equal(normalizeImage('http://cdn.example.com/broadcast.webp'), '', 'insecure remote image URLs stay rejected');
  assert.equal(normalizeImage('uploads/broadcast.webp?download=1'), '', 'unsupported URL components stay rejected');
  assert.equal(normalizeImage('r2-assets/private/secret.png'), '', 'only broadcast R2 objects can be shown publicly');
});

test('R2 putObject sends validated media bytes with the right object metadata', async () => {
  const requests = [];
  const r2 = createR2({ R2_ACCOUNT_ID: 'acct123', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK', R2_BUCKET: 'addabaaz-media' }, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, headers: { get: (name) => name.toLowerCase() === 'etag' ? '"etag-1"' : null } };
    },
  });
  const bytes = Buffer.from('image bytes');
  assert.deepEqual(await r2.putObject('broadcast/photo.webp', bytes, { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' }), { status: 200, etag: '"etag-1"' });
  assert.match(requests[0].url, /\/addabaaz-media\/broadcast\/photo\.webp\?/);
  assert.equal(requests[0].init.method, 'PUT');
  assert.equal(requests[0].init.body, bytes);
  assert.deepEqual(requests[0].init.headers, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' });
});

test('separate campaign workers cannot send the same campaign concurrently', async () => {
  const { db, row } = fixture();
  let sends = 0;
  const push = {
    configured: true,
    async notify() {
      sends++;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { sent: 1, failed: 0, removed: 0 };
    },
  };
  const first = createCampaigns({ db, push, log: quietLog });
  const second = createCampaigns({ db, push, log: quietLog });

  await Promise.all([first.run(row.id), second.run(row.id)]);
  assert.equal(sends, 1);
  assert.equal(row.status, 'sent');
  assert.equal(row.sent, 1);
  assert.equal(row.claimToken, null);
});

test('an expired campaign lease can be reclaimed after a worker crash', async () => {
  const { db, row } = fixture();
  row.status = 'sending'; row.claimToken = 'dead-worker'; row.claimUntil = Date.now() - 1;
  let sends = 0;
  const campaigns = createCampaigns({ db, push: { configured: true, async notify() { sends++; return { sent: 1, failed: 0, removed: 0 }; } }, log: quietLog });

  await campaigns.run(row.id);
  assert.equal(sends, 1);
  assert.equal(row.status, 'sent');
  assert.equal(row.claimToken, null);
});

test('push campaigns persist account-associated per-device outcomes', async () => {
  const { db, row, deliveries } = fixture();
  const push = {
    configured: true,
    async notify(_audience, _message, { onDelivery }) {
      await onDelivery({ recipientKey: 'device-hash-a', userId: 'account-a', name: 'Priya Das', email: 'priya@example.com', transport: 'app_push', destination: 'Android · Pixel 7', status: 'pending' });
      await onDelivery({ recipientKey: 'device-hash-a', userId: 'account-a', name: 'Priya Das', email: 'priya@example.com', transport: 'app_push', destination: 'Android · Pixel 7', status: 'sent' });
      await onDelivery({ recipientKey: 'device-hash-b', userId: 'account-b', name: 'Ravi Sen', email: 'ravi@example.com', transport: 'web_push', destination: 'Browser / web app', status: 'pending' });
      await onDelivery({ recipientKey: 'device-hash-b', userId: 'account-b', name: 'Ravi Sen', email: 'ravi@example.com', transport: 'web_push', destination: 'Browser / web app', status: 'failed', error: 'Web Push HTTP 503' });
      return { sent: 1, failed: 1, removed: 0 };
    },
  };
  await createCampaigns({ db, push, log: quietLog }).run(row.id);
  assert.equal(row.status, 'partial');
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries.map((d) => [d.userId, d.name, d.email, d.status]), [
    ['account-a', 'Priya Das', 'priya@example.com', 'sent'],
    ['account-b', 'Ravi Sen', 'ravi@example.com', 'failed'],
  ]);
  assert.equal(deliveries[1].error, 'Web Push HTTP 503');
});

test('SMTP recipient-level rejection is surfaced as a failed delivery', async () => {
  const rejected = createMailer({ transport: { async sendMail() { return { accepted: [], rejected: ['viewer@example.com'] }; } } });
  await assert.rejects(() => rejected.send({ to: 'viewer@example.com', subject: 'T', text: 'B' }), { code: 'smtp_recipient_rejected' });
  const accepted = createMailer({ transport: { async sendMail() { return { accepted: ['viewer@example.com'], rejected: [] }; } } });
  assert.deepEqual(await accepted.send({ to: 'viewer@example.com', subject: 'T', text: 'B' }), { sent: true });
});

test('email campaigns persist recipient names, addresses, and each final outcome', async () => {
  const { db, row, deliveries } = fixture({ id: 'email-campaign', channel: 'email', title: 'Update', cursor: 0 });
  const audience = [
    { id: 'account-a', name: 'Priya Das', email: 'same@example.com' },
    { id: 'account-b', name: 'P. Das', email: 'SAME@example.com' },
    { id: 'account-c', name: 'Ravi Sen', email: 'failed@example.com' },
    { id: 'account-d', name: 'Nita Roy', email: 'skipped@example.com' },
  ];
  db.adminUsers = { async emailAudience(_filter, { limit, offset }) { return audience.slice(offset, offset + limit); } };
  const campaigns = createCampaigns({
    db, log: quietLog, pageSize: 2,
    mailer: { provider: 'smtp', async send({ to }) {
      if (to === 'failed@example.com') throw new Error('SMTP connection refused');
      if (to === 'skipped@example.com') return { sent: false };
      return { sent: true };
    } },
    email: ({ subject }) => ({ subject, text: 'message' }),
  });

  await campaigns.run(row.id, { siteUrl: 'https://addabaaz.test' });
  assert.equal(row.status, 'partial');
  assert.deepEqual([row.sent, row.failed, row.skipped, row.total], [1, 1, 2, 4]);
  assert.equal(deliveries.length, 4, 'one durable recipient record per eligible account');
  const result = new Map(deliveries.map((d) => [d.userId, d]));
  assert.deepEqual([result.get('account-a').status, result.get('account-b').status, result.get('account-c').status, result.get('account-d').status],
    ['sent', 'skipped', 'failed', 'skipped']);
  assert.deepEqual([result.get('account-a').name, result.get('account-a').email], ['Priya Das', 'same@example.com']);
  assert.match(result.get('account-b').error, /already included/);
  assert.match(result.get('account-c').error, /SMTP connection refused/);
  assert.match(result.get('account-d').error, /did not accept/);
  assert.ok(deliveries.every((d) => /^[a-f0-9]{64}$/i.test(d.deliveryKey)), 'recipient keys are digests, not account identifiers');
});
