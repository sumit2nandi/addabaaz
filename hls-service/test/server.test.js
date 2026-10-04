// Input handling on the HTTP edge: file names, “is this a video?”, slugs, prefixes, option defaults
// and the streaming writer's size cap. These are the checks that keep a hostile upload from becoming a
// path traversal or a 40 GB file in a temporary folder.
// Run: node --test test/server.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { safeName, looksLikeVideo, slugify, safePrefix, normalizeOptions, streamToFile, VIDEO_EXT } from '../src/server.js';
import { configFromEnv } from '../src/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hls-srv-'));
const cfg = configFromEnv({ CONVERTER_TOKEN: 't'.repeat(30), R2_PREFIX: 'premium', DEFAULT_PRESET: 'hd' });

test('uploaded file names cannot escape the staging folder', () => {
  assert.equal(safeName('../../etc/passwd.mp4'), 'passwd.mp4');
  assert.equal(safeName('C:\\Users\\me\\clip.mp4'), 'clip.mp4');
  assert.equal(safeName('my episode (final).MP4'), 'my-episode-final.MP4');
  assert.equal(safeName('....//..//x.mp4'), 'x.mp4');
  assert.equal(safeName(''), 'video.mp4');
  assert.equal(safeName('-leading-dash.mp4'), 'leading-dash.mp4');
  assert.ok(safeName('x'.repeat(400) + '.mp4').length <= 120);
  assert.ok(!safeName('a\u0000b.mp4').includes('\0'));
});

test('only video-looking uploads are accepted', () => {
  for (const name of ['a.mp4', 'a.MOV', 'a.mkv', 'a.avi', 'a.webm', 'a.flv', 'a.wmv', 'a.ts', 'a.m2ts', 'a.3gp', 'a.ogv', 'a.vob', 'a.mxf', 'a.rmvb', 'a.mpeg', 'a.divx', 'a.h264'])
    assert.equal(looksLikeVideo(name, ''), true, `${name} is a video`);
  assert.equal(looksLikeVideo('noextension', 'video/quicktime'), true, 'iOS blobs have no extension');
  assert.equal(looksLikeVideo('noextension', 'video/mp4; codecs="avc1"'), true);
  for (const name of ['payload.exe', 'page.html', 'script.js', 'vector.svg', 'song.mp3', 'poster.jpg', 'archive.zip', 'notes.pdf', 'x.mov.html'])
    assert.equal(looksLikeVideo(name, 'video/mp4'), false, `${name} is never accepted, whatever the MIME type says`);
  assert.equal(looksLikeVideo('strange.bin', 'application/octet-stream'), false);
  assert.ok(VIDEO_EXT.has('mp4') && VIDEO_EXT.has('mkv'));
});

test('slugs and R2 prefixes are safe object-key parts', () => {
  assert.equal(slugify('Shahid Episode 6!!.mp4'), 'shahid-episode-6');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify(''), 'video');
  assert.equal(slugify('காட்சி'), 'video', 'a non-Latin name falls back instead of producing an empty key');
  assert.equal(safePrefix('/premium//shows/'), 'premium/shows');
  assert.equal(safePrefix('../../evil'), 'evil');
  assert.equal(safePrefix(''), 'premium');
  assert.equal(safePrefix('weird:name*here'), 'weird_name_here');
});

test('job options fall back to safe defaults and keep sensible values', () => {
  const o = normalizeOptions({}, { name: 'My Show S01E02.mkv', cfg });
  assert.equal(o.slug, 'my-show-s01e02');
  assert.equal(o.preset, 'hd', 'the configured DEFAULT_PRESET is used');
  assert.equal(o.segmentSec, 6);
  assert.equal(o.packaging, 'ts');
  assert.equal(o.x264Preset, 'medium');
  assert.equal(o.profile, 'main');
  assert.equal(o.r2Prefix, 'premium');
  assert.equal(o.upload, true);
  assert.equal(o.keepLocal, false);

  const custom = normalizeOptions({ slug: 'Ep 3', preset: 'mobile', segmentSec: '4', packaging: 'fmp4', x264Preset: 'veryfast', profile: 'high', r2Prefix: 'movies/2026', upload: 'false', keepLocal: 'true' }, { name: 'x.mp4', cfg });
  assert.deepEqual(custom, { slug: 'ep-3', preset: 'mobile', segmentSec: 4, packaging: 'fmp4', x264Preset: 'veryfast', profile: 'high', r2Prefix: 'movies/2026', upload: false, keepLocal: true });
  // Out-of-range values are clamped instead of rejected.
  assert.equal(normalizeOptions({ segmentSec: 0 }, { cfg }).segmentSec, 6);
  assert.equal(normalizeOptions({ segmentSec: -5 }, { cfg }).segmentSec, 1);
  assert.equal(normalizeOptions({ segmentSec: 500 }, { cfg }).segmentSec, 30);
});

test('the streaming writer enforces the size cap and cleans up after a failure', async () => {
  const dir = tmp();
  const dest = path.join(dir, 'nested', 'file.mp4');
  const written = await streamToFile(Readable.from([Buffer.alloc(1000, 1), Buffer.alloc(500, 1)]), dest, 10_000);
  assert.equal(written, 1500);
  assert.equal(fs.statSync(dest).size, 1500);

  const tooBig = path.join(dir, 'big.mp4');
  await assert.rejects(() => streamToFile(Readable.from([Buffer.alloc(5000, 1)]), tooBig, 1000), (e) => {
    assert.equal(e.status, 413);
    assert.equal(e.code, 'too_large');
    return true;
  });
  assert.equal(fs.existsSync(tooBig), false, 'the partial file is removed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an interrupted upload does not leave a half file behind', async () => {
  const dir = tmp();
  const dest = path.join(dir, 'cut.mp4');
  const stream = new Readable({ read() { this.push(Buffer.alloc(100, 1)); this.destroy(new Error('connection reset')); } });
  await assert.rejects(() => streamToFile(stream, dest, 1e6), /interrupted/);
  assert.equal(fs.existsSync(dest), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the configuration reports what is missing instead of failing silently', async () => {
  const { configProblems } = await import('../src/config.js');
  const bare = configFromEnv({ DATA_DIR: tmp() });
  const problems = configProblems(bare);
  assert.ok(problems.some((p) => /CONVERTER_TOKEN is not set/.test(p)));
  assert.ok(problems.some((p) => /R2 is not configured/.test(p)));
  const short = configProblems(configFromEnv({ CONVERTER_TOKEN: 'abc' }));
  assert.ok(short.some((p) => /at least 24/.test(p)));
  const good = configProblems(configFromEnv({ CONVERTER_TOKEN: 'x'.repeat(30), R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd' }));
  assert.deepEqual(good, []);
});
