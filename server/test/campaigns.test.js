import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaigns } from '../src/campaigns.js';

function fixture() {
  const row = {
    id: 'campaign-1', channel: 'push', audience: 'all', title: 'New episode', body: 'Watch now', url: '/', button: null,
    status: 'queued', total: 0, sent: 0, failed: 0, skipped: 0, cursor: 0, error: null,
    claimToken: null, claimUntil: 0,
  };
  const db = {
    campaigns: {
      async get(id) { return id === row.id ? { ...row } : null; },
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
  return { db, row };
}

const quietLog = { log() {}, warn() {}, error() {} };

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
