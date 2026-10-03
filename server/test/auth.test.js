import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assertProductionSecret, DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../src/auth.js';

test('password hashes use asynchronous scrypt, unique salts, and reject malformed stored values', async () => {
  const a = await hashPassword('correct horse battery staple');
  const b = await hashPassword('correct horse battery staple');
  assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(a, b, 'random salts make identical passwords produce different hashes');
  assert.equal(await verifyPassword('correct horse battery staple', a), true);
  assert.equal(await verifyPassword('wrong password', a), false);
  assert.equal(await verifyPassword('anything', 'scrypt$00$00'), false);
  assert.equal(await verifyPassword('anything', DUMMY_PASSWORD_HASH), false);
});

test('production JWT secrets must be long and not an example placeholder', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  assert.equal(assertProductionSecret(secret), secret);
  assert.throws(() => assertProductionSecret('short'), /at least 32 bytes/);
  assert.throws(() => assertProductionSecret('change-me-to-a-long-random-string'), /unique, randomly generated/);
  assert.throws(() => assertProductionSecret(`${'x'.repeat(40)} `), /unique, randomly generated/);
});
