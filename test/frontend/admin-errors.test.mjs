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
  assert.match(view, /`HTTP status: \$\{display\(e\.status\)\}`[\s\S]*\$\{requestIdLabel\(e\.source\)\}: \$\{display\(e\.requestId\)\}/,
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
  const calls = [];
  globalThis.document = document;
  globalThis.window = window;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({
      groups: [{ source: 'client', severity: 'error', errorName: 'MediaError', errorCode: 'network', status: 503, message: 'Playback failure', count: 2, lastAt: report.at, url: report.url }],
      recent: [report, { id: 20, source: 'server', severity: 'error', message: 'Legacy server error', at: report.at, details: null, stack: null }], total: 2, limit: 50, offset: 0,
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
  } finally {
    if (old.document === undefined) delete globalThis.document; else globalThis.document = old.document;
    if (old.window === undefined) delete globalThis.window; else globalThis.window = old.window;
    if (old.navigator) Object.defineProperty(globalThis, 'navigator', old.navigator); else delete globalThis.navigator;
    if (old.localStorage) Object.defineProperty(globalThis, 'localStorage', old.localStorage); else delete globalThis.localStorage;
    if (old.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = old.fetch;
  }
});
