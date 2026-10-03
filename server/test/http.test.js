import test from 'node:test';
import assert from 'node:assert/strict';
import { safeErrorUrl } from '../src/http.js';

test('error-log URLs discard query and fragment secrets and redact HLS bearer tokens', () => {
  assert.equal(safeErrorUrl('/api/v1/auth/reset?token=secret#ignored'), '/api/v1/auth/reset');
  assert.equal(safeErrorUrl('https://user:password@example.test/api/v1/auth/reset?token=secret'), '/api/v1/auth/reset');
  assert.equal(safeErrorUrl('/api/v1/media/eyJhbGciOiJIUzI1NiJ9.abc.sig/playlist.m3u8?part=1'), '/api/v1/media/[redacted]/playlist.m3u8');
  assert.equal(safeErrorUrl(null), '');
  assert.equal(safeErrorUrl('/' + 'x'.repeat(400)).length, 300);
});
