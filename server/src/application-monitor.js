// Low-overhead, process-local HTTP and runtime telemetry for Admin → System → Application.
// Routes and request paths are intentionally not retained: the monitor stores aggregate counts and timings only.
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const LATENCY_BOUNDS_MS = [1, 2, 5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500, 750, 1_000, 1_500, 2_500, 5_000, 10_000, 30_000, 60_000];
const emptyRequests = () => ({
  count: 0, latencySumMs: 0, maxResponseMs: 0, clientErrors: 0, serverErrors: 0,
  latencyBuckets: Array(LATENCY_BOUNDS_MS.length + 1).fill(0),
});
const finite = (value) => Number.isFinite(value) ? value : null;

function percentile(stats, pct) {
  if (!stats.count) return null;
  const target = Math.ceil(stats.count * pct);
  let seen = 0;
  for (let index = 0; index < stats.latencyBuckets.length; index++) {
    seen += stats.latencyBuckets[index];
    if (seen >= target) return LATENCY_BOUNDS_MS[Math.min(index, LATENCY_BOUNDS_MS.length - 1)];
  }
  return LATENCY_BOUNDS_MS.at(-1);
}

function requestWindow(stats, elapsedSeconds) {
  const requests = stats.count;
  const pct = (count) => requests ? Math.round(count / requests * 100_000) / 1_000 : null;
  return {
    requests,
    intervalSeconds: Math.round(elapsedSeconds * 100) / 100,
    requestsPerMinute: elapsedSeconds > 0 ? Math.round(requests * 60 / elapsedSeconds * 100) / 100 : 0,
    averageResponseMs: requests ? Math.round(stats.latencySumMs / requests * 100) / 100 : null,
    latencySumMs: Math.round(stats.latencySumMs * 1_000) / 1_000,
    p50ResponseMs: percentile(stats, 0.5),
    p95ResponseMs: percentile(stats, 0.95),
    maxResponseMs: requests ? Math.round(stats.maxResponseMs * 100) / 100 : null,
    clientErrors: stats.clientErrors,
    serverErrors: stats.serverErrors,
    clientErrorRatePct: pct(stats.clientErrors),
    serverErrorRatePct: pct(stats.serverErrors),
  };
}

/** Create an Express-compatible API telemetry middleware and minute-window process sampler. */
export function createApplicationMonitor({ requestPrefix = '/api/v1' } = {}) {
  const instanceId = randomUUID();
  const processors = Math.max(1, Number(os.availableParallelism?.()) || os.cpus().length || 1);
  let lastCpu = process.cpuUsage();
  let lastCpuAt = performance.now();
  let lastSampleAt = lastCpuAt;
  let requests = emptyRequests();

  const shouldMeasure = (req) => {
    if (req.method === 'OPTIONS') return false;
    const pathname = String(req.originalUrl || req.url || '').split('?')[0];
    if (!pathname.startsWith(`${requestPrefix}/`)) return false;
    // Exclude health probes and monitoring reads so polling cannot inflate the application dashboard.
    return pathname !== `${requestPrefix}/health`
      && pathname !== `${requestPrefix}/health/ready`
      && pathname !== `${requestPrefix}/status`
      && !pathname.startsWith(`${requestPrefix}/media/`)
      && !pathname.startsWith(`${requestPrefix}/admin/application/monitor`)
      && !pathname.startsWith(`${requestPrefix}/admin/database/monitor`);
  };

  const middleware = (req, res, next) => {
    if (!shouldMeasure(req)) return next();
    const startedAt = performance.now();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const duration = Math.max(0, performance.now() - startedAt);
      const status = Number(res.statusCode) || 0;
      requests.count++;
      requests.latencySumMs += duration;
      requests.maxResponseMs = Math.max(requests.maxResponseMs, duration);
      if (status >= 400 && status < 500) requests.clientErrors++;
      if (status >= 500) requests.serverErrors++;
      const bucket = LATENCY_BOUNDS_MS.findIndex((bound) => duration <= bound);
      requests.latencyBuckets[bucket < 0 ? LATENCY_BOUNDS_MS.length : bucket]++;
    };
    res.once('finish', finish);
    res.once('close', finish);
    next();
  };

  const read = (reset) => {
    const now = performance.now();
    const cpuNow = process.cpuUsage();
    const elapsedMs = Math.max(1, now - lastCpuAt);
    const cpuDeltaUs = Math.max(0, cpuNow.user - lastCpu.user) + Math.max(0, cpuNow.system - lastCpu.system);
    const currentCpuPercent = finite(Math.round((cpuDeltaUs / (elapsedMs * 1_000) * 100) * 1_000) / 1_000);
    const elapsedSeconds = Math.max(0.001, (now - lastSampleAt) / 1_000);
    const memoryUsage = process.memoryUsage();
    const load = os.loadavg().map((value) => finite(value));
    const snapshot = {
      instanceId,
      sampledAt: new Date().toISOString(),
      intervalSeconds: Math.round(elapsedSeconds * 100) / 100,
      uptimeSeconds: Math.round(process.uptime()),
      processors,
      cpuPercent: currentCpuPercent,
      memory: {
        rssBytes: memoryUsage.rss,
        heapUsedBytes: memoryUsage.heapUsed,
        heapTotalBytes: memoryUsage.heapTotal,
        externalBytes: memoryUsage.external,
        arrayBuffersBytes: memoryUsage.arrayBuffers,
      },
      system: { load1: load[0] ?? null, load5: load[1] ?? null, load15: load[2] ?? null },
      http: requestWindow(requests, elapsedSeconds),
    };
    if (reset) {
      lastCpu = cpuNow;
      lastCpuAt = now;
      lastSampleAt = now;
      requests = emptyRequests();
    }
    return snapshot;
  };

  return {
    instanceId,
    middleware,
    /** Current gauges and request counters since the last scheduled sample; this read does not reset them. */
    current() { return read(false); },
    /** Capture and reset interval counters for durable history storage. */
    takeSnapshot() { return read(true); },
  };
}
