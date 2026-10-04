// The job store and the retention sweeper: durable history, honest recovery after a crash, and files
// that are cleaned up after LOCAL_RETENTION_HOURS but never earlier.
// Run: node --test test/store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, newJob, brief, newId } from '../src/store.js';
import { createQueue, dirSize, explain } from '../src/queue.js';
import { configFromEnv, prepareDataDirs } from '../src/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hls-store-'));
const options = { slug: 'ep', preset: 'auto', segmentSec: 6, packaging: 'ts', x264Pref: 'medium', r2Prefix: 'premium', upload: true };

test('job ids are sortable and filesystem-safe', () => {
  const id = newId();
  assert.match(id, /^\d{8}\d{6}-[0-9a-f]{6}$/);
  assert.ok(!/[^a-z0-9-]/.test(id));
});

test('a job survives a restart, and one that was running is marked interrupted (not lost or duplicated)', async () => {
  const dir = tmp();
  const file = path.join(dir, 'jobs.json');
  const store = createStore({ file, log: () => {} });
  const done = store.add(newJob({ source: { type: 'upload', name: 'a.mp4', size: 10, localPath: '/tmp/a.mp4' }, options }));
  store.update(done.id, { status: 'done', stage: 'done', output: { masterKey: 'premium/ep/master.m3u8' } });
  const running = store.add(newJob({ source: { type: 'url', name: 'b.mp4', url: 'https://x/b.mp4' }, options }));
  store.update(running.id, { status: 'running', stage: 'encoding' });
  store.add(newJob({ source: { type: 'upload', name: 'c.mp4', localPath: '/tmp/c.mp4' }, options }));
  await store.close();

  const reloaded = createStore({ file, log: () => {} });
  const { loaded, interrupted } = reloaded.load();
  assert.equal(loaded, 3);
  assert.equal(interrupted, 2, 'the queued and the running job were interrupted by the restart');
  assert.equal(reloaded.get(done.id).status, 'done', 'finished work is untouched');
  assert.equal(reloaded.get(done.id).output.masterKey, 'premium/ep/master.m3u8');
  assert.equal(reloaded.get(running.id).status, 'failed');
  assert.equal(reloaded.get(running.id).error.code, 'interrupted');
  assert.match(reloaded.get(running.id).error.message, /Retry/);
  assert.match(reloaded.get(done.id).updatedAt, /^\d{4}-/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a corrupt history file does not stop the service', () => {
  const dir = tmp();
  const file = path.join(dir, 'jobs.json');
  fs.writeFileSync(file, '{ not json at all');
  const store = createStore({ file, log: () => {} });
  assert.deepEqual(store.load(), { loaded: 0, interrupted: 0 });
  store.add(newJob({ source: { type: 'url', name: 'x.mp4', url: 'https://x' }, options }));
  assert.equal(store.list().total, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listing, counts, logs and the brief view behave', () => {
  const dir = tmp();
  const store = createStore({ file: path.join(dir, 'jobs.json'), log: () => {} });
  const a = store.add(newJob({ source: { type: 'url', name: 'a.mp4', url: 'https://x/a' }, options }));
  const b = store.add(newJob({ source: { type: 'url', name: 'b.mp4', url: 'https://x/b' }, options }));
  store.update(a.id, { status: 'done', stage: 'done' });
  assert.equal(store.list().total, 2);
  assert.equal(store.list().jobs[0].id, b.id, 'newest first');
  assert.deepEqual(store.counts(), { queued: 1, running: 0, done: 1, failed: 0, canceled: 0 });
  assert.equal(store.list({ status: 'done' }).jobs.length, 1);
  for (let i = 0; i < 400; i++) store.logJob(a.id, `line ${i}`);
  assert.equal(store.get(a.id).logs.length, 300, 'the log tail is capped');
  assert.equal(store.get(a.id).logs.at(-1).message, 'line 399');
  const short = brief(store.get(a.id));
  assert.ok(!('logs' in short));
  assert.equal(short.source.name, 'a.mp4');
  assert.equal(short.options.slug, 'ep');
  assert.equal(short.output, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('explanations name the fix (ffmpeg missing, permissions, disk, bad input)', () => {
  const cfg = { ffmpeg: '/usr/bin/ffmpeg' };
  assert.match(explain(new Error('Could not run ffmpeg (/usr/bin/ffmpeg): ENOENT'), cfg).hint, /Install|FFMPEG_PATH|get:ffmpeg/);
  assert.match(explain(Object.assign(new Error('R2 refused the upload (HTTP 403)'), { code: 'r2_denied' }), cfg).hint, /Read & Write/);
  assert.match(explain(new Error('ENOSPC: no space left on device'), cfg).hint, /disk space|LOCAL_RETENTION_HOURS/i);
  assert.match(explain(new Error('ffprobe could not read this file (exit 1): moov atom not found'), cfg).hint, /remux|re-export/i);
  const plain = explain(new Error('something odd'), cfg);
  assert.equal(plain.code, 'job_failed');
  assert.equal(plain.hint, undefined);
});

test('the sweeper frees old local files and keeps recent ones (and never touches R2)', async () => {
  const dir = tmp();
  const cfg = prepareDataDirs(configFromEnv({ DATA_DIR: dir, CONVERTER_TOKEN: 'x'.repeat(30), LOCAL_RETENTION_HOURS: '1' }));
  const store = createStore({ file: cfg.jobsFile, log: () => {} });
  const queue = createQueue({ cfg, store, transcoder: {}, r2: { configured: false }, log: () => {} });

  // One finished job with a package, one finished job that is pinned, and one abandoned upload.
  const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
  const old = store.add(newJob({ source: { type: 'upload', name: 'old.mp4', localPath: path.join(cfg.uploadsDir, 'up_old', 'old.mp4') }, options }));
  store.update(old.id, { status: 'done', stage: 'done', output: { masterKey: 'premium/x/master.m3u8', localDir: path.join(cfg.workDir, old.id, 'hls') } });
  store.get(old.id).updatedAt = threeHoursAgo;                       // as if it had finished hours ago
  fs.mkdirSync(path.join(cfg.workDir, old.id, 'hls', '720p'), { recursive: true });
  fs.writeFileSync(path.join(cfg.workDir, old.id, 'hls', 'master.m3u8'), '#EXTM3U\n');
  fs.writeFileSync(path.join(cfg.workDir, old.id, 'hls', '720p', 'seg_000.ts'), Buffer.alloc(2048, 1));
  fs.mkdirSync(path.join(cfg.uploadsDir, 'up_old'), { recursive: true });
  fs.writeFileSync(path.join(cfg.uploadsDir, 'up_old', 'old.mp4'), Buffer.alloc(4096, 2));

  const pinned = store.add(newJob({ source: { type: 'upload', name: 'kept.mp4', localPath: path.join(cfg.uploadsDir, 'up_kept', 'kept.mp4') }, options: { ...options, keepLocal: true } }));
  store.update(pinned.id, { status: 'done', stage: 'done' });
  store.get(pinned.id).updatedAt = threeHoursAgo;
  fs.mkdirSync(path.join(cfg.workDir, pinned.id, 'hls'), { recursive: true });
  fs.writeFileSync(path.join(cfg.workDir, pinned.id, 'hls', 'master.m3u8'), '#EXTM3U\n');

  // A fresh job (younger than the retention window) must survive the sweep.
  const fresh = store.add(newJob({ source: { type: 'upload', name: 'fresh.mp4', localPath: path.join(cfg.uploadsDir, 'up_fresh', 'fresh.mp4') }, options }));
  store.update(fresh.id, { status: 'done', stage: 'done' });
  fs.mkdirSync(path.join(cfg.workDir, fresh.id, 'hls'), { recursive: true });

  // An upload that never became a job, old enough to be abandoned.
  const abandoned = path.join(cfg.uploadsDir, 'up_abandoned');
  fs.mkdirSync(abandoned, { recursive: true });
  fs.writeFileSync(path.join(abandoned, 'x.mp4'), Buffer.alloc(1024, 3));
  fs.utimesSync(abandoned, new Date(Date.now() - 48 * 3600_000), new Date(Date.now() - 48 * 3600_000));

  const before = dirSize(cfg.workDir);
  const out = queue.sweep();
  assert.ok(before > 0);
  assert.ok(out.freed >= 2048 + 1024 - 1, `freed the old package and the abandoned upload (${out.freed})`);
  assert.equal(fs.existsSync(path.join(cfg.workDir, old.id)), false, 'the old package is gone');
  assert.equal(fs.existsSync(path.join(cfg.workDir, pinned.id)), true, 'a pinned job keeps its files');
  assert.equal(fs.existsSync(path.join(cfg.workDir, fresh.id)), true, 'recent jobs are untouched');
  assert.equal(fs.existsSync(abandoned), false, 'abandoned uploads are cleaned up');
  assert.equal(store.get(old.id).output.localDir, null, 'the job stops advertising a deleted folder');
  fs.rmSync(dir, { recursive: true, force: true });
});
