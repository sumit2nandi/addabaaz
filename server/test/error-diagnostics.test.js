import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { createFeatures } from '../src/features.js';
import { queryRows } from '../src/db.js';
import { extraDb } from '../src/db-extra.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('credit-ledger migrations recheck amount_paise safely, including after an older repair was recorded', () => {
  for (const file of ['021_repair_credit_ledger_amount.sql', '022_verify_credit_ledger_amount.sql', '024_repair_credit_ledger_amount_again.sql']) {
    const migration = read(`server/migrations/${file}`);
    assert.match(migration, /information_schema\.COLUMNS/, `${file} checks the active database schema`);
    assert.match(migration, /TABLE_NAME = 'user_credit'[\s\S]*COLUMN_NAME = 'amount_paise'/);
    assert.match(migration, /'ALTER TABLE user_credit ADD COLUMN amount_paise INT NOT NULL DEFAULT 0'/);
    assert.match(migration, /'SELECT 1'/, 'a healthy schema is a safe no-op');
    assert.match(migration, /SET amount_paise = remaining_paise[\s\S]*WHERE amount_paise = 0 AND remaining_paise > 0/,
      'any remaining legacy grant balance stays usable after the repair');
  }
});

test('error-log migration stores parameterized SQL and the bound-parameter count only', () => {
  const migration = read('server/migrations/025_error_sql_diagnostics.sql');
  assert.match(migration, /TABLE_NAME = 'error_log'[\s\S]*COLUMN_NAME = 'sql_query'/);
  assert.match(migration, /ADD COLUMN sql_query TEXT NULL/);
  assert.match(migration, /COLUMN_NAME = 'sql_param_count'/);
  assert.match(migration, /ADD COLUMN sql_param_count SMALLINT UNSIGNED NULL/);
  assert.match(migration, /'SELECT 1'/, 'both additions are safe to re-run after partial DDL');
});

test('failed SQL diagnostics retain the query template but never the bound values', async () => {
  const sql = 'SELECT amount_paise FROM user_credit WHERE user_id = ? AND status = ?';
  const values = ['person@example.com', 'secret-token'];
  const driverError = Object.assign(new Error("Unknown column 'amount_paise'"), {
    code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22',
  });
  let seen;
  const target = { async query(...args) { seen = args; throw driverError; } };

  await assert.rejects(queryRows(target, sql, values), (error) => {
    assert.equal(error, driverError, 'the original exception object and stack are preserved');
    assert.equal(error.sqlTemplate, sql);
    assert.equal(error.sqlParamCount, 2);
    assert.equal(error.sqlTemplate.includes(values[0]), false);
    assert.equal(error.sqlTemplate.includes(values[1]), false);
    return true;
  });
  assert.deepEqual(seen, [sql, values], 'the wrapper does not alter the query sent to mysql');
});

test('error records persist and return safe SQL-template diagnostics', async () => {
  const insert = [];
  const at = new Date('2026-10-05T12:00:00.000Z');
  const recentRow = {
    id: 17, source: 'server', message: 'Unknown column', stack: 'driver trace',
    sql_query: 'SELECT amount_paise FROM user_credit WHERE id = ?', sql_param_count: '1',
    url: '/api/v1/admin/promos', user_agent: 'test', user_id: null, account_name: null, account_email: null, created_at: at,
  };
  const q = async (sql, params) => {
    if (sql.includes('INSERT INTO error_log')) { insert.push({ sql, params }); return { affectedRows: 1 }; }
    if (sql.includes('SELECT e.id')) return [recentRow];
    return [];
  };
  const db = extraDb({ q, tx: async (fn) => fn({ query: q }), iso: (d) => d instanceof Date ? d.toISOString() : null });
  await db.errors.add({
    source: 'server', message: 'Unknown column', stack: 'driver trace', sqlQuery: 'SELECT amount_paise FROM user_credit WHERE id = ?',
    sqlParamCount: 1, url: '/api/v1/admin/promos', userAgent: 'test', userId: null,
  });
  assert.match(insert[0].sql, /sql_query, sql_param_count/);
  assert.equal(insert[0].params[3], 'SELECT amount_paise FROM user_credit WHERE id = ?');
  assert.equal(insert[0].params[4], 1);

  const listed = await db.errors.list();
  assert.equal(listed.recent[0].sqlQuery, recentRow.sql_query);
  assert.equal(listed.recent[0].sqlParamCount, 1);
  assert.equal(listed.recent[0].at, at.toISOString());
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
  assert.match(app, /sqlQuery: err\.sqlTemplate \|\| null, sqlParamCount: err\.sqlParamCount/,
    'server failures pass safe SQL context to the error log');
  assert.match(db, /sql_query, sql_param_count/, 'the error log persists SQL templates and parameter counts');
  assert.match(db, /sqlQuery: r\.sql_query \|\| null/);
  assert.match(features, /userFromRequest\?\.\(req\)/, 'client errors resolve an optional first-party session');
  assert.match(features, /userId: user\?\.id \|\| null/, 'client-supplied IDs are not trusted');
  assert.match(db, /e\.user_agent, e\.user_id, u\.name AS account_name, u\.email AS account_email/);
  assert.match(db, /LEFT JOIN users u ON u\.id = e\.user_id/, 'deleted accounts stay visible as error records through the left join');
  assert.match(db, /userId: r\.user_id \|\| null/, 'recent error reports include their account ID');
  assert.match(db, /accountName: r\.account_name \|\| null/);
  assert.match(db, /accountEmail: r\.account_email \|\| null/);
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
