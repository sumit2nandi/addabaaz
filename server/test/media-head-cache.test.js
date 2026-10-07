import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaHeadCache } from '../src/media-head-cache.js';

test('successful R2 checks coalesce and expire without caching other keys', async () => {
  let calls = 0, time = 0;
  const check = mediaHeadCache(async () => { calls++; return { status: 200 }; }, { now: () => time, ttl: 30 });
  await Promise.all([check('a'), check('a')]);
  assert.equal(calls, 1);
  await check('a'); assert.equal(calls, 1);
  await check('b'); assert.equal(calls, 2);
  time = 31;
  await check('a'); assert.equal(calls, 3);
});

test('missing files and storage failures are not cached', async () => {
  for (const status of [404, 403, 500]) {
    let calls = 0;
    const check = mediaHeadCache(async () => { calls++; return { status }; });
    await check('a'); await check('a'); assert.equal(calls, 2);
  }
  let calls = 0;
  const check = mediaHeadCache(async () => { calls++; throw new Error('offline'); });
  await assert.rejects(check('a')); await assert.rejects(check('a'));
  assert.equal(calls, 2);
});

test('object cache has a bounded number of keys', async () => {
  let calls = 0;
  const check = mediaHeadCache(async () => { calls++; return { status: 200 }; }, { max: 2 });
  await check('a'); await check('b'); await check('c'); await check('a');
  assert.equal(calls, 4);
});
