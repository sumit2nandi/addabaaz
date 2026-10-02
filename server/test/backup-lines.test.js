// The backup dump (JSON lines) is read back through a stream, and a chunk boundary may fall INSIDE a
// multi-byte character — a Bengali title, an emoji, curly quotes. Decoding each chunk on its own turns
// that character into U+FFFD, so a restore silently corrupts the row; whether it happens depends on the
// byte offsets, i.e. on the data, which is why it shows up as a mysterious diff after an unrelated change.
// No database needed.
// Run: node --test server/test/backup-lines.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { lines } from '../src/backup.js';

const collect = async (chunks) => { const out = []; for await (const line of lines(Readable.from(chunks))) out.push(line); return out; };

test('lines survive a chunk boundary that cuts a multi-byte character', async () => {
  for (const title of ['শহীদ | Part - 18', 'দারুণ! 🎉 emoji and “quotes”', 'ハロー・ワールド', 'Ünïcödé — ok']) {
    const json = JSON.stringify({ title, body: `${title} ${title}` });
    const text = `${json}\n{"n":1}\n`;
    const buf = Buffer.from(text, 'utf8');
    for (let cut = 1; cut < buf.length; cut++) {
      assert.deepEqual(await collect([buf.subarray(0, cut), buf.subarray(cut)]), [json, '{"n":1}'], `split at byte ${cut} of ${buf.length}`);
    }
    // One byte at a time is the worst case: every multi-byte character is cut.
    assert.deepEqual(await collect([...buf].map((b) => Buffer.from([b]))), [json, '{"n":1}']);
    // A file whose last line has no newline must still be yielded.
    assert.deepEqual(await collect([Buffer.from(json, 'utf8')]), [json]);
  }
});

test('a damaged stream is reported instead of silently becoming text', async () => {
  // A passphrase-protected file that is not one: the stream error must surface (not be swallowed).
  const boom = { friendly: 'Wrong passphrase or damaged file', async *[Symbol.asyncIterator]() { throw new Error('bad decrypt'); } };
  await assert.rejects(async () => { for await (const _ of lines(boom)) break; }, /Wrong passphrase or damaged file/);
});
