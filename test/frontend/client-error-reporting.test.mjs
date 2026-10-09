import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
window.ADDABAAZ_ENV = { API_BASE: 'https://api.test' };
window.location = { origin: 'https://app.test', href: 'https://app.test/watch/show-7?email=reader@example.com#token=hash-secret', pathname: '/watch/show-7', search: '?email=reader@example.com', hash: '#/watch/show-7?token=hash-secret' };
window.innerWidth = 412;
window.innerHeight = 915;
window.devicePixelRatio = 3;
window.screen = { width: 412, height: 915, orientation: { type: 'portrait-primary' } };
window.matchMedia = () => ({ matches: true });
Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'android',
  Plugins: { App: { addListener(name, callback) { if (name === 'appStateChange') lifecycle = callback; return Promise.resolve({ remove() {} }); } } },
};

globalThis.window = window;
globalThis.document = document;
globalThis.location = window.location;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: Object.assign(window.navigator, {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile',
  language: 'en-IN', onLine: true, hardwareConcurrency: 8, deviceMemory: 8,
  connection: { type: 'wifi', effectiveType: '4g', downlink: 30, rtt: 45, saveData: false },
}) });
const storage = new Map([['ab.token', 'session-token-never-in-report']]);
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
} });

let lifecycle;
const requests = [];
let failFirst = true;
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  if (failFirst) { failFirst = false; throw new TypeError('network unavailable'); }
  if (String(url).endsWith('/api/v1/broken')) {
    return { ok: false, status: 503, json: async () => ({ error: { code: 'upstream_unavailable', message: 'The service is unavailable.' } }) };
  }
  if (String(url).endsWith('/api/v1/invalid')) {
    return { ok: false, status: 400, json: async () => ({ error: { code: 'invalid_input', message: 'The request is invalid.' } }) };
  }
  if (String(url).endsWith('/api/v1/offline')) throw Object.assign(new TypeError('Fetch failed while requesting the API.'), { code: 'ECONNRESET' });
  if (String(url).endsWith('/api/v1/health')) return { ok: true, status: 200, json: async () => ({ service: 'unrelated-service' }) };
  return { ok: true, status: 204, json: async () => ({}) };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const { app } = await import('../../app/js/app.js');
const { initErrorReporting, reportClientError } = await import('../../app/js/errors.js');
const { ApiClient, detectApi } = await import('../../app/js/data/api.js');


test('browser/mobile error reports work before sign-in, retry after connectivity returns, and redact private context', async () => {
  initErrorReporting();
  lifecycle?.({ isActive: true });
  assert.equal(typeof lifecycle, 'function', 'Capacitor app lifecycle is monitored when the native App plugin is present');

  const opaqueToken = 'A'.repeat(128);
  const error = Object.assign(new TypeError('Fetch failed token=private-value email=reader@example.com phone=919812345678 otp=654321'), { code: 'NETWORK_FAILURE' });
  assert.equal(reportClientError(error, { where: 'boot', userId: 'forged-account', authorization: 'do-not-store-this', sdkMessage: `provider returned ${opaqueToken}` }), true,
    'anonymous users and boot-time failures are eligible for reporting');
  await tick();
  assert.equal(requests.length, 1, 'the first failed attempt stays queued in memory');
  assert.equal(reportClientError(error, { where: 'boot' }), false, 'the same message is de-duplicated');

  window.dispatchEvent(new window.Event('online'));
  await tick();
  assert.equal(requests.length, 2, 'a queued report is retried once the client is online');
  const call = requests[1];
  assert.equal(call.url, 'https://api.test/api/v1/client-errors');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.keepalive, true);
  assert.equal(call.options.headers.Authorization, 'Bearer session-token-never-in-report', 'the token is sent only as an auth header for server-side verification');
  const report = JSON.parse(call.options.body);
  assert.equal(report.errorName, 'TypeError');
  assert.equal(report.errorCode, 'NETWORK_FAILURE');
  assert.equal(report.url, '/watch/show-7', 'neither query parameters nor the SPA hash is transmitted');
  assert.equal(report.details.runtime, 'capacitor');
  assert.equal(report.details.platform, 'android');
  assert.equal(report.details.appState, 'active');
  assert.equal(report.details.version, '2.0.1');
  assert.equal(report.details.viewport.width, 412);
  assert.equal(report.details.screen.orientation, 'portrait-primary');
  assert.equal(report.details.network.effectiveType, '4g');
  assert.equal(report.details.authorization, '[redacted]');
  assert.equal(report.details.userId, '[redacted]');
  assert.doesNotMatch(call.options.body, /session-token-never-in-report|private-value|reader@example\.com|919812345678|654321|hash-secret|forged-account|do-not-store-this/);
  assert.doesNotMatch(call.options.body, new RegExp(opaqueToken), 'long opaque native credentials are removed even without a sensitive key name');
});

test('global unhandled rejections and API 5xx responses become client reports with status/context', async () => {
  const rejection = new window.Event('unhandledrejection');
  Object.defineProperty(rejection, 'reason', { value: new Error('Unhandled native WebView callback failure') });
  window.dispatchEvent(rejection);
  await tick();
  assert.ok(requests.some(({ options }) => options.body?.includes('Unhandled native WebView callback failure')));

  app.api = new ApiClient('https://api.test');
  await assert.rejects(app.api.get('/broken'), (error) => error.status === 503 && error.code === 'upstream_unavailable');
  await tick();
  const failure = requests.map(({ options }) => options.body ? JSON.parse(options.body) : null).find((body) => body?.errorCode === 'upstream_unavailable');
  assert.ok(failure, 'the API client retains a diagnostic copy of server 5xx responses');
  assert.equal(failure.status, 503);
  assert.equal(failure.details.where, 'api-response');

  const reportsBeforeExpectedFailures = requests.filter(({ options }) => options.body?.includes('"message"')).length;
  await assert.rejects(app.api.get('/invalid'), (error) => error.status === 400 && error.code === 'invalid_input');
  await tick();
  assert.equal(requests.filter(({ options }) => options.body?.includes('"message"')).length, reportsBeforeExpectedFailures,
    'expected API 4xx responses are not reported as application failures');

  await assert.rejects(app.api.get('/offline'), (error) => error.status === 0 && error.code === 'network');
  await tick();
  const network = requests.map(({ options }) => options.body ? JSON.parse(options.body) : null).find((body) => body?.errorCode === 'network');
  assert.ok(network, 'caught API connectivity failures are captured as client diagnostics');
  assert.equal(network.details.where, 'api-response');
  assert.equal(network.details.status, 0);
  assert.equal(network.details.causes[0].errorCode, 'ECONNRESET');

  assert.equal(await detectApi('https://api.test'), false, 'an incompatible health response keeps the app in local-only mode');
  await tick();
  const health = requests.map(({ options }) => options.body ? JSON.parse(options.body) : null).find((body) => body?.errorCode === 'incompatible_api');
  assert.ok(health, 'the silent API-detection fallback is also recorded for diagnostics');
  assert.equal(health.status, 200);
  assert.equal(health.details.where, 'api-health-check');
});

test('global browser hooks install synchronously and the client report endpoint honors local-only mode', async () => {
  const main = fs.readFileSync(new URL('../../app/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /initPlatform\(\);\s*initErrorReporting\(\);\s*\/\//,
    'error hooks are active before asynchronous application boot');
  const api = app.api;
  app.api = null;
  app.config.apiBase = 'off';
  const before = requests.length;
  assert.equal(reportClientError(new Error('local-only diagnostic')), false);
  assert.equal(await detectApi('off'), false);
  assert.equal(requests.length, before, 'forced local-only mode never calls an API');
  app.api = api;

  const { reportClientError: boundedReport } = await import('../../app/js/errors.js?bounded-test');
  let accepted = 0;
  const beforeReports = requests.filter(({ url }) => url === 'https://api.test/api/v1/client-errors').length;
  for (let i = 0; i < 150; i++) accepted += Number(boundedReport(new Error(`bounded diagnostic ${i}`)));
  assert.equal(accepted, 100, 'a page can enqueue at most 100 reports, even if a runtime error loop continues');
  await tick();
  assert.equal(requests.filter(({ url }) => url === 'https://api.test/api/v1/client-errors').length - beforeReports, 100,
    'the bounded queue eventually drains when the endpoint is healthy');
});
