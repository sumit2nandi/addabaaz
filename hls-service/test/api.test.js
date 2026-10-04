// The whole service, end to end, without a real encoder: upload → queue → package → upload to a real
// (fake, signature-checking) bucket → live progress stream → ZIP download → cancel/retry/delete.
// Run: node --test test/api.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configFromEnv, prepareDataDirs } from '../src/config.js';
import { createStore } from '../src/store.js';
import { createTranscoder } from '../src/transcode.js';
import { createQueue } from '../src/queue.js';
import { createR2 } from '../src/r2.js';
import { createSiteBridge } from '../src/site.js';
import { createServer } from '../src/server.js';
import { createFakeFfmpeg, FAKE_PROBE } from './helpers/fake-ffmpeg.mjs';
import { startFakeS3 } from './helpers/fake-s3.mjs';

const TOKEN = 'test-token-0123456789abcdefghijkl';

/** Boots one isolated service instance: temp data dir, fake ffmpeg, fake bucket. */
async function boot({ ffmpeg = {}, s3 = null, extraEnv = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-api-'));
  const bucket = s3 || (await startFakeS3());
  const cfg = prepareDataDirs(configFromEnv({
    CONVERTER_TOKEN: TOKEN, DATA_DIR: dir, PORT: '0', FFMPEG_PATH: 'fake-ffmpeg', FFPROBE_PATH: 'fake-ffprobe',
    R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'AKIDEXAMPLE', R2_SECRET_ACCESS_KEY: 'secret-key-example',
    R2_ENDPOINT: bucket.url, R2_BUCKET: bucket.bucket, R2_PREFIX: 'premium', ...extraEnv,
  }));
  const fake = createFakeFfmpeg(ffmpeg);
  const store = createStore({ file: cfg.jobsFile, log: () => {} });
  store.load();
  const transcoder = createTranscoder(cfg, { spawn: fake.spawn, log: () => {} });
  const r2 = createR2(cfg.r2, { retries: 2, log: () => {} });
  const site = createSiteBridge(cfg, {});
  const queue = createQueue({ cfg, store, transcoder, r2, log: () => {} });
  const app = createServer({ cfg, store, queue, transcoder, r2, site, log: () => {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, { method = 'GET', body, raw, token = TOKEN, headers = {} } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, res };
  };
  /** Waits for a job to reach a final state (the queue is asynchronous). */
  const settle = async (id, timeoutMs = 15000) => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const { data } = await call(`/api/v1/jobs/${id}`);
      const job = data?.job;
      if (job && ['done', 'failed', 'canceled'].includes(job.status)) return job;
      if (Date.now() > until) throw new Error(`job ${id} did not settle (last: ${job?.status}/${job?.stage})`);
      await new Promise((r) => setTimeout(r, 40));
    }
  };
  return {
    cfg, store, queue, r2, app, base, call, settle, fake, bucket,
    async stop() { queue.stop(); server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await store.close(); await bucket.stop(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

/** Small helper: stage a file through the API the way the portal does. */
async function stage(svc, name = 'episode.mp4', bytes = Buffer.from('fake video bytes')) {
  const slot = await svc.call('/api/v1/uploads', { method: 'POST' });
  assert.equal(slot.status, 201);
  const put = await fetch(`${svc.base}/api/v1/uploads/${slot.data.uploadId}?name=${encodeURIComponent(name)}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'video/mp4' }, body: bytes,
  });
  assert.equal(put.status, 201);
  return slot.data.uploadId;
}

test('health is public and reports what is missing; everything else needs the token', async () => {
  const svc = await boot();
  try {
    const health = await svc.call('/health', { token: null });
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    assert.equal(health.data.ffmpeg.found, true);
    assert.equal(health.data.r2.configured, true);
    assert.equal(health.data.r2.bucket, svc.bucket.bucket);
    for (const route of ['/api/v1/config', '/api/v1/jobs', '/api/v1/system', '/api/v1/r2/check']) {
      assert.equal((await svc.call(route, { token: null })).status, 401, `${route} must require the token`);
      assert.equal((await svc.call(route, { token: 'wrong-token-0123456789abcdefghij' })).status, 401);
    }
    const cfg = await svc.call('/api/v1/config');
    assert.equal(cfg.data.r2.prefix, 'premium');
    assert.ok(cfg.data.presets.some((p) => p.id === 'auto'));
    assert.ok(cfg.data.videoExtensions.includes('mkv'));
  } finally { await svc.stop(); }
});

test('a browser upload is streamed to disk, converted and pushed to R2 with the right keys', async () => {
  const svc = await boot();
  try {
    const uploadId = await stage(svc, 'My Episode.MP4', Buffer.alloc(5000, 1));
    const created = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { uploadId }, options: { slug: 'shahid-ep6', preset: 'hd', segmentSec: 6 } } });
    assert.equal(created.status, 201);
    const job = await svc.settle(created.data.job.id);
    assert.equal(job.status, 'done', JSON.stringify(job.error));
    assert.equal(job.probe.display, '1920×1080');
    assert.deepEqual(job.rungs.map((r) => r.name), ['720p', '540p', '480p', '360p', '240p']);

    // The package is in the bucket, with the master playlist uploaded LAST.
    const keys = svc.bucket.list().map((o) => o.key).sort();
    assert.ok(keys.includes('premium/shahid-ep6/master.m3u8'), 'master playlist is at <prefix>/<slug>/master.m3u8');
    assert.ok(keys.includes('premium/shahid-ep6/720p/index.m3u8'));
    assert.ok(keys.includes('premium/shahid-ep6/720p/seg_000.ts'));
    assert.equal(job.output.masterKey, 'premium/shahid-ep6/master.m3u8');
    assert.equal(job.output.folder, 'premium/shahid-ep6/');
    assert.equal(job.output.local, undefined, 'an uploaded job is not a local-only job');
    const puts = svc.bucket.requests.filter((r) => r.method === 'PUT').map((r) => r.key);
    assert.equal(puts.at(-1), 'premium/shahid-ep6/master.m3u8', 'the master playlist goes up last');
    assert.ok(puts.indexOf('premium/shahid-ep6/720p/seg_000.ts') < puts.indexOf('premium/shahid-ep6/720p/index.m3u8'), 'segments before their playlist');

    // Content types are set so browsers/R2 serve the files correctly.
    assert.equal(svc.bucket.objects.get('premium/shahid-ep6/master.m3u8').contentType, 'application/vnd.apple.mpegurl');
    assert.equal(svc.bucket.objects.get('premium/shahid-ep6/720p/seg_000.ts').contentType, 'video/mp2t');
    // The log tells the operator exactly what to paste into the Content studio.
    assert.ok(job.logs.some((l) => l.message.includes('premium/shahid-ep6/master.m3u8')));
    assert.ok(job.logs.some((l) => l.message.includes('Content studio')));
  } finally { await svc.stop(); }
});

test('options are validated: unknown values fall back, unsafe slugs and prefixes are cleaned', async () => {
  const svc = await boot();
  try {
    const uploadId = await stage(svc, 'raw clip.mkv');
    const { data } = await svc.call('/api/v1/jobs', {
      method: 'POST',
      body: { source: { uploadId }, options: { slug: '../../etc/passwd', preset: 'nope', segmentSec: 999, packaging: 'weird', r2Prefix: '/../evil//', x264Preset: 'turbo' } },
    });
    const o = data.job.options;
    assert.equal(o.slug, 'etc-passwd', 'traversal characters never reach an object key');
    assert.equal(o.preset, 'auto');
    assert.equal(o.segmentSec, 30);
    assert.equal(o.packaging, 'ts');
    assert.equal(o.r2Prefix, 'evil');
    assert.equal(o.x264Preset, 'medium');
    await svc.settle(data.job.id);
  } finally { await svc.stop(); }
});

test('non-video and oversized uploads are refused before anything is encoded', async () => {
  const svc = await boot({ extraEnv: { MAX_UPLOAD_GB: '0.001' } });    // 1 MB (the configured floor)
  try {
    const slot = await svc.call('/api/v1/uploads', { method: 'POST' });
    const exe = await fetch(`${svc.base}/api/v1/uploads/${slot.data.uploadId}?name=payload.exe`, { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` }, body: Buffer.from('MZ') });
    assert.equal(exe.status, 400);
    assert.match((await exe.json()).error.message, /does not look like a video/);

    const big = await fetch(`${svc.base}/api/v1/uploads/${slot.data.uploadId}?name=big.mp4`, { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'video/mp4' }, body: Buffer.alloc(2 * 1024 * 1024, 3) });
    assert.equal(big.status, 413);
    assert.equal(fs.readdirSync(path.join(svc.cfg.uploadsDir, slot.data.uploadId)).length, 0, 'the rejected file is deleted again');

    // Unknown upload id and unknown source shapes are 4xx, not 500s.
    assert.equal((await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { uploadId: 'up_nope' } } })).status, 404);
    const noSource = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: {} } });
    assert.equal(noSource.status, 400);
    const badUrl = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { url: 'ftp://x/y.mp4' } } });
    assert.equal(badUrl.status, 400);
  } finally { await svc.stop(); }
});

test('a missing R2 object as source is reported clearly; a download-only job stays local', async () => {
  const svc = await boot();
  try {
    const missing = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { r2Key: 'raw/nope.mp4' } } });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.error.code, 'r2_object_missing');
    assert.match(missing.data.error.message, /raw\/nope\.mp4/);

    // Put an object in the bucket and use it as the source — the service downloads it itself.
    const sourceKey = 'raw/episode.mkv';
    svc.bucket.objects.set(sourceKey, { body: Buffer.alloc(1234, 9), contentType: 'video/x-matroska' });
    const created = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { r2Key: sourceKey }, options: { slug: 'from-r2', upload: false } } });
    assert.equal(created.status, 201);
    const job = await svc.settle(created.data.job.id);
    assert.equal(job.status, 'done', JSON.stringify(job.error));
    assert.equal(job.source.type, 'r2');
    assert.equal(job.output.local, true, 'download-only jobs keep the package on disk');
    assert.ok(fs.existsSync(path.join(svc.cfg.workDir, job.id, 'hls', 'master.m3u8')));
  } finally { await svc.stop(); }
});

test('progress streams live and the finished package downloads as a valid ZIP', async () => {
  const svc = await boot();
  try {
    const uploadId = await stage(svc, 'stream.mp4');
    const created = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { uploadId }, options: { slug: 'streamed' } } });
    const id = created.data.job.id;

    // Read the NDJSON stream until the job finishes.
    const res = await fetch(`${svc.base}/api/v1/jobs/${id}/stream`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /ndjson/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', seen = 0, last = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.job) { seen++; last = msg.job; }
      }
    }
    assert.ok(seen >= 2, `several updates were streamed (got ${seen})`);
    assert.equal(last.status, 'done');
    assert.equal(last.progress.percent, 100);
    assert.equal(last.stage, 'done');

    const zip = await fetch(`${svc.base}/api/v1/jobs/${id}/download`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    assert.match(zip.headers.get('content-disposition'), /streamed-hls\.zip/);
    const zipPath = path.join(svc.cfg.dataDir, 'pkg.zip');
    fs.writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()));
    // Validate the archive with an independent reader (Python's zipfile).
    const { execFileSync } = await import('node:child_process');
    const listing = execFileSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(len(z.namelist()));print('\\n'.join(sorted(z.namelist())));print(z.testzip() or 'CRC-OK')`, zipPath], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(Number(listing[0]) >= 8, 'the archive holds the whole package');
    assert.ok(listing.includes('streamed/master.m3u8'));
    assert.ok(listing.includes('streamed/720p/seg_000.ts'));
    assert.equal(listing.at(-1), 'CRC-OK', 'every entry passes its CRC check');
  } finally { await svc.stop(); }
});

test('failing encodes explain themselves, can be retried, and can be canceled mid-run', async () => {
  const svc = await boot({ ffmpeg: { failEncodes: 1 } });
  try {
    const uploadId = await stage(svc, 'broken.mp4');
    const created = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { uploadId }, options: { slug: 'retry-me' } } });
    const failed = await svc.settle(created.data.job.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.code, 'encode_failed');
    assert.match(failed.error.message, /ffmpeg exited with code 1/);

    // Retry: the second attempt succeeds (failEncodes was only 1).
    const retry = await svc.call(`/api/v1/jobs/${created.data.job.id}/retry`, { method: 'POST' });
    assert.equal(retry.status, 200);
    const done = await svc.settle(created.data.job.id);
    assert.equal(done.status, 'done', JSON.stringify(done.error));

    // A source that does not look like a video gives the “bad input” hint instead.
    const svc2 = await boot({ ffmpeg: { failProbe: true } });
    try {
      const up2 = await stage(svc2, 'damaged.mp4');
      const created2 = await svc2.call('/api/v1/jobs', { method: 'POST', body: { source: { uploadId: up2 } } });
      const bad = await svc2.settle(created2.data.job.id);
      assert.equal(bad.error.code, 'bad_input');
      assert.match(bad.error.hint, /remux|re-export/i);

      // Cancel while encoding: the job ends as canceled and the encoder is stopped.
      const up3 = await stage(svc2, 'slow.mp4');
      // The second instance hangs every encode, so the job stays in “encoding” until canceled.
      svc2.fake.calls.length = 0;
      const hanging = await boot({ ffmpeg: { hangEncodes: 1 } });
      try {
        const up4 = await stage(hanging, 'hang.mp4');
        const created4 = await hanging.call('/api/v1/jobs', { method: 'POST', body: { source: { uploadId: up4 }, options: { slug: 'hangs' } } });
        await new Promise((r) => setTimeout(r, 300));
        const cancel = await hanging.call(`/api/v1/jobs/${created4.data.job.id}/cancel`, { method: 'POST' });
        assert.equal(cancel.status, 200);
        const canceled = await hanging.settle(created4.data.job.id);
        assert.equal(canceled.status, 'canceled');
        assert.equal(canceled.error.code, 'canceled');
      } finally { await hanging.stop(); }
    } finally { await svc2.stop(); }
  } finally { await svc.stop(); }
});

test('a finished job can be deleted (locally) and publishing to the site is opt-in', async () => {
  const svc = await boot();
  try {
    const uploadId = await stage(svc, 'publish.mp4');
    const created = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { uploadId }, options: { slug: 'publish-me' } } });
    const job = await svc.settle(created.data.job.id);
    assert.equal(job.status, 'done');

    // The catalog bridge is off unless APP_API_URL + APP_ADMIN_TOKEN are configured.
    const site = await svc.call('/api/v1/site/videos');
    assert.equal(site.status, 503);
    assert.equal(site.data.error.code, 'site_not_configured');
    const publish = await svc.call(`/api/v1/jobs/${job.id}/publish`, { method: 'POST', body: { videoId: 'x' } });
    assert.equal(publish.status, 503);

    // Deleting removes the local package but leaves the bucket alone.
    const before = svc.bucket.objects.size;
    const del = await svc.call(`/api/v1/jobs/${job.id}`, { method: 'DELETE', body: {} });
    assert.equal(del.status, 200);
    assert.equal(svc.bucket.objects.size, before, 'R2 objects are never deleted by the service');
    assert.equal((await svc.call(`/api/v1/jobs/${job.id}`)).status, 404);
    assert.equal((await svc.call(`/api/v1/jobs/${job.id}/download`)).status, 404);
  } finally { await svc.stop(); }
});

test('the R2 self-check and the sweeper are reachable from the API', async () => {
  const svc = await boot();
  try {
    const check = await svc.call('/api/v1/r2/check');
    assert.equal(check.status, 200);
    assert.equal(check.data.ok, true, JSON.stringify(check.data.steps));
    const sweep = await svc.call('/api/v1/maintenance/sweep', { method: 'POST', body: {} });
    assert.equal(sweep.status, 200);
    assert.equal(typeof sweep.data.removed, 'number');
    const system = await svc.call('/api/v1/system');
    assert.equal(system.data.node, process.version);
    assert.ok(system.data.queue.counts.done >= 0);
  } finally { await svc.stop(); }
});

test('the portal page and its scripts are served, and unknown API routes answer JSON', async () => {
  const svc = await boot();
  try {
    const page = await svc.call('/', { token: null });
    assert.equal(page.status, 200);
    assert.match(page.data, /HLS Converter/);
    assert.match((await svc.call('/app.js', { token: null })).data, /api\/v1/);
    assert.equal((await svc.call('/styles.css', { token: null })).status, 200);
    const unknown = await svc.call('/api/v1/nope', { token: null });
    assert.equal(unknown.status, 401, 'the API answers 401 before revealing which routes exist');
    const unknownAuthed = await svc.call('/api/v1/nope');
    assert.equal(unknownAuthed.status, 404);
    assert.equal(unknownAuthed.data.error.code, 'not_found');
  } finally { await svc.stop(); }
});

test('a long upload is refused while another job is running when the queue is full', async () => {
  const svc = await boot({ ffmpeg: { hangEncodes: 3 } });
  try {
    const made = [];
    for (let i = 0; i < 3; i++) {
      const uploadId = await stage(svc, `many-${i}.mp4`);
      const created = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { uploadId }, options: { slug: `many-${i}` } } });
      assert.equal(created.status, 201);
      made.push(created.data.job.id);
    }
    // Everything hangs, so the queue keeps filling: cancel them and make sure the service stays healthy.
    for (const id of made) await svc.call(`/api/v1/jobs/${id}/cancel`, { method: 'POST' });
    for (const id of made) await svc.settle(id);
    const health = await svc.call('/health', { token: null });
    assert.equal(health.data.ok, true);
    assert.equal(health.data.queue.active, 0);
  } finally { await svc.stop(); }
});

test('the fake encoder is actually exercised (sanity: the fake probe is what the job reports)', async () => {
  const svc = await boot({ ffmpeg: { probe: { ...FAKE_PROBE, width: 1080, height: 1920, fps: 25 } } });
  try {
    const uploadId = await stage(svc, 'reel.mp4');
    const created = await svc.call('/api/v1/jobs', { method: 'POST', body: { source: { uploadId }, options: { slug: 'reel' } } });
    const job = await svc.settle(created.data.job.id);
    assert.equal(job.probe.display, '1080×1920');
    assert.equal(job.probe.fps, 25);
    assert.deepEqual(job.rungs.map((r) => r.size), ['1080×1920', '720×1280', '540×960', '480×854', '360×640', '240×426']);
  } finally { await svc.stop(); }
});
