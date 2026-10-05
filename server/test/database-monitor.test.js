// Database-monitoring persistence and admin endpoint tests; no MySQL server required.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { adminDb } from '../src/db-admin.js';
import { createAdminRouter } from '../src/admin.js';

const STATUS = [
  ['Uptime', '86461'], ['Threads_connected', '7'], ['Threads_running', '2'], ['Max_used_connections', '18'],
  ['Connections', '900'], ['Queries', '4000'], ['Slow_queries', '12'], ['Created_tmp_tables', '80'], ['Created_tmp_disk_tables', '4'],
  ['Innodb_buffer_pool_pages_data', '768'], ['Innodb_buffer_pool_pages_free', '256'], ['Innodb_buffer_pool_pages_total', '1024'],
  ['Innodb_buffer_pool_pages_dirty', '32'], ['Innodb_buffer_pool_read_requests', '1000'], ['Innodb_buffer_pool_reads', '15'],
].map(([Variable_name, Value]) => ({ Variable_name, Value }));
const VARIABLES = [
  ['max_connections', '100'], ['innodb_buffer_pool_size', '16777216'], ['innodb_page_size', '16384'],
].map(([Variable_name, Value]) => ({ Variable_name, Value }));
const TABLES = [
  { TABLE_NAME: 'users', ENGINE: 'InnoDB', TABLE_ROWS: '100', AVG_ROW_LENGTH: '100', DATA_LENGTH: '1048576', INDEX_LENGTH: '524288', AUTO_INCREMENT: '101' },
  { TABLE_NAME: 'audit_log', ENGINE: 'InnoDB', TABLE_ROWS: '5', AVG_ROW_LENGTH: '819', DATA_LENGTH: '4096', INDEX_LENGTH: '8192', AUTO_INCREMENT: null },
  { TABLE_NAME: 'new_empty', ENGINE: 'InnoDB', TABLE_ROWS: null, AVG_ROW_LENGTH: null, DATA_LENGTH: null, INDEX_LENGTH: null, AUTO_INCREMENT: null },
];

function monitoringDb({ denyGlobal = false } = {}) {
  const q = async (sql) => {
    if (/SELECT DATABASE\(\)/i.test(sql)) return [{ schema_name: 'addabaaz_test', server_version: '8.0.test' }];
    if (/information_schema\.TABLES/i.test(sql)) return TABLES;
    if (/SHOW GLOBAL STATUS/i.test(sql)) {
      if (denyGlobal) throw new Error('global status is restricted');
      return STATUS;
    }
    if (/SHOW GLOBAL VARIABLES/i.test(sql)) {
      if (denyGlobal) throw new Error('global variables are restricted');
      return VARIABLES;
    }
    throw new Error(`Unexpected test query: ${sql}`);
  };
  return adminDb({ q, tx: async (fn) => fn({ query: q }), self: {}, iso: (value) => value == null ? null : new Date(value).toISOString() });
}

test('database snapshot totals table storage, orders the largest tables and derives instance metrics', async () => {
  const db = monitoringDb();
  const result = await db.monitoring.snapshot();

  assert.equal(result.schemaName, 'addabaaz_test');
  assert.equal(result.serverVersion, '8.0.test');
  assert.ok(Number.isFinite(Date.parse(result.sampledAt)));
  assert.deepEqual(result.storage, {
    tableCount: 3,
    dataBytes: 1_052_672,
    indexBytes: 532_480,
    totalBytes: 1_585_152,
    estimatedRows: 105,
    rowEstimateTables: 2,
  });
  assert.deepEqual(result.tables.map((table) => table.name), ['users', 'audit_log', 'new_empty']);
  assert.equal(result.tables[0].estimatedRows, 100);
  assert.equal(result.tables[0].totalBytes, 1_572_864);
  assert.equal(result.tables[0].sharePct, 99.22);
  assert.equal(result.tables[0].autoIncrement, 101);
  assert.equal(result.tables[2].estimatedRows, null, 'unknown table estimates remain unknown, not zero');
  assert.equal(result.instance.statusAvailable, true);
  assert.equal(result.instance.connections.usagePct, 7);
  assert.equal(result.instance.connections.peak, 18);
  assert.equal(result.instance.activity.uptimeSeconds, 86_461);
  assert.equal(result.instance.activity.diskTemporaryTables, 4);
  assert.deepEqual(result.instance.bufferPool, {
    capacityBytes: 16_777_216,
    usedBytes: 12_582_912,
    freeBytes: 4_194_304,
    dataBytes: 12_582_912,
    dirtyBytes: 524_288,
    usagePct: 75,
    hitRatePct: 98.5,
    pageSizeBytes: 16_384,
  });
});

test('restricted global status does not prevent per-schema storage monitoring', async () => {
  const result = await monitoringDb({ denyGlobal: true }).monitoring.snapshot();
  assert.equal(result.storage.totalBytes, 1_585_152);
  assert.equal(result.instance.statusAvailable, false);
  assert.equal(result.instance.bufferPool, null);
  assert.equal(result.instance.connections.connected, null);
});

test('database monitoring endpoint is admin-only and is not cached', async (t) => {
  const token = 'monitor-test-token-with-enough-entropy';
  const snapshot = { schemaName: 'private_schema', storage: { totalBytes: 42 }, tables: [], instance: {} };
  const app = express();
  app.use('/api/v1/admin', createAdminRouter({
    db: { monitoring: { snapshot: async () => snapshot }, audit: { add: async () => {} } },
    billing: { config: { siteUrl: '' } }, catalog: {}, r2: { configured: false }, payments: { provider: 'none' }, mailer: {},
    push: null, campaigns: null, social: {}, adminToken: token, secret: 'monitor-test-secret', uploadDir: '/tmp',
    mediaDir: '/tmp', rate: false, sms: null,
  }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code || 'error', message: error.message } }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/v1/admin/database/monitor`;

  const anonymous = await fetch(url);
  assert.equal(anonymous.status, 401);
  const authorized = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), snapshot);
  assert.equal(authorized.headers.get('cache-control'), 'private, no-store');
});
