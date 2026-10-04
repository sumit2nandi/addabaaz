// The dependency-free ZIP writer: the archive it produces must be readable by other tools, with
// correct CRCs — a broken download would otherwise only be discovered by the operator.
// Run: node --test test/zip.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeZip, crc32 } from '../src/zip.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hls-zip-'));

test('crc32 matches the reference value for “123456789”', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('')), 0);
});

test('the archive opens with python’s zipfile, keeps paths and passes CRC checks', async () => {
  const dir = tmp();
  const files = [
    { path: path.join(dir, 'master.m3u8'), name: 'ep1/master.m3u8', body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n720p/index.m3u8\n' },
    { path: path.join(dir, 'index.m3u8'), name: 'ep1/720p/index.m3u8', body: '#EXTM3U\nseg_000.ts\n' },
    { path: path.join(dir, 'seg_000.ts'), name: 'ep1/720p/seg_000.ts', body: Buffer.alloc(65536, 42).toString('latin1') },
  ];
  for (const f of files) fs.writeFileSync(f.path, f.body, 'latin1');
  const zipPath = path.join(dir, 'package.zip');
  const out = await writeZip(zipPath, files.map((f) => ({ path: f.path, name: f.name })));
  assert.equal(out.files, 3);
  assert.ok(out.bytes > 65536);

  const report = execFileSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
print(z.testzip() or 'CRC-OK')
print(' '.join(sorted(z.namelist())))
print(z.read('ep1/720p/seg_000.ts')[:4].hex(), len(z.read('ep1/720p/seg_000.ts')))
`, zipPath], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(report[0], 'CRC-OK');
  assert.equal(report[1], 'ep1/720p/index.m3u8 ep1/720p/seg_000.ts ep1/master.m3u8');
  assert.equal(report[2], `2a2a2a2a 65536`, 'the stored bytes are unchanged');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('names are sanitised and an empty package still produces a valid archive', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.txt');
  fs.writeFileSync(f, 'hello');
  const zipPath = path.join(dir, 'empty.zip');
  await writeZip(zipPath, []);
  assert.ok(fs.statSync(zipPath).size > 0);
  const names = execFileSync('python3', ['-c', 'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).namelist())', zipPath], { encoding: 'utf8' }).trim();
  assert.equal(names, '[]');

  const zip2 = path.join(dir, 'escape.zip');
  await writeZip(zip2, [{ path: f, name: '/../evil/a.txt' }]);
  const inside = execFileSync('python3', ['-c', 'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).namelist()[0])', zip2], { encoding: 'utf8' }).trim();
  assert.equal(inside, 'evil/a.txt');
  fs.rmSync(dir, { recursive: true, force: true });
});
