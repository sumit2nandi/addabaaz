import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { createFeatures } from '../src/features.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the promo credit repair migration adds amount_paise only when it is missing', () => {
  const migration = read('server/migrations/021_repair_credit_ledger_amount.sql');
  assert.match(migration, /information_schema\.COLUMNS/);
  assert.match(migration, /TABLE_NAME = 'user_credit'[\s\S]*COLUMN_NAME = 'amount_paise'/);
  assert.match(migration, /'ALTER TABLE user_credit ADD COLUMN amount_paise INT NOT NULL DEFAULT 0'/);
  assert.match(migration, /'SELECT 1'/, 'a healthy schema is a safe no-op');
  assert.match(migration, /SET amount_paise = remaining_paise[\s\S]*WHERE amount_paise = 0 AND remaining_paise > 0/,
    'any remaining legacy grant balance stays usable after the repair');
});

test('server error reports include verified account context and useful database diagnostics', () => {
  const app = read('server/src/app.js');
  const features = read('server/src/features.js');
  const db = read('server/src/db-extra.js');

  assert.match(app, /const userId = req\.user\?\.id \|\| req\.admin\?\.id \|\| null/,
    'server failures identify the viewer or administrator when the request is authenticated');
  assert.match(app, /HTTP \$\{status\} \$\{req\.method\}/, 'the stack records HTTP status and method');
  assert.match(app, /errorCode=\$\{err\.code \|\| 'unknown'\}/, 'database/provider error codes are retained');
  assert.match(app, /sqlState=\$\{err\.sqlState\}/, 'SQL state is retained when the driver provides it');
  assert.match(features, /userFromRequest\?\.\(req\)/, 'client errors resolve an optional first-party session');
  assert.match(features, /userId: user\?\.id \|\| null/, 'client-supplied IDs are not trusted');
  assert.match(db, /user_agent, user_id, created_at FROM error_log/);
  assert.match(db, /userId: r\.user_id \|\| null/, 'recent error reports include their account ID');
});

test('client error reports are linked to a verified session, never a browser-supplied user ID', async () => {
  const reports = [];
  const router = express.Router();
  router.use(express.json());
  const features = createFeatures({
    db: { errors: { async add(report) { reports.push(report); } } },
    secret: 'error-report-test-secret', mailer: { provider: 'none' }, push: null, catalog: {}, siteUrl: '', rate: false,
    publicUser: () => ({}), notDisabled: (user) => user,
    userFromRequest: async (req) => req.get('authorization') === 'Bearer valid-session' ? { id: 'verified-user-17' } : null,
  });
  features.public(router);
  const app = express(); app.use('/api/v1', router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/client-errors`;
  try {
    const response = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-session' },
      body: JSON.stringify({ message: 'Playback failure', stack: 'diagnostic trace', url: '/watch/title?token=secret', userId: 'forged-user' }),
    });
    assert.equal(response.status, 204);
    assert.equal(reports[0].userId, 'verified-user-17');
    assert.equal(reports[0].url, '/watch/title', 'the query string is still removed from saved URLs');

    await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Anonymous failure', userId: 'forged-user' }),
    });
    assert.equal(reports[1].userId, null, 'an unauthenticated client cannot attach someone else’s ID');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
