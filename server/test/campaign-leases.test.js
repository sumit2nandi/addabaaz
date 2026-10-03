// Broadcast lease tests run against MySQL because the conditional UPDATE is the cross-instance lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createDb } from '../src/db.js';
import { dbConfigFromEnv } from '../src/config.js';
import { migrate } from '../src/migrate.js';

const base = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...base, database: `addabaaz_test_campaign_${process.pid}_${Date.now().toString(36)}` };
let db;

test.before(async () => {
  try { db = await createDb({ config, ensureDatabase: true }); }
  catch (e) { throw new Error(`MySQL is not reachable (${e.code || e.message}). Set TEST_DATABASE_URL.`); }
  await migrate(db);
});
test.after(async () => { if (db) { await db.dropDatabase(); await db.close(); } });

test('campaign claims are atomic, owner-bound, renewable, and reclaimable after expiry', async () => {
  const id = crypto.randomUUID(), first = crypto.randomUUID(), second = crypto.randomUUID();
  await db.campaigns.create({ id, channel: 'push', audience: 'all', title: 'Test', body: 'Body', status: 'queued' });

  const claims = await Promise.all([db.campaigns.claim(id, first), db.campaigns.claim(id, second)]);
  assert.deepEqual([...claims].sort(), [false, true], 'only one instance can acquire the queued campaign');
  const owner = claims[0] ? first : second;
  const other = owner === first ? second : first;
  assert.equal(await db.campaigns.renew(id, other), false, 'another worker cannot renew the lease');
  assert.equal(await db.campaigns.renew(id, owner), true);
  assert.equal(await db.campaigns.progress(id, { sent: 1, failed: 0, skipped: 0, total: 1, cursor: 1 }, other), false);
  assert.equal(await db.campaigns.progress(id, { sent: 1, failed: 0, skipped: 0, total: 1, cursor: 1 }, owner), true);
  assert.equal(await db.campaigns.finish(id, 'sent', null, other), false, 'another worker cannot finish this campaign');

  await db.pool.query('UPDATE campaigns SET claim_until = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?', [id]);
  assert.equal(await db.campaigns.claim(id, other), true, 'an expired lease can be taken over');
  assert.equal(await db.campaigns.finish(id, 'sent', null, owner), false, 'the old owner is fenced out after takeover');
  assert.equal(await db.campaigns.finish(id, 'sent', null, other), true);
  assert.equal((await db.campaigns.get(id)).status, 'sent');
});
