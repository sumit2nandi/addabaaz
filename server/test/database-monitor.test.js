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

function monitoringDb({ denyGlobal = false, sampleQuery = null, settingValues = new Map() } = {}) {
  const settings = {
    async get(key, fallback = null) { return settingValues.has(key) ? settingValues.get(key) : fallback; },
    async set(key, value) { settingValues.set(key, String(value)); },
  };
  const q = async (sql, params = []) => {
    if (/(?:database|application)_monitor_samples/i.test(sql) && sampleQuery) {
      const result = await sampleQuery(sql, params);
      if (result !== undefined) return result;
    }
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
  return adminDb({ q, tx: async (fn) => fn({ query: q }), self: { settings }, iso: (value) => value == null ? null : new Date(value).toISOString() });
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

test('database monitor stores one minute buckets, derives counter rates, and prunes to configurable retention', async () => {
  const stored = [];
  let aggregateParams = null;
  const sampleQuery = async (sql, params) => {
    if (/^SELECT sampled_at,/i.test(sql.trim())) {
      const before = params[0].getTime();
      return stored.filter((row) => row.sampled_at.getTime() < before).sort((a, b) => b.sampled_at - a.sampled_at).slice(0, 1);
    }
    if (/^INSERT IGNORE INTO database_monitor_samples/i.test(sql.trim())) {
      const [sampled_at, total_storage_bytes, data_bytes, index_bytes, estimated_rows, table_count,
        buffer_pool_capacity_bytes, buffer_pool_used_bytes, buffer_pool_hit_rate_pct,
        connections_current, connections_running, connections_max,
        queries_since_restart, slow_queries_since_restart, disk_tmp_tables_since_restart,
        queries_delta, slow_queries_delta, disk_tmp_tables_delta, sample_interval_seconds] = params;
      if (stored.some((row) => row.sampled_at.getTime() === sampled_at.getTime())) return { affectedRows: 0 };
      stored.push({ sampled_at, total_storage_bytes, data_bytes, index_bytes, estimated_rows, table_count,
        buffer_pool_capacity_bytes, buffer_pool_used_bytes, buffer_pool_hit_rate_pct,
        connections_current, connections_running, connections_max,
        queries_since_restart, slow_queries_since_restart, disk_tmp_tables_since_restart,
        queries_delta, slow_queries_delta, disk_tmp_tables_delta, sample_interval_seconds });
      return { affectedRows: 1 };
    }
    if (/^SELECT FLOOR\(UNIX_TIMESTAMP/i.test(sql.trim())) {
      aggregateParams = params;
      return [{ bucket_epoch: '1791201600', total_storage_bytes: '1585152.5', data_bytes: '1052672', index_bytes: '532480',
        estimated_rows: '105', buffer_pool_capacity_bytes: '16777216', buffer_pool_used_bytes: '12582912',
        buffer_pool_hit_rate_pct: '98.5', connections_current: '7', connections_running: '2', connections_max: '100',
        queries_per_minute: '12.5', slow_queries_per_minute: '0.25', disk_tmp_tables_per_minute: '0' }];
    }
    if (/^DELETE FROM database_monitor_samples/i.test(sql.trim())) return { affectedRows: 0 };
    return undefined;
  };
  const settings = new Map();
  const db = monitoringDb({ sampleQuery, settingValues: settings });
  const first = {
    ...await db.monitoring.snapshot(), sampledAt: '2026-10-05T12:00:14.000Z',
    storage: { totalBytes: 1_000, dataBytes: 700, indexBytes: 300, estimatedRows: 10, rowEstimateTables: 2, tableCount: 3 },
    instance: { connections: { connected: 2, running: 1, max: 20 }, activity: { queriesSinceStart: 100, slowQueries: 2, diskTemporaryTables: 4 },
      bufferPool: { capacityBytes: 1_000, usedBytes: 800, hitRatePct: 99 } },
  };
  const second = {
    ...first, sampledAt: '2026-10-05T12:01:08.000Z',
    storage: { ...first.storage, totalBytes: 1_200, dataBytes: 800 },
    instance: { ...first.instance, activity: { queriesSinceStart: 160, slowQueries: 3, diskTemporaryTables: 8 } },
  };
  assert.equal(await db.monitoring.record(first), true);
  assert.equal(await db.monitoring.record(second), true);
  assert.equal(stored.length, 2);
  assert.equal(stored[1].sample_interval_seconds, 60);
  assert.equal(stored[1].queries_delta, 60);
  assert.equal(stored[1].slow_queries_delta, 1);
  assert.equal(stored[1].disk_tmp_tables_delta, 4);
  assert.equal(await db.monitoring.record({ ...second, sampledAt: '2026-10-05T12:01:50.000Z' }), false, 'duplicate samples in one minute are ignored');

  const since = new Date('2026-10-05T11:00:00.000Z');
  const series = await db.monitoring.history({ since, bucketSeconds: 900 });
  assert.deepEqual(aggregateParams, [900, 900, since, 900]);
  assert.equal(series.length, 1);
  assert.equal(series[0].totalStorageBytes, 1_585_152.5);
  assert.equal(series[0].queriesPerMinute, 12.5);
  assert.equal(series[0].slowQueriesPerMinute, 0.25);
  assert.equal(series[0].diskTempTablesPerMinute, 0);
  assert.equal(series[0].bufferPoolHitRatePct, 98.5);

  assert.equal(await db.monitoring.retentionDays(), 7);
  assert.equal(await db.monitoring.setRetentionDays(14), 14);
  assert.equal(settings.get('database_monitor_retention_days'), '14');
  await assert.rejects(db.monitoring.setRetentionDays(8), /retention/i);
});

test('application monitoring stores per-process samples and aggregates memory, traffic, latency and errors', async () => {
  const saved = [];
  let historyParams = null, pruneDays = null;
  const sampleQuery = async (sql, params) => {
    if (/^INSERT IGNORE INTO application_monitor_samples/i.test(sql.trim())) {
      if (saved.some((row) => row.instance_id === params[0] && row.sampled_at.getTime() === params[1].getTime())) return { affectedRows: 0 };
      saved.push({ instance_id: params[0], sampled_at: params[1], values: params.slice(2) });
      return { affectedRows: 1 };
    }
    if (/^SELECT bucket_epoch,/i.test(sql.trim())) {
      historyParams = params;
      return [{ bucket_epoch: '1791201600', cpu_percent: '25.5', memory_rss_bytes: '67108864', heap_used_bytes: '32000000',
        heap_total_bytes: '48000000', load_1: '0.8', active_instances: '2', requests_per_minute: '12.5',
        response_average_ms: '80.5', response_p50_ms: '100', response_p95_ms: '500', response_max_ms: '1200',
        client_errors_per_minute: '0.5', server_errors_per_minute: '0.25', server_error_rate_pct: '2' }];
    }
    if (/^DELETE FROM application_monitor_samples/i.test(sql.trim())) { pruneDays = params[0]; return { affectedRows: 0 }; }
    return undefined;
  };
  const settings = new Map();
  const db = monitoringDb({ sampleQuery, settingValues: settings });
  const sample = {
    instanceId: '88888888-8888-4888-8888-888888888888', sampledAt: '2026-10-05T12:01:20.000Z', intervalSeconds: 60,
    processors: 4, cpuPercent: 12.5,
    memory: { rssBytes: 33_554_432, heapUsedBytes: 16_000_000, heapTotalBytes: 24_000_000, externalBytes: 512_000, arrayBuffersBytes: 128_000 },
    system: { load1: 0.4, load5: 0.3, load15: 0.2 },
    http: { requests: 10, clientErrors: 1, serverErrors: 0, latencySumMs: 800, p50ResponseMs: 100, p95ResponseMs: 300, maxResponseMs: 400 },
  };
  assert.equal(await db.applicationMonitoring.record(sample), true);
  assert.equal(await db.applicationMonitoring.record(sample), false, 'one app instance cannot duplicate a minute bucket');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sampled_at.toISOString(), '2026-10-05T12:01:00.000Z');
  assert.equal(saved[0].values[0], 12.5, 'CPU is stored as a per-process percentage');

  const since = new Date('2026-10-05T11:00:00.000Z');
  const history = await db.applicationMonitoring.history({ since, bucketSeconds: 900 });
  assert.deepEqual(historyParams, [900, 900, 900, 900, 900, since]);
  assert.equal(history[0].memoryRssBytes, 67_108_864, 'memory is aggregated across instances');
  assert.equal(history[0].requestsPerMinute, 12.5);
  assert.equal(history[0].responseP95Ms, 500);
  assert.equal(history[0].serverErrorRatePct, 2);
  assert.equal(history[0].activeInstances, 2);
  assert.equal(await db.applicationMonitoring.retentionDays(), 7);
  assert.equal(await db.applicationMonitoring.setRetentionDays(14), 14);
  assert.equal(settings.get('application_monitor_retention_days'), '14');
  assert.equal(pruneDays, 14);
  await assert.rejects(db.applicationMonitoring.setRetentionDays(8), /retention/i);
});

test('scheduled application samples are persisted independently of housekeeping failures', async () => {
  let saved = null, catalogRead = false;
  const { runScheduledJobs } = await import('../src/jobs.js');
  await runScheduledJobs({
    db: { applicationMonitoring: { record: async (sample) => { saved = sample; } } },
    applicationMonitor: { takeSnapshot: () => ({ sampledAt: '2026-10-05T12:00:00.000Z', instanceId: 'app-1' }) },
    catalog: { async get() { catalogRead = true; throw new Error('catalog temporarily unavailable'); } },
    push: null, log: { error() {} },
  });
  assert.equal(saved.instanceId, 'app-1');
  assert.equal(catalogRead, true);
});

test('scheduled database sampling runs independently of other housekeeping jobs', async () => {
  const messages = [];
  let sampled = 0, catalogRead = false;
  const { runScheduledJobs } = await import('../src/jobs.js');
  await runScheduledJobs({
    db: { monitoring: { collect: async () => { sampled++; throw new Error('metrics temporarily unavailable'); } } },
    catalog: { async get() { catalogRead = true; throw new Error('catalog temporarily unavailable'); } },
    push: null, log: { error(message) { messages.push(message); } },
  });
  assert.equal(sampled, 1);
  assert.equal(catalogRead, true, 'a sample failure does not prevent the other scheduled jobs from running');
  assert.ok(messages.some((message) => message.includes('database monitor')));
});

test('database monitoring endpoint is admin-only and is not cached', async (t) => {
  const token = 'monitor-test-token-with-enough-entropy';
  const snapshot = { schemaName: 'private_schema', sampledAt: '2026-10-05T12:00:00.000Z', storage: { totalBytes: 42 }, tables: [], instance: {} };
  const history = [{ at: '2026-10-05T12:00:00.000Z', totalStorageBytes: 42 }];
  const audit = [];
  let requestedHistory = null, requestedApplicationHistory = null;
  let savedRetention = 7, savedApplicationRetention = 7;
  const applicationCurrent = { sampledAt: '2026-10-05T12:00:00.000Z', instanceId: 'app-instance', cpuPercent: 12.5, http: { requests: 3 } };
  const applicationHistory = [{ at: '2026-10-05T12:00:00.000Z', cpuPercent: 12.5, requestsPerMinute: 3 }];
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', createAdminRouter({
    db: { monitoring: {
      snapshot: async () => snapshot,
      retentionDays: async () => savedRetention,
      history: async (query) => { requestedHistory = query; return history; },
      setRetentionDays: async (days) => { savedRetention = days; },
    }, applicationMonitoring: {
      retentionDays: async () => savedApplicationRetention,
      history: async (query) => { requestedApplicationHistory = query; return applicationHistory; },
      setRetentionDays: async (days) => { savedApplicationRetention = days; },
    }, audit: { add: async (entry) => audit.push(entry) } },
    applicationMonitor: { current: () => applicationCurrent },
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
  assert.deepEqual(await authorized.json(), {
    ...snapshot, history, range: '7d', rangeSeconds: 604_800, retentionDays: 7, sampleIntervalSeconds: 60,
  });
  assert.equal(requestedHistory.bucketSeconds, 1_020, 'week-long history is downsampled to about 600 points');
  assert.ok(requestedHistory.since instanceof Date);
  assert.equal(authorized.headers.get('cache-control'), 'private, no-store');

  const clamped = await fetch(`${url}?range=30d`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await clamped.json()).range, '7d', 'a requested window cannot exceed configured retention');
  const update = await fetch(`${url}/settings`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ retentionDays: 14 }),
  });
  assert.equal(update.status, 200);
  assert.deepEqual(await update.json(), { retentionDays: 14 });
  assert.equal(savedRetention, 14);
  assert.equal(audit.at(-1).action, 'database_monitor.retention_updated');
  assert.deepEqual(audit.at(-1).meta, { retentionDays: 14 });

  const invalid = await fetch(`${url}/settings`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ retentionDays: 8 }),
  });
  assert.equal(invalid.status, 400);

  const applicationUrl = url.replace('/database/monitor', '/application/monitor');
  assert.equal((await fetch(applicationUrl)).status, 401, 'application metrics remain admin-only');
  const appResponse = await fetch(applicationUrl, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(appResponse.status, 200);
  assert.equal(appResponse.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await appResponse.json(), {
    current: applicationCurrent, history: applicationHistory, range: '7d', rangeSeconds: 604_800,
    retentionDays: 7, sampleIntervalSeconds: 60,
  });
  assert.equal(requestedApplicationHistory.bucketSeconds, 1_020);
  const appRetentionUpdate = await fetch(`${applicationUrl}/settings`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ retentionDays: 14 }),
  });
  assert.equal(appRetentionUpdate.status, 200);
  assert.equal(savedApplicationRetention, 14);
  assert.equal(audit.at(-1).action, 'application_monitor.retention_updated');
  const appClamped = await fetch(`${applicationUrl}?range=30d`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await appClamped.json()).range, '14d');
  const appInvalidRetention = await fetch(`${applicationUrl}/settings`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ retentionDays: 8 }),
  });
  assert.equal(appInvalidRetention.status, 400);
});
