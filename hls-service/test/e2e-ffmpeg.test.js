/**
 * The real thing: a genuine ffmpeg produces a genuine HLS ladder, which is then uploaded to the fake
 * bucket and read back. Skipped automatically when no ffmpeg is available, so `npm test` still passes on
 * a machine without one (the Docker image and `npm run get:ffmpeg` both provide it).
 *
 * Run: node --test test/e2e-ffmpeg.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configFromEnv, prepareDataDirs } from '../src/config.js';
import { createStore } from '../src/store.js';
import { createTranscoder } from '../src/transcode.js';
import { createQueue } from '../src/queue.js';
import { createR2 } from '../src/r2.js';
import { createSiteBridge } from '../src/site.js';
import { createServer } from '../src/server.js';
import { startFakeS3 } from './helpers/fake-s3.mjs';
import { playlistUris } from '../src/ffmpeg.js';

/** Finds a usable ffmpeg: $FFMPEG_PATH, ./.tools, then PATH. */
function findFfmpeg() {
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  const ext = process.platform === 'win32' ? '.exe' : '';
  candidates.push(path.resolve(import.meta.dirname, '../.tools/ffmpeg' + ext));
  candidates.push('ffmpeg');
  for (const cmd of candidates) {
    const probe = cmd.includes('/') || cmd.includes('\\') ? cmd : null;
    if (probe && !fs.existsSync(probe)) continue;
    const res = spawnSync(cmd, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (res.status === 0 && /ffmpeg version/.test(res.stdout || '')) return cmd;
  }
  return null;
}

const FFMPEG = findFfmpeg();
const skip = FFMPEG ? false : 'ffmpeg is not installed (set FFMPEG_PATH, run “npm run get:ffmpeg”, or use the Docker image)';

test('a real encode: mp4 in, multi-resolution HLS out, uploaded to the bucket and playable', { skip, timeout: 300_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-e2e-'));
  const bucket = await startFakeS3();
  const ffprobe = process.env.FFPROBE_PATH || FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  const cfg = prepareDataDirs(configFromEnv({
    CONVERTER_TOKEN: 'e2e-token-0123456789abcdefghijkl', DATA_DIR: dir, PORT: '0',
    FFMPEG_PATH: FFMPEG, FFPROBE_PATH: ffprobe,
    R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'AKIDEXAMPLE', R2_SECRET_ACCESS_KEY: 'secret-key-example',
    R2_ENDPOINT: bucket.url, R2_BUCKET: bucket.bucket, MAX_UPLOAD_GB: '0.05',
  }));
  // A 3-second 640×360 clip with a tone — small, but a real encode of a real file.
  const source = path.join(dir, 'source.mp4');
  const made = spawnSync(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', source], { encoding: 'utf8' });
  assert.equal(made.status, 0, `could not generate the test clip: ${made.stderr}`);

  const store = createStore({ file: cfg.jobsFile, log: () => {} });
  const transcoder = createTranscoder(cfg, { log: () => {} });
  const r2 = createR2(cfg.r2, { log: () => {} });
  const queue = createQueue({ cfg, store, transcoder, r2, log: () => {} });
  const app = createServer({ cfg, store, queue, transcoder, r2, site: createSiteBridge(cfg), log: () => {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, opts = {}) => fetch(base + p, { ...opts, headers: { Authorization: 'Bearer e2e-token-0123456789abcdefghijkl', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });

  try {
    // The service itself confirms ffmpeg is usable.
    const health = await call('/health').then((r) => r.json());
    assert.equal(health.ffmpeg.found, true);

    const slot = await call('/api/v1/uploads', { method: 'POST' }).then((r) => r.json());
    const put = await fetch(`${base}/api/v1/uploads/${slot.uploadId}?name=clip.mp4`, { method: 'PUT', headers: { Authorization: 'Bearer e2e-token-0123456789abcdefghijkl', 'Content-Type': 'video/mp4' }, body: fs.readFileSync(source) });
    assert.equal(put.status, 201);

    const created = await call('/api/v1/jobs', { method: 'POST', body: JSON.stringify({ source: { uploadId: slot.uploadId }, options: { slug: 'e2e-clip', preset: 'auto', segmentSec: 2 } }) }).then((r) => r.json());
    assert.ok(created.job?.id, JSON.stringify(created));

    const deadline = Date.now() + 240_000;
    let job;
    for (;;) {
      ({ job } = await call(`/api/v1/jobs/${created.job.id}`).then((r) => r.json()));
      if (['done', 'failed', 'canceled'].includes(job.status)) break;
      if (Date.now() > deadline) assert.fail(`the encode did not finish (stage ${job.stage}, ${job.progress.percent}%)`);
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(job.status, 'done', JSON.stringify(job.error));
    assert.equal(job.probe.width, 640);
    assert.equal(job.probe.height, 360);
    assert.equal(job.probe.hasAudio, true);
    assert.ok(job.probe.duration >= 3.5 && job.probe.duration <= 4.5, `duration ~4 s (got ${job.probe.duration})`);
    assert.deepEqual(job.rungs.map((r) => r.name), ['360p', '240p'], 'a 360p source gets the rungs it can fill');
    assert.ok(job.rungs.every((r) => r.segments >= 2), `every rung has segments: ${JSON.stringify(job.rungs)}`);

    // The bucket holds a complete, self-consistent package.
    const keys = bucket.list().map((o) => o.key);
    assert.ok(keys.includes('premium/e2e-clip/master.m3u8'));
    const master = bucket.objects.get('premium/e2e-clip/master.m3u8').body.toString();
    assert.deepEqual(playlistUris(master), ['360p/index.m3u8', '240p/index.m3u8']);
    assert.match(master, /RESOLUTION=640x360/, 'the master playlist advertises the real resolutions');
    assert.match(master, /CODECS="avc1\.[0-9a-f]+,mp4a\.40\.2"/, 'codecs are advertised (needed by some players)');
    for (const uri of playlistUris(master)) {
      assert.ok(keys.includes(`premium/e2e-clip/${uri}`), `${uri} was uploaded`);
      const playlist = bucket.objects.get(`premium/e2e-clip/${uri}`).body.toString();
      const segments = playlist.split('\n').filter((l) => l && !l.startsWith('#'));
      assert.ok(segments.length >= 2, `${uri} lists its segments`);
      for (const seg of segments) assert.ok(keys.includes(`premium/e2e-clip/${uri.replace(/index\.m3u8$/, '')}${seg}`), `${seg} was uploaded`);
      assert.match(playlist, /#EXT-X-ENDLIST/, `${uri} is a finished (VOD) playlist`);
    }
    // The operator gets the exact key to paste into the Content studio.
    assert.equal(job.output.masterKey, 'premium/e2e-clip/master.m3u8');
    assert.ok(job.output.bytes > 0);

    // And the package can be downloaded as a ZIP that another tool can read.
    const zip = await call(`/api/v1/jobs/${job.id}/download`);
    assert.equal(zip.status, 200);
    const zipPath = path.join(dir, 'pkg.zip');
    fs.writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()));
    const { execFileSync } = await import('node:child_process');
    const listing = execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip() or "CRC-OK");print(len(z.namelist()))', zipPath], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(listing[0], 'CRC-OK');
    // master + one playlist and at least one segment per rung.
    assert.ok(Number(listing[1]) >= 1 + job.rungs.length * 2, `the archive holds the whole package (${listing[1]} entries)`);
  } finally {
    queue.stop();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await store.close();
    await bucket.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
