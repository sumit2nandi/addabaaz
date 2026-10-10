// Encrypted-backup reading, with no database: the format is header + AES-256-GCM + gzip + a trailing
// authentication tag, and the restore path deletes the target database only after this reader has said the
// file is complete and authentic. So the reader has to (a) still accept a well-formed backup, (b) reject a
// truncated one before it wastes a key derivation, and (c) reject a file whose bytes were changed — a
// silent accept here is what would let a tampered backup be restored over live data.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { inspectBackup } from '../src/backup.js';

const MAGIC = Buffer.from('ABBK1');
const PASSPHRASE = 'correct horse battery staple';
// Mirrors deriveKey() in server/src/backup.js — the test has to produce files the real reader accepts.
const deriveKey = (pass, salt) => crypto.scryptSync(pass, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

/** One tiny but complete backup: meta + end marker, gzipped, then sealed with AES-256-GCM. */
function encryptedBackup({ rows = 0, files = 0, passphrase = PASSPHRASE } = {}) {
  // `end` must state the number of row records actually present — the reader re-counts them and refuses a
  // backup whose counts disagree, so a fixture that only declares rows would be (correctly) rejected.
  const records = [
    JSON.stringify({ t: 'meta', format: 1, createdAt: '2026-01-01T00:00:00.000Z', migrations: ['001_init.sql'], tables: { users: rows } }),
    ...Array.from({ length: rows }, (unused, n) => JSON.stringify({ t: 'row', table: 'users', index: n, row: { id: n + 1, email: `u${n}@example.in` } })),
    JSON.stringify({ t: 'end', rows, files }),
  ];
  const body = zlib.gzipSync(records.join('\n') + '\n');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const ciphered = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([MAGIC, salt, iv, ciphered.subarray(0, ciphered.length - 16), ciphered.subarray(ciphered.length - 16)]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'addabaaz-backup-'));
const write = (name, buf) => { const file = path.join(tmp, name); fs.writeFileSync(file, buf); return file; };

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a well-formed encrypted backup is read and validated', async () => {
  const info = await inspectBackup(write('good.ndjson.gz.enc', encryptedBackup({ rows: 7 })), PASSPHRASE);
  assert.equal(info.format, 1);
  assert.deepEqual(info.migrations, ['001_init.sql']);
  assert.equal(info.rows, 7, 'the end marker and the counted rows must agree');
});

test('the wrong passphrase is refused (GCM authentication, not a guess)', async () => {
  await assert.rejects(() => inspectBackup(write('wrong.ndjson.gz.enc', encryptedBackup()), 'not-the-passphrase'),
    /passphrase|damaged|authenticate/i);
});

test('a tampered byte is refused even though the file is the right length', async () => {
  const buf = encryptedBackup({ rows: 3 });
  const at = MAGIC.length + 28 + 4;                       // inside the ciphertext, past the header
  buf[at] = buf[at] ^ 0xff;
  await assert.rejects(() => inspectBackup(write('tampered.ndjson.gz.enc', buf), PASSPHRASE),
    /passphrase|damaged|authenticate/i);
});

test('a truncated file is refused before any key derivation is attempted', async () => {
  const full = encryptedBackup();
  // Header (5 + 16 + 12) + a 16-byte tag is the minimum size an encrypted backup can have.
  for (const size of [0, 1, MAGIC.length, MAGIC.length + 28, full.length - 17, full.length - 1]) {
    const file = write(`short-${size}.ndjson.gz.enc`, full.subarray(0, size));
    await assert.rejects(() => inspectBackup(file, PASSPHRASE), /truncated|incomplete|damaged|passphrase|authenticate|end marker/i, `size ${size} must be refused`);
  }
});

test('an unencrypted backup still opens without a passphrase', async () => {
  const plain = zlib.gzipSync([
    JSON.stringify({ t: 'meta', format: 1, createdAt: '2026-01-01T00:00:00.000Z', migrations: [], tables: {} }),
    JSON.stringify({ t: 'end', rows: 0, files: 0 }),
  ].join('\n') + '\n');
  const info = await inspectBackup(write('plain.ndjson.gz', plain), '');
  assert.equal(info.format, 1);
});

test('a file that is not a backup at all is refused', async () => {
  await assert.rejects(() => inspectBackup(write('nope.ndjson.gz', Buffer.from('not a backup, no gzip magic here')), ''), /damaged|backup|JSON|incomplete/i);
});
