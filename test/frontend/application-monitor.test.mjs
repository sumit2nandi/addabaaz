import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import application from '../../admin/js/views/application.js';

const points = [
  { at: '2026-10-04T12:00:00.000Z', cpuPercent: 8, memoryRssBytes: 60 * 1024 ** 2, heapUsedBytes: 25 * 1024 ** 2, heapTotalBytes: 40 * 1024 ** 2,
    load1: 0.5, activeInstances: 2, requestsPerMinute: 90, responseAverageMs: 85, responseP50Ms: 100, responseP95Ms: 300, responseMaxMs: 700,
    clientErrorsPerMinute: 1, serverErrorsPerMinute: 0.2, serverErrorRatePct: 0.22 },
  { at: '2026-10-05T12:00:00.000Z', cpuPercent: 12.5, memoryRssBytes: 68 * 1024 ** 2, heapUsedBytes: 32 * 1024 ** 2, heapTotalBytes: 48 * 1024 ** 2,
    load1: 0.8, activeInstances: 3, requestsPerMinute: 125, responseAverageMs: 80.5, responseP50Ms: 100, responseP95Ms: 500, responseMaxMs: 1_200,
    clientErrorsPerMinute: 0.5, serverErrorsPerMinute: 0.25, serverErrorRatePct: 0.2 },
];
const current = {
  instanceId: 'instance-test', sampledAt: '2026-10-05T12:00:00.000Z', uptimeSeconds: 86_461, processors: 4, cpuPercent: 12.5,
  memory: { rssBytes: 68 * 1024 ** 2, heapUsedBytes: 32 * 1024 ** 2, heapTotalBytes: 48 * 1024 ** 2, externalBytes: 500_000 },
  system: { load1: 0.8, load5: 0.6, load15: 0.4 },
  http: { requests: 100, intervalSeconds: 60, requestsPerMinute: 100, averageResponseMs: 80.5, p50ResponseMs: 100, p95ResponseMs: 500,
    maxResponseMs: 1_200, clientErrors: 4, serverErrors: 2, clientErrorRatePct: 4, serverErrorRatePct: 2 },
};
const response = (range = '7d', schema = {}) => ({
  current, history: points, range, rangeSeconds: { '1h': 3_600, '6h': 21_600, '24h': 86_400, '3d': 259_200, '7d': 604_800, '14d': 1_209_600, '30d': 2_592_000 }[range],
  retentionDays: 7, sampleIntervalSeconds: 60, ...schema,
});
function fakeTimers() {
  const set = globalThis.setInterval, clear = globalThis.clearInterval, scheduled = [];
  globalThis.setInterval = (callback, ms) => { const timer = { callback, ms, cleared: false }; scheduled.push(timer); return timer; };
  globalThis.clearInterval = (timer) => { if (timer) timer.cleared = true; };
  return { scheduled, restore() { globalThis.setInterval = set; globalThis.clearInterval = clear; } };
}
function fakeStorage() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  } });
  return { restore() { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; } };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('Application admin page renders process health and labelled performance charts', async () => {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  const root = document.createElement('main');
  const timers = fakeTimers(), storage = fakeStorage();
  const originalFetch = globalThis.fetch;
  let url = '';
  globalThis.fetch = async (requestUrl) => {
    url = String(requestUrl);
    return new Response(JSON.stringify(response()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await application(root, [], { stale: () => false });
    assert.equal(url, '/api/v1/admin/application/monitor?range=7d');
    assert.match(root.textContent, /Application monitoring/);
    assert.match(root.textContent, /12\.5%/);
    assert.match(root.textContent, /68 MB/);
    assert.match(root.textContent, /80\.5 ms/);
    assert.match(root.textContent, /This instance/);
    assert.equal(root.querySelectorAll('.db-chart-svg').length, 6);
    assert.ok(root.querySelectorAll('.db-chart-y-label').length > 20, 'charts have unit-readable Y axes');
    assert.ok([...root.querySelectorAll('.db-chart-y-label')].some((label) => /(?:MB|GB|ms)/i.test(label.textContent)));
    assert.equal(root.querySelector('#appmonRange option[value="14d"]').hasAttribute('disabled'), true);
    assert.equal(timers.scheduled[0].ms, 30_000, 'auto-refresh defaults to thirty seconds');
  } finally {
    globalThis.fetch = originalFetch;
    timers.restore();
    storage.restore();
  }
});

test('Application charts reload for a selected range and on the auto-refresh timer', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const root = document.createElement('main');
  const timers = fakeTimers();
  const originalFetch = globalThis.fetch;
  const requests = [];
  let calls = 0;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const range = new URL(String(url), 'https://admin.test').searchParams.get('range');
    calls++;
    return new Response(JSON.stringify(response(range, { current: { ...current, cpuPercent: 17 + calls } })), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await application(root, [], { stale: () => false });
    const range = root.querySelector('#appmonRange');
    Object.defineProperty(range, 'value', { configurable: true, value: '24h' });
    range.dispatchEvent(new window.Event('change'));
    await tick();
    assert.equal(new URL(requests[1], 'https://admin.test').searchParams.get('range'), '24h');

    timers.scheduled[0].callback();
    await tick();
    assert.equal(requests.length, 3);
    assert.match(root.textContent, /20\.0%/, 'the current runtime snapshot is dynamically refreshed');
  } finally {
    globalThis.fetch = originalFetch;
    timers.restore();
  }
});
