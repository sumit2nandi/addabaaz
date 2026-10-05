import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import database from '../../admin/js/views/database.js';
import { applyResponsiveTableLabels } from '../../admin/js/ui.js';

const snapshot = {
  schemaName: 'addabaaz', serverVersion: '8.0.40', sampledAt: '2026-10-05T12:00:00.000Z',
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

test('Database admin page renders schema totals, instance metrics and sortable largest-table rows', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const root = document.createElement('main');
  let requestUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await database(root, [], { stale: () => false });
    assert.equal(requestUrl, '/api/v1/admin/database/monitor');
    assert.match(root.textContent, /Database monitoring/);
    assert.match(root.textContent, /1\.5 MB/, 'database storage is rendered as a human-readable data-plus-index total');
    assert.match(root.textContent, /InnoDB buffer pool/);
    assert.match(root.textContent, /99\.8%/, 'the buffer-pool hit ratio is shown');
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
  }
});

test('Database admin page escapes table names and clearly distinguishes server-wide RAM from schema storage', async () => {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  const root = document.createElement('main');
  const originalFetch = globalThis.fetch;
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
