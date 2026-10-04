// The R2 client: SigV4 signing (checked against AWS's published example), object operations and the
// self-check — all against a real HTTP server that verifies every signature.
// Run: node --test test/r2.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { presign, createR2, parseListXml } from '../src/r2.js';
import { startFakeS3 } from './helpers/fake-s3.mjs';

test('SigV4 presigning reproduces AWS’s published example', () => {
  const { queryString } = presign({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    service: 's3',
    expires: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
  });
  // From the AWS documentation (“Example: GET Object with a presigned URL”).
  assert.match(queryString, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(queryString, /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/);
  assert.match(queryString, /X-Amz-Date=20130524T000000Z/);
  assert.match(queryString, /X-Amz-Expires=86400/);
  assert.match(queryString, /X-Amz-SignedHeaders=host/);
  assert.equal(queryString.split('&').at(-1), 'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('object keys with spaces, unicode and slashes are encoded per RFC 3986', () => {
  const r2 = createR2({ accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', bucket: 'b' });
  const url = r2.presignGet('premium/my folder/காட்சி (1).mp4');
  assert.ok(url.includes('/b/premium/my%20folder/'), 'spaces become %20, never +');
  assert.ok(url.includes('%28') && url.includes('%29'), 'parentheses are escaped');
  assert.ok(!url.includes('க'), 'non-ASCII characters are percent-encoded');
  assert.ok(!url.includes('..'), 'a key cannot escape its folder');
});

test('a client without credentials degrades instead of throwing', async () => {
  const r2 = createR2({});
  assert.equal(r2.configured, false);
  assert.match(r2.reason, /R2_ACCOUNT_ID|R2_BUCKET/);
  assert.equal(r2.presignGet, undefined);
});

test('two independent clients can exchange the same object through the bucket', async () => {
  const s3 = await startFakeS3();
  const cfg = { endpoint: s3.url, accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-key-example', bucket: s3.bucket };
  const writer = createR2(cfg);
  const reader = createR2(cfg);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-r2-'));
  const local = path.join(dir, 'seg_000.ts');
  fs.writeFileSync(local, Buffer.alloc(4096, 3));

  const put = await writer.putFile('premium/ep6/720p/seg_000.ts', local, { contentType: 'video/mp2t' });
  assert.equal(put.bytes, 4096);
  assert.equal(s3.objects.get('premium/ep6/720p/seg_000.ts').body.length, 4096, 'the bytes arrived');
  assert.equal(s3.objects.get('premium/ep6/720p/seg_000.ts').contentType, 'video/mp2t');

  const head = await reader.head('premium/ep6/720p/seg_000.ts');
  assert.deepEqual({ status: head.status, size: head.size }, { status: 200, size: 4096 });
  assert.equal((await reader.head('premium/nope.ts')).status, 404);

  const back = path.join(dir, 'back.ts');
  await reader.getToFile('premium/ep6/720p/seg_000.ts', back);
  assert.equal(fs.statSync(back).size, 4096, 'streaming download matches');

  await reader.remove('premium/ep6/720p/seg_000.ts');
  assert.equal(s3.objects.size, 0, 'delete works');
  await assert.rejects(() => reader.getToFile('premium/ep6/720p/seg_000.ts', back), /No object/);

  await s3.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('transient failures are retried and 4xx answers are not', async () => {
  const s3 = await startFakeS3();
  const cfg = { endpoint: s3.url, accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-key-example', bucket: s3.bucket };
  const r2 = createR2(cfg, { retries: 3, log: () => {} });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-r2-'));
  const local = path.join(dir, 'piece.ts');
  fs.writeFileSync(local, Buffer.from('hello'));

  s3.failPuts(2);                                       // two 503s, then success
  await r2.putFile('a/piece.ts', local, { contentType: 'video/mp2t' });
  assert.equal(s3.objects.get('a/piece.ts').body.toString(), 'hello', 'the upload succeeded after retries');

  const wrong = createR2({ ...cfg, secretAccessKey: 'not-the-key' }, { retries: 3, log: () => {} });
  await assert.rejects(() => wrong.putFile('a/piece2.ts', local), /HTTP 4|refused/i);

  await s3.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('upload permission problems are reported in words an operator can act on', async () => {
  const s3 = await startFakeS3();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-r2-'));
  const local = path.join(dir, 'x.ts');
  fs.writeFileSync(local, 'x');
  // A wrong credential pair makes the bucket answer 403 (SignatureDoesNotMatch) — retrying cannot help.
  const r2bad = createR2({ endpoint: s3.url, accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'nope', bucket: s3.bucket }, { retries: 2, log: () => {} });
  await assert.rejects(() => r2bad.putFile('x.ts', local), (e) => {
    assert.equal(e.fatal, true, 'a 403 is not retried');
    assert.match(e.message, /403/);
    assert.match(e.message, /Read & Write/);
    return true;
  });
  assert.equal(s3.requests.length, 1, 'only one attempt was made');
  await s3.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the self-check writes, reads back, lists and deletes a probe file', async () => {
  const s3 = await startFakeS3();
  const r2 = createR2({ endpoint: s3.url, accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-key-example', bucket: s3.bucket });
  const out = await r2.check();
  assert.equal(out.ok, true, JSON.stringify(out.steps));
  assert.deepEqual(out.steps.map((s) => s.name), ['List bucket', 'Write object', 'Read object back', 'Delete object']);
  assert.equal(s3.objects.size, 0, 'the probe file was cleaned up');
  await s3.stop();
});

test('listing a prefix reports keys and sizes', async () => {
  const s3 = await startFakeS3();
  const r2 = createR2({ endpoint: s3.url, accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-key-example', bucket: s3.bucket });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-r2-'));
  const a = path.join(dir, 'a.txt'); fs.writeFileSync(a, 'aaa');
  const b = path.join(dir, 'b.txt'); fs.writeFileSync(b, 'bbbb');
  await r2.putFile('premium/ep1/a.txt', a);
  await r2.putFile('premium/ep1/b.txt', b);
  await r2.putFile('premium/other/c.txt', a);
  const listed = await r2.listAll('premium/ep1/');
  assert.deepEqual(listed.map((o) => o.key).sort(), ['premium/ep1/a.txt', 'premium/ep1/b.txt']);
  assert.deepEqual(listed.map((o) => o.size).sort(), [3, 4]);
  assert.equal(parseListXml('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>x&amp;y.m3u8</Key><Size>12</Size></Contents></ListBucketResult>').items[0].key, 'x&y.m3u8');
  await s3.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});
