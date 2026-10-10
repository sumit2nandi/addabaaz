// Runtime application telemetry tests. The middleware is exercised with small Express-like request/response fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApplicationMonitor } from '../src/application-monitor.js';

function send(monitor, path, statusCode = 200) {
  const req = { method: 'GET', originalUrl: path };
  const res = new EventEmitter();
  res.statusCode = statusCode;
  let nextCalled = false;
  monitor.middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  res.emit('finish');
  res.emit('close'); // finish + close must not count the same response twice
}

test('application monitor tracks aggregate API latency/errors and ignores probes, monitor polls, and static assets', () => {
  const monitor = createApplicationMonitor();
  send(monitor, '/api/v1/catalog');
  send(monitor, '/api/v1/payments', 400);
  send(monitor, '/api/v1/failing-service', 503);
  send(monitor, '/api/v1/health');
  send(monitor, '/api/v1/health/ready');
  send(monitor, '/api/v1/status');
  send(monitor, '/api/v1/media/signed-token/segment.m3u8');
  send(monitor, '/api/v1/admin/application/monitor?range=7d');
  send(monitor, '/api/v1/admin/database/monitor?range=7d');
  send(monitor, '/admin/js/main.js');

  const current = monitor.current();
  assert.equal(current.http.requests, 3);
  assert.equal(current.http.clientErrors, 1);
  assert.equal(current.http.serverErrors, 1);
  assert.equal(current.http.clientErrorRatePct, 33.333);
  assert.equal(current.http.serverErrorRatePct, 33.333);
  assert.ok(current.http.averageResponseMs >= 0);
  assert.ok(current.http.p50ResponseMs >= 0);
  assert.ok(current.http.p95ResponseMs >= current.http.p50ResponseMs);
  assert.ok(current.http.requestsPerMinute >= 0);
  assert.ok(current.processors >= 1);
  assert.ok(current.memory.rssBytes > 0);
  assert.ok(Number.isFinite(Date.parse(current.sampledAt)));
  assert.equal(typeof current.instanceId, 'string');

  const sample = monitor.takeSnapshot();
  assert.equal(sample.http.requests, 3);
  assert.equal(monitor.current().http.requests, 0, 'persisting a minute sample starts a fresh request window');
});
