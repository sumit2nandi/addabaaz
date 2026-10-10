import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Admin Errors filters and pages reports, exposes client/server diagnostics, and copies the full record', () => {
  const view = read('admin/js/views/errors.js');
  const ui = read('admin/js/ui.js');
  const css = read('admin/admin.css');

  assert.match(view, /id="errorQuery" type="search"/, 'reports can be searched');
  assert.match(view, /id="errorSource" aria-label="Filter errors by source"/, 'browser/mobile and server records can be filtered');
  assert.match(view, /new URLSearchParams\(\{ q: state\.q, source: state\.source, limit: String\(LIMIT\), offset: String\(state\.offset\) \}\)/,
    'the view sends the search, source, and page to the existing paginated endpoint');
  assert.match(view, /pager\(\{ total: Number\(result\.total \|\| 0\), offset: Number\(result\.offset \|\| 0\), limit: Number\(result\.limit \|\| LIMIT\) \}\)/,
    'recent reports can be paged');
  assert.match(view, /Grouped by source, severity, code, status and message/,
    'the seven-day summary explains its grouping');
  assert.match(view, /group\.errorCode[\s\S]*group\.status[\s\S]*group\.count/,
    'the grouped view distinguishes codes/statuses and displays occurrence counts');

  assert.match(view, /<div><b>Account ID:<\/b> <code>\$\{error\.userId \|\| 'unknown \/ anonymous'\}<\/code><\/div>/,
    'recent errors show the verified account ID or explain that it is unknown/anonymous');
  assert.match(view, /<div><b>Account name:<\/b> \$\{error\.accountName \|\| '\(not available\)'\}<\/div>/);
  assert.match(view, /<div><b>Account email:<\/b> \$\{error\.accountEmail \|\| '\(not available\)'\}<\/div>/);
  assert.match(view, /error\.errorCode/);
  assert.match(view, /error\.status/);
  assert.match(view, /error\.requestId/);
  assert.match(view, /error\.release/);
  assert.match(view, /error\.environment/);
  assert.match(view, /error\.instanceId/);
  assert.match(view, /data-copy-error="\$\{error\.id\}"/, 'each report has a separate copy action');

  assert.match(view, /const client = error\.details\?\.client/,
    'the page unwraps the structured client context saved by the API');
  for (const field of ['where', 'version', 'runtime', 'platform', 'appState', 'online', 'visibility', 'viewport', 'screen', 'network', 'hardwareConcurrency', 'deviceMemoryGiB', 'timezone', 'colorScheme', 'userAgent']) {
    assert.match(view, new RegExp(`client\\.${field}`), `client diagnostics display ${field}`);
  }
  assert.match(view, /<details class="error-raw"><summary>Full diagnostic context/,
    'the complete sanitized structured detail object remains available on demand');
  assert.match(view, /<summary>Stack trace<\/summary>/,
    'long stack traces can be opened separately');
  assert.match(view, /pretty\(error\.details\)/,
    'copy includes the complete structured diagnostic context');
  assert.match(view, /`HTTP status: \$\{e\.source === 'client' && e\.status === 0 \? 'No HTTP response' : display\(e\.status\)\}`[\s\S]*\$\{requestIdLabel\(e\.source\)\}: \$\{display\(e\.requestId\)\}/,
    'copy contains status and request correlation details');
  assert.match(view, /const methodLabel = \(source\) => source === 'client' \? 'Report method' : 'HTTP method'/,
    'client report-ingestion method is distinguished from the failing server request method');
  assert.match(view, /const urlLabel = \(source\) => source === 'client' \? 'Page route' : 'Request URL'/,
    'the viewer can distinguish the client page route from a server request URL');
  assert.match(view, /`User agent: \$\{e\.userAgent \|\| '\(not recorded\)'\}`[\s\S]*'Diagnostic context:'/,
    'copy includes device and client-runtime diagnostics');

  assert.match(view, /Failed SQL template/,
    'database errors still display the parameterized SQL separately from the stack');
  assert.match(view, /bound parameter\(s\); values are omitted/,
    'the page clearly states that bound values are never stored');
  assert.match(view, /SQL template \(bound values omitted; \$\{e\.sqlParamCount \?\? 'unknown'\} parameter\(s\)\):/,
    'copy includes the SQL template and safe parameter count');
  assert.match(view, /SQL exception details/,
    'the screen displays structured SQL-driver exception details');
  assert.match(view, /\['SQL exception:', pretty\(e\.sqlException\)\]/,
    'the copied report includes the SQL exception metadata');
  assert.match(view, /navigator\.clipboard\?\.writeText/, 'copy uses the secure clipboard API when available');
  assert.match(view, /document\.execCommand\?\.\('copy'\)/, 'older browsers have a selection-based fallback');
  assert.match(ui, /copy: '<rect/, 'the action has a clipboard icon');
  assert.match(css, /\.error-runtime-grid \{[^}]*grid-template-columns/,
    'client diagnostics have a responsive detail grid');
  assert.match(css, /\.error-entry > summary \{[^}]*grid-template-columns/,
    'report summaries remain readable on narrow admin screens');
});

test('Admin Errors renders verified client context and safely handles missing diagnostics', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><main id="root"></main></body></html>');
  const old = {
    document: globalThis.document, window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), fetch: globalThis.fetch,
  };
  const report = {
    id: 19, source: 'client', severity: 'error', message: 'Playback failure', errorName: 'MediaError', errorCode: 'network', status: 503,
    method: 'POST', requestId: 'req-report-19', url: '/watch/episode-2', userAgent: 'Android WebView', at: '2026-01-02T03:04:05.000Z',
    details: { client: {
      where: 'api-response', version: '2.0.1', runtime: 'capacitor', platform: 'android', appState: 'active', online: false,
      visibility: 'visible', viewport: { width: 412, height: 915, pixelRatio: 3 }, screen: { width: 412, height: 915, orientation: 'portrait' },
      network: { type: 'wifi', effectiveType: '4g', downlinkMbps: 30, rttMs: 45 }, hardwareConcurrency: 8,
      deviceMemoryGiB: 8, language: 'en-IN', timezone: 'Asia/Kolkata', colorScheme: 'dark', userAgent: 'Android WebView',
    } },
    stack: 'MediaError: Playback failure', sqlQuery: null, sqlException: null, userId: null, accountName: null, accountEmail: null,
  };
  const noStatusReport = { ...report, id: 20, message: 'Legacy client report', status: null, details: null };
  const networkReport = { ...report, id: 21, message: 'Client offline', status: 0, details: { client: { where: 'admin-api-network' } } };
  const calls = [];
  globalThis.document = document;
  globalThis.window = window;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({
      groups: [{ source: 'client', severity: 'error', errorName: 'MediaError', errorCode: 'network', status: 503, message: 'Playback failure', count: 2, lastAt: report.at, url: report.url }],
      recent: [report, noStatusReport, networkReport, { id: 22, source: 'server', severity: 'error', message: 'Legacy server error', at: report.at, details: null, stack: null }], total: 4, limit: 50, offset: 0,
    }) };
  };
  try {
    const { default: errors } = await import('../../admin/js/views/errors.js');
    await errors(document.querySelector('#root'), {}, {
      query: new URLSearchParams('q=Playback+failure&source=client'), stale: () => false, refreshCounts() {},
    });
    const root = document.querySelector('#root');
    assert.match(calls[0], /\/api\/v1\/admin\/errors\?/);
    assert.match(calls[0], /q=Playback\+failure/);
    assert.match(calls[0], /source=client/);
    assert.match(root.textContent, /Client diagnostics/);
    assert.match(root.textContent, /api-response/);
    assert.match(root.textContent, /capacitor · android/);
    assert.match(root.textContent, /active/);
    assert.match(root.textContent, /412×915/);
    assert.match(root.textContent, /wifi · 4g · 30 Mbps · 45 ms RTT/);
    assert.match(root.textContent, /Page route: \/watch\/episode-2/);
    assert.match(root.textContent, /Report request ID: req-report-19/);
    assert.match(root.textContent, /unknown \/ anonymous/);
    assert.match(root.textContent, /Legacy server error/, 'legacy server rows without structured context still render');
    const entries = root.querySelectorAll('.error-entry');
    assert.match(entries[1].textContent, /HTTP status: —/);
    assert.doesNotMatch(entries[1].textContent, /No HTTP response/, 'a missing status is not mistaken for status zero');
    assert.match(entries[2].textContent, /No HTTP response/, 'status zero is described as a network/CORS/DNS failure');
  } finally {
    if (old.document === undefined) delete globalThis.document; else globalThis.document = old.document;
    if (old.window === undefined) delete globalThis.window; else globalThis.window = old.window;
    if (old.navigator) Object.defineProperty(globalThis, 'navigator', old.navigator); else delete globalThis.navigator;
    if (old.localStorage) Object.defineProperty(globalThis, 'localStorage', old.localStorage); else delete globalThis.localStorage;
    if (old.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = old.fetch;
  }
});

test('admin console browser failures and handled route/API errors are sent with safe client context', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><main id="app"></main></body></html>');
  window.location = { pathname: '/admin/', href: 'https://app.test/admin/', hash: '#/errors?token=private-query' };
  window.innerWidth = 1280; window.innerHeight = 800; window.devicePixelRatio = 2;
  const old = {
    document: globalThis.document, window: globalThis.window, location: globalThis.location,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), fetch: globalThis.fetch,
  };
  const calls = [];
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = window.location;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: Object.assign(window.navigator, { userAgent: 'Admin browser', language: 'en-IN', onLine: true }) });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify('admin-session-token'), setItem() {}, removeItem() {} } });
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    if (target === '/api/v1/admin/failure') return {
      ok: false, status: 503,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : name.toLowerCase() === 'x-request-id' ? 'failed-request-43' : null },
      json: async () => ({ error: { code: 'storage_failed', message: 'Admin storage API failed.' } }),
    };
    if (target === '/api/v1/admin/offline') throw new TypeError('Network failed while calling the admin API.');
    return { ok: true, status: 204, headers: { get: () => null } };
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  try {
    const { initAdminErrorReporting, reportAdminError } = await import('../../admin/js/error-reporter.js');
    initAdminErrorReporting();
    const caught = Object.assign(new Error('Admin route failed for reader@example.com token=private-value'), { code: 'ER_VIEW_FAILED', status: 503 });
    assert.equal(reportAdminError(caught, { where: 'console-route', route: 'errors', method: 'GET', status: 503, requestId: 'request-17', accessToken: 'must-not-be-sent' }), true);
    await tick();
    assert.equal(calls[0].url, '/api/v1/client-errors');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer admin-session-token');
    const report = JSON.parse(calls[0].options.body);
    assert.equal(report.errorCode, 'ER_VIEW_FAILED');
    assert.equal(report.url, '/errors', 'admin hash query strings are never transmitted');
    assert.equal(report.details.where, 'console-route');
    assert.equal(report.details.runtime, 'admin-console');
    assert.equal(report.details.failedRequestId, 'request-17');
    assert.doesNotMatch(calls[0].options.body, /admin-session-token|private-value|reader@example\.com|must-not-be-sent|private-query/);
    assert.equal(reportAdminError(caught, { where: 'duplicate' }), false, 'the same error object is coalesced when two hooks see it immediately');

    const event = new window.Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new TypeError('Admin renderer failed') });
    window.dispatchEvent(event);
    await tick();
    assert.ok(calls.some(({ options }) => options.body?.includes('Admin renderer failed')),
      'global browser promise failures are also submitted to the shared error log');

    const { api, putFile } = await import('../../admin/js/api.js');
    await assert.rejects(api.get('/failure'), (error) => error.status === 503 && error.code === 'storage_failed');
    await tick();
    const apiReport = calls.map(({ options }) => options.body ? JSON.parse(options.body) : null)
      .find((body) => body?.details?.where === 'admin-api-response');
    assert.ok(apiReport, 'Admin API 5xx failures report the failed route');
    assert.equal(apiReport.status, 503);
    assert.equal(apiReport.details.route, '/failure');
    assert.equal(apiReport.details.failedRequestId, 'failed-request-43');

    await assert.rejects(api.get('/offline'), (error) => error.status === 0 && error.code === 'network');
    await tick();
    const networkReport = calls.map(({ options }) => options.body ? JSON.parse(options.body) : null)
      .find((body) => body?.details?.where === 'admin-api-network');
    assert.ok(networkReport, 'network/API failures with no response are retained');
    assert.equal(networkReport.status, 0);
    assert.equal(networkReport.details.status, 0);
    assert.equal(networkReport.details.cause.message, 'Network failed while calling the admin API.');

    const oldXHR = globalThis.XMLHttpRequest;
    class FailedUploadXHR {
      constructor() { this.upload = {}; }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader() {}
      send() { this.status = 403; this.responseText = '<Code>AccessDenied</Code><Message>reader@example.com</Message>'; this.onload(); }
    }
    globalThis.XMLHttpRequest = FailedUploadXHR;
    try {
      await assert.rejects(putFile('https://r2.example/signed?token=private-upload-token', {}, null, 'video/mp4'),
        (error) => error.status === 403 && error.code === 'r2_upload');
      await tick();
    } finally {
      if (oldXHR === undefined) delete globalThis.XMLHttpRequest; else globalThis.XMLHttpRequest = oldXHR;
    }
    const uploadReport = calls.map(({ options }) => options.body ? JSON.parse(options.body) : null)
      .find((body) => body?.details?.where === 'r2-direct-upload');
    assert.ok(uploadReport, 'R2 direct-upload failures are reported too');
    assert.equal(uploadReport.status, 403);
    assert.equal(uploadReport.details.method, 'PUT');
    assert.doesNotMatch(JSON.stringify(uploadReport), /r2\.example|private-upload-token|reader@example\.com/);

    const { reportAdminError: boundedReport } = await import('../../admin/js/error-reporter.js?bounded-test');
    const beforeReports = calls.length;
    let accepted = 0;
    for (let i = 0; i < 150; i++) accepted += Number(boundedReport(new Error(`bounded admin diagnostic ${i}`)));
    assert.equal(accepted, 100, 'the admin reporter caps reports at 100 per page');
    await tick();
    assert.equal(calls.length - beforeReports, 100, 'the admin reporter drains its bounded queue when healthy');
  } finally {
    if (old.document === undefined) delete globalThis.document; else globalThis.document = old.document;
    if (old.window === undefined) delete globalThis.window; else globalThis.window = old.window;
    if (old.location === undefined) delete globalThis.location; else globalThis.location = old.location;
    if (old.navigator) Object.defineProperty(globalThis, 'navigator', old.navigator); else delete globalThis.navigator;
    if (old.localStorage) Object.defineProperty(globalThis, 'localStorage', old.localStorage); else delete globalThis.localStorage;
    if (old.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = old.fetch;
  }
});

test('repeated errors show only the top 5 by count, with a copy-all button carrying full details', async () => {
  const { readFileSync } = await import('node:fs');
  const view = readFileSync(new URL('../../admin/js/views/errors.js', import.meta.url), 'utf8');
  const db = readFileSync(new URL('../../server/src/db-extra.js', import.meta.url), 'utf8');
  assert.match(db, /ORDER BY n DESC, last_at DESC LIMIT 5/, 'the server returns the five most frequent groups');
  assert.match(db, /MAX\(id\) AS sample_id/, 'each group points at one full example');
  assert.match(view, /groups = groups\.slice\(0, 5\);/, 'the table shows at most five');
  assert.match(view, /id="copyTopErrors"[^>]*disabled>\$\{icon\('copy', 14\)\} Copy top 5/, 'a copy button for the five');
  assert.match(view, /function topErrorsText\(groups\)/, 'one text block for all five');
  assert.match(view, /group\.sample \? errorText\(group\.sample\)/, 'each block includes the full error details');
});
