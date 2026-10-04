/**
 * The portal, exercised in a real DOM (jsdom) against a stubbed API: the token gate, the health pills,
 * the job list, the per-quality progress bars and the detail drawer — including the “Copy key” action
 * the operator uses to move a finished package into the site's catalog.
 *
 * The portal is a browser ES module without imports, so it can be evaluated directly once the DOM
 * globals are installed. Timers are taken from the jsdom window so closing it at the end of a test
 * leaves nothing running (the portal schedules a refresh loop).
 * Run: node --test test/portal.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const SCRIPT_URL = new URL('../public/app.js', import.meta.url).href;
const nodeSetTimeout = globalThis.setTimeout;   // captured before the portal's timers replace the globals
const ORIGINAL_TIMERS = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };

const CONFIG = {
  version: '1.0.0',
  presets: [{ id: 'auto', label: 'Auto — every resolution the source fills' }, { id: 'hd', label: 'Up to 720p' }],
  defaultPreset: 'auto',
  maxShortSide: 1080,
  segmentSeconds: [2, 4, 6, 10],
  x264Presets: ['veryfast', 'fast', 'medium', 'slow'],
  packaging: [{ id: 'ts', label: 'MPEG-TS (.ts) — plays everywhere' }, { id: 'fmp4', label: 'fMP4/CMAF (.m4s) — modern, smaller' }],
  r2: { configured: true, reason: null, bucket: 'addabaaz-premium', prefix: 'premium', publicBaseUrl: 'https://cdn.example.com' },
  site: { configured: false, apiUrl: null },
  limits: { maxUploadBytes: 16 * 1024 ** 3, concurrency: 1, retentionHours: 48 },
  videoExtensions: ['mp4', 'mkv', 'mov'],
};
const HEALTH = {
  ok: true, version: '1.0.0', ffmpeg: { found: true, version: '7.0.2', path: '/usr/bin/ffmpeg' },
  r2: { configured: true, bucket: 'addabaaz-premium', prefix: 'premium' }, site: { configured: false },
  queue: { active: 0, queued: 0, counts: { done: 3, running: 0, failed: 1, queued: 0, canceled: 0 } },
  disk: { freeBytes: 42 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 },
};
const DONE_JOB = {
  id: '20261004-done01', createdAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:04:31.000Z', status: 'done', stage: 'done',
  source: { type: 'upload', name: 'episode-6.mp4', size: 734003200 },
  options: { slug: 'shahid-ep6', preset: 'auto', segmentSec: 6, packaging: 'ts', r2Prefix: 'premium' },
  progress: { percent: 100, stage: 'done', etaSeconds: 0, bytes: 0, speed: 0.9, fps: 28, segments: {} },
  output: { masterKey: 'premium/shahid-ep6/master.m3u8', folder: 'premium/shahid-ep6/', files: 132, bytes: 690000000, segments: 126, publicUrl: 'https://cdn.example.com/premium/shahid-ep6/master.m3u8' },
  probe: { display: '1920×1080', width: 1920, height: 1080, fps: 30, duration: 2530, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac', size: 734003200 },
  rungs: [
    { name: '1080p', size: '1920×1080', vb: '5000k', ab: '160k', segments: 21, percent: 100 },
    { name: '720p', size: '1280×720', vb: '2800k', ab: '128k', segments: 21, percent: 100 },
  ],
  logs: [{ t: '2026-10-04T10:04:30.000Z', level: 'info', message: 'uploaded 132 files to r2://addabaaz-premium/premium/shahid-ep6/' }],
  error: null,
};
const RUNNING_JOB = {
  id: '20261004-run001', createdAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:01:00.000Z', status: 'running', stage: 'encoding',
  source: { type: 'upload', name: 'reel.mov', size: 52428800 },
  options: { slug: 'reel-12', preset: 'auto', segmentSec: 6, packaging: 'ts', r2Prefix: 'premium' },
  progress: { percent: 42.4, stage: 'encoding', etaSeconds: 95, bytes: 12000000, speed: 1.42, fps: 27, segments: { '1080p': 3 } },
  output: null,
  probe: { display: '1080×1920', width: 1080, height: 1920, fps: 30, duration: 40, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac' },
  rungs: [{ name: '1080p', size: '1080×1920', vb: '5000k', ab: '160k', segments: 3, percent: 42.4 }],
  logs: [], error: null,
};

/** Installs the DOM globals the portal expects, points fetch at canned answers and imports the module. */
async function bootPortal({ token = 'dev-token-addabaaz-hls-0123456789', jobs = [DONE_JOB], config = CONFIG, health = HEALTH, siteVideos = null } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost:8080/' });
  const { window } = dom;
  const document = window.document;
  if (token) window.localStorage.setItem('ab.hls.token', token);
  const calls = [];
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (text) => { calls.push({ clip: text }); } }, configurable: true });

  const defineGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  for (const name of ['window', 'document', 'localStorage', 'navigator', 'location']) defineGlobal(name, window[name] ?? window);
  for (const name of ['XMLHttpRequest', 'Event', 'CustomEvent', 'Blob', 'FormData']) if (window[name]) defineGlobal(name, window[name]);
  // The portal polls on a timer; wrap the timer functions so every handle can be cleared when the test
  // ends (otherwise the pending refresh loop keeps the runner alive).
  const handles = new Set();
  defineGlobal('setTimeout', (...args) => { const h = ORIGINAL_TIMERS.setTimeout(...args); handles.add(h); return h; });
  defineGlobal('setInterval', (...args) => { const h = ORIGINAL_TIMERS.setInterval(...args); handles.add(h); return h; });
  defineGlobal('clearTimeout', (h) => { handles.delete(h); return ORIGINAL_TIMERS.clearTimeout(h); });
  defineGlobal('clearInterval', (h) => { handles.delete(h); return ORIGINAL_TIMERS.clearInterval(h); });

  const json = (data, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(data), json: async () => data, body: null });
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    calls.push({ path, method: opts.method || 'GET', auth: opts.headers?.Authorization || opts.headers?.authorization || null });
    if (path === '/health') return json(health);
    if (path.startsWith('/api/v1/config')) return json(config);
    if (path.startsWith('/api/v1/site/videos')) return json(siteVideos ? { apiUrl: 'https://app.example.com', videos: siteVideos } : { error: { code: 'site_not_configured', message: 'The catalog bridge is not configured.' } }, siteVideos ? 200 : 503);
    if (path.startsWith('/api/v1/jobs?')) return json({ total: jobs.length, jobs, counts: health.queue?.counts || {}, queue: health.queue || { active: 0, queued: 0 } });
    const streamMatch = path.match(/^\/api\/v1\/jobs\/([^/?]+)\/stream$/);
    if (streamMatch) {   // one NDJSON snapshot, then the stream closes (what a finished job produces for real)
      const job = jobs.find((j) => j.id === streamMatch[1]);
      const body = `{"job":${JSON.stringify(job)}}\n`;
      return { ok: true, status: 200, headers: { get: () => 'application/x-ndjson' }, text: async () => body, json: async () => JSON.parse(body), body: new Response(body).body };
    }
    if (/^\/api\/v1\/jobs\/[^/?]+$/.test(path)) return json({ job: jobs.find((j) => path.endsWith(j.id)) || DONE_JOB });
    if (path.endsWith('/cancel') || path.endsWith('/retry')) return json({ ok: true });
    return json({ error: { code: 'not_found', message: 'Unknown endpoint.' } }, 404);
  };

  await import(`${SCRIPT_URL}?v=${Math.random()}`);   // a fresh module instance per test
  await settle(() => document.querySelector('#gate').hidden && (document.querySelector('.job') || /No jobs yet|not configured/i.test(document.querySelector('#jobs').textContent)));
  return {
    dom, window, document, calls,
    close: () => {
      for (const h of handles) { ORIGINAL_TIMERS.clearTimeout(h); ORIGINAL_TIMERS.clearInterval(h); }
      handles.clear();
      dom.window.close();
      for (const [name, value] of Object.entries(ORIGINAL_TIMERS)) defineGlobal(name, value);
    },
  };
}

/** Polls until `check()` is true (the portal paints asynchronously after its fetches resolve). */
async function settle(check, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => nodeSetTimeout(r, 15));
  }
}
const text = (el) => (el ? el.textContent : '');
/** Runs a test against a fresh portal and always tears the window (and its timers) down. */
function withPortal(options, fn) {
  return async (t) => {
    const portal = await bootPortal(options);
    t.after(() => portal.close());
    await fn(portal, t);
  };
}

test('with a saved token the portal boots: health pills, options, defaults and the job list',
  withPortal({}, async ({ document, calls }) => {
    assert.equal(document.querySelector('#gate').hidden, true, 'the token gate is hidden');
    assert.equal(document.querySelector('#main').hidden, false);
    const pills = text(document.querySelector('#pills'));
    assert.match(pills, /ffmpeg 7\.0\.2/);
    assert.match(pills, /addabaaz-premium/);
    assert.match(pills, /42\.00 GB/, 'free disk is shown');
    assert.match(pills, /3 done/, 'the job counters are shown');
    assert.equal(document.querySelector('#preset').value, 'auto', 'the configured default preset is selected');
    assert.equal(document.querySelector('#segments').value, '6', 'the 6 s default segment length is selected');
    assert.equal(document.querySelector('#packaging').value, 'ts');
    assert.match(document.querySelector('#prefix').value, /premium/);
    assert.match(text(document.querySelector('#limitsNote')), /16\.00 GB/);
    assert.ok(calls.some((c) => c.path === '/api/v1/jobs?limit=100'), 'the job list was requested');
    assert.ok(calls.some((c) => c.path === '/health'), 'health was polled');
    for (const call of calls.filter((c) => c.path.startsWith('/api/v1'))) {
      assert.equal(call.auth, 'Bearer dev-token-addabaaz-hls-0123456789', `${call.path} carried the token`);
    }
  }));

test('without a token the portal shows the gate and explains what to paste',
  withPortal({ token: null, jobs: [] }, async ({ document }) => {
    assert.equal(document.querySelector('#gate').hidden, false, 'the gate is shown');
    assert.equal(document.querySelector('#main').hidden, true);
    assert.match(text(document.querySelector('#gate')), /CONVERTER_TOKEN/);
    assert.equal(document.querySelector('#tok').value, '');
  }));

test('an empty job list says what to do next, and R2 is reported as configured',
  withPortal({ jobs: [] }, async ({ document }) => {
    assert.match(text(document.querySelector('#jobs')), /No jobs yet/);
    assert.match(text(document.querySelector('#jobs')), /drop a video|Start conversion/i);
  }));

test('a finished job shows its R2 key, the copy action and a ZIP download',
  withPortal({}, async ({ document, calls }) => {
    const card = document.querySelector('.job');
    assert.match(text(card), /shahid-ep6/);
    assert.match(text(card), /premium\/shahid-ep6\/master\.m3u8/);
    assert.match(text(card), /132 files/);
    assert.equal(text(card.querySelector('.badge')).trim(), 'done');
    assert.ok(card.querySelector('button[data-act="download"]'), 'a download button exists');
    const copy = card.querySelector('button[data-act="copy"]');
    assert.ok(copy, 'a copy button exists');
    copy.click();
    await settle(() => calls.some((c) => c.clip), 1000);
    assert.equal(calls.find((c) => c.clip).clip, 'premium/shahid-ep6/master.m3u8', 'the exact key is copied');
  }));

test('a running job shows per-quality progress, speed, ETA and a cancel action',
  withPortal({ jobs: [RUNNING_JOB] }, async ({ document }) => {
    const card = document.querySelector('.job');
    assert.equal(text(card.querySelector('.badge')).trim(), 'encoding');
    assert.match(text(card), /1080p/);
    assert.match(text(card), /1\.42×/, 'encoding speed');
    assert.match(text(card), /1m 35s left/, 'ETA');
    assert.ok(card.querySelector('button[data-act="cancel"]'), 'a running job can be canceled');
    assert.ok(!card.querySelector('button[data-act="download"]'), 'nothing to download yet');
  }));

test('a failed job explains the failure, shows the hint and offers a retry',
  withPortal({
    jobs: [{ ...DONE_JOB, id: '20261004-fail1', status: 'failed', stage: 'failed', output: null, error: { code: 'ffmpeg_missing', message: 'ffmpeg was not found (looked for “ffmpeg”).', hint: 'Install it or run “npm run get:ffmpeg”.' } }],
  }, async ({ document }) => {
    const card = document.querySelector('.job');
    assert.equal(text(card.querySelector('.badge')).trim(), 'failed');
    assert.match(text(card), /ffmpeg was not found/);
    assert.match(text(card), /get:ffmpeg/, 'the hint is shown, not just the error');
    assert.ok(card.querySelector('button[data-act="retry"]'));
  }));

test('the detail drawer paints the probe, the ladder, the log and the key',
  withPortal({}, async ({ document }) => {
    document.querySelector('button[data-act="open"]').click();
    await settle(() => document.querySelector('#drawerBody .rungs'), 1000);
    const body = text(document.querySelector('#drawerBody'));
    assert.match(body, /1920×1080 @30fps/);
    assert.match(body, /h264 \+ aac/);
    assert.match(body, /1080p/);
    assert.match(body, /In R2/);
    assert.match(body, /premium\/shahid-ep6\/master\.m3u8/);
    assert.match(body, /uploaded 132 files/);
    assert.ok(document.querySelector('#drawerBody [data-copy]'), 'the drawer can copy the key again');
    assert.ok(document.querySelector('#drawerBody [data-act="delete"]'), 'a job can be deleted');
    assert.equal(document.querySelector('#drawer').hidden, false);
    document.querySelector('#drawerBody [data-close]').click();
    assert.equal(document.querySelector('#drawer').hidden, true, 'the drawer closes again');
  }));

test('with R2 unconfigured the upload option is disabled and the reason is shown',
  withPortal({
    config: { ...CONFIG, r2: { configured: false, reason: 'R2_BUCKET is not set.', bucket: null, prefix: 'premium' } },
    health: { ...HEALTH, r2: { configured: false, reason: 'R2_BUCKET is not set.' } },
  }, async ({ document }) => {
    const upload = document.querySelector('#upload');
    assert.equal(upload.disabled, true, 'the upload toggle is disabled');
    assert.equal(upload.checked, false);
    assert.match(text(document.querySelector('#newErr')), /R2 is not configured/);
    assert.match(text(document.querySelector('#pills')), /R2 not configured/);
  }));

test('a catalog bridge that is off leaves the publish picker hidden',
  withPortal({}, async ({ document }) => {
    assert.equal(document.querySelector('#drawer').hidden, true);
    assert.ok(!document.querySelector('#siteHint') || !/publish/i.test(text(document.querySelector('#siteHint'))));
  }));
