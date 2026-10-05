import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import database from '../../admin/js/views/database.js';
import { applyResponsiveTableLabels } from '../../admin/js/ui.js';

const chartPoints = [
  {
    at: '2026-10-04T12:00:00.000Z', totalStorageBytes: 1_200_000, dataBytes: 900_000, indexBytes: 300_000,
    estimatedRows: 1_000, bufferPoolCapacityBytes: 16 * 1024 ** 2, bufferPoolUsedBytes: 8 * 1024 ** 2,
    bufferPoolHitRatePct: 99.8, connectionsCurrent: 2, connectionsRunning: 1, connectionsMax: 151,
    queriesPerMinute: 100, slowQueriesPerMinute: 0.5, diskTempTablesPerMinute: 0.2,
  },
  {
    at: '2026-10-05T12:00:00.000Z', totalStorageBytes: 1_572_864, dataBytes: 1_048_576, indexBytes: 524_288,
    estimatedRows: 1_005, bufferPoolCapacityBytes: 16 * 1024 ** 2, bufferPoolUsedBytes: 9 * 1024 ** 2,
    bufferPoolHitRatePct: 99.9, connectionsCurrent: 3, connectionsRunning: 2, connectionsMax: 151,
    queriesPerMinute: 125, slowQueriesPerMinute: 1, diskTempTablesPerMinute: 0.3,
  },
];
const snapshot = {
  schemaName: 'addabaaz', serverVersion: '8.0.40', sampledAt: '2026-10-05T12:00:00.000Z',
  range: '7d', rangeSeconds: 604_800, retentionDays: 7, sampleIntervalSeconds: 60, history: chartPoints,
  storage: { tableCount: 2, dataBytes: 1024 * 1024, indexBytes: 512 * 1024, totalBytes: 1536 * 1024, estimatedRows: 1005, rowEstimateTables: 2 },
  tables: [
    { name: 'large_table', engine: 'InnoDB', estimatedRows: 5, dataBytes: 900_000, indexBytes: 300_000, averageRowBytes: 90, totalBytes: 1_200_000, sharePct: 78.13 },
    { name: 'row_heavy', engine: 'InnoDB', estimatedRows: 1000, dataBytes: 148_576, indexBytes: 224_288, averageRowBytes: 148, totalBytes: 372_864, sharePct: 21.87 },
  ],
  instance: {
    statusAvailable: true,
    connections: { connected: 2, running: 1, peak: 4, max: 151, usagePct: 1.32 },
    activity: { uptimeSeconds: 86_461, queriesSinceStart: 100_000, slowQueries: 3, diskTemporaryTables: 4 },
    bufferPool: { capacityBytes: 16 * 1024 ** 2, usedBytes: 8 * 1024 ** 2, freeBytes: 8 * 1024 ** 2, dataBytes: 7 * 1024 ** 2, dirtyBytes: 512 * 1024, usagePct: 50, hitRatePct: 99.8 },
  },
};

function fakeLocalStorage(seed = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map(Object.entries(seed));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  } });
  return { restore() { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; } };
}
function fakeIntervals() {
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const scheduled = [];
  globalThis.setInterval = (callback, ms) => {
    const timer = { callback, ms, cleared: false };
    scheduled.push(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => { if (timer) timer.cleared = true; };
  return {
    scheduled,
    restore() { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('Database admin page renders labelled historical charts, live metrics and sortable largest tables', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const root = document.createElement('main');
  const timers = fakeIntervals();
  const localStorage = fakeLocalStorage();
  let requestUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await database(root, [], { stale: () => false });
    assert.equal(requestUrl, '/api/v1/admin/database/monitor?range=7d');
    assert.match(root.textContent, /Database monitoring/);
    assert.match(root.textContent, /1\.5 MB/, 'database storage is rendered as a human-readable data-plus-index total');
    assert.match(root.textContent, /InnoDB buffer pool/);
    assert.match(root.textContent, /99\.8%/, 'the buffer-pool hit ratio is shown');
    assert.match(root.textContent, /Historical metrics/);
    assert.equal(root.querySelectorAll('.db-chart-svg').length, 6, 'each metric group is rendered as a separate line chart');
    assert.ok(root.querySelectorAll('.db-chart-line').length >= 10);
    assert.ok(root.querySelectorAll('.db-chart-y-label').length > 20, 'charts show numeric Y-axis tick labels');
    assert.ok([...root.querySelectorAll('.db-chart-y-label')].some((label) => /(?:KB|MB|GB)/.test(label.textContent)), 'byte axes include human-readable units');
    assert.equal(root.querySelector('#dbRange').value, '7d');
    assert.equal(root.querySelector('#dbRange option[value="14d"]').hasAttribute('disabled'), true, 'chart ranges beyond retention are disabled');
    assert.equal(timers.scheduled[0].ms, 30_000, 'charts refresh dynamically every 30 seconds by default');
    assert.equal(root.querySelectorAll('.db-tables tbody tr').length, 2);
    assert.equal(root.querySelector('.db-tables tbody tr:first-child code').textContent, 'large_table', 'largest table is first by default');

    applyResponsiveTableLabels(root);
    assert.equal(root.querySelector('.db-tables tbody tr:first-child td:nth-child(3)').getAttribute('data-label'), 'Est. rows');
    const sort = root.querySelector('#dbSort');
    Object.defineProperty(sort, 'value', { configurable: true, value: 'rows' });
    sort.dispatchEvent(new window.Event('change'));
    assert.equal(root.querySelector('.db-tables tbody tr:first-child code').textContent, 'row_heavy', 'sort controls reorder table estimates');
  } finally {
    globalThis.fetch = originalFetch;
    timers.restore();
    localStorage.restore();
  }
});

test('Database admin page escapes table names and clearly distinguishes server-wide RAM from schema storage', async () => {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  const root = document.createElement('main');
  const originalFetch = globalThis.fetch;
  const timers = fakeIntervals();
  const hostileSnapshot = {
    ...snapshot,
    tables: [{ ...snapshot.tables[0], name: '<img src=x onerror=alert(1)>' }],
    storage: { ...snapshot.storage, tableCount: 1, rowEstimateTables: 1 },
  };
  globalThis.fetch = async () => new Response(JSON.stringify(hostileSnapshot), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    await database(root, [], { stale: () => false });
    assert.equal(root.querySelector('img'), null, 'database-provided table names are escaped');
    assert.match(root.textContent, /instance-level RAM metric/);
    assert.match(root.textContent, /not attributable to this schema/);
    assert.match(root.textContent, /Keep history/);
  } finally {
    globalThis.fetch = originalFetch;
    timers.restore();
  }
});

test('Database charts reload when the range changes and auto-refresh uses the selected cadence', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const root = document.createElement('main');
  const timers = fakeIntervals();
  const originalFetch = globalThis.fetch;
  const requests = [];
  let version = 0;
  const ranges = { '1h': 3_600, '6h': 21_600, '24h': 86_400, '3d': 259_200, '7d': 604_800, '14d': 1_209_600, '30d': 2_592_000 };
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const range = new URL(String(url), 'https://admin.test').searchParams.get('range');
    const data = { ...snapshot, schemaName: version ? 'refreshed_schema' : 'addabaaz', range, rangeSeconds: ranges[range] };
    version++;
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await database(root, [], { stale: () => false });
    const range = root.querySelector('#dbRange');
    Object.defineProperty(range, 'value', { configurable: true, value: '24h' });
    range.dispatchEvent(new window.Event('change'));
    await tick();
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[1], 'https://admin.test').searchParams.get('range'), '24h');

    const auto = root.querySelector('#dbAutoRefresh');
    Object.defineProperty(auto, 'value', { configurable: true, value: '15' });
    auto.dispatchEvent(new window.Event('change'));
    assert.ok(timers.scheduled[0].cleared, 'changing the interval cancels the previous timer');
    assert.equal(timers.scheduled.at(-1).ms, 15_000);
    assert.match(root.querySelector('#dbMeta').textContent, /Auto-refresh every 15s/);

    timers.scheduled.at(-1).callback();
    await tick();
    assert.equal(requests.length, 3, 'the timer triggers another live API request');
    assert.equal(root.querySelector('#dbMeta').textContent.includes('refreshed_schema'), true);
  } finally {
    globalThis.fetch = originalFetch;
    timers.restore();
  }
});
