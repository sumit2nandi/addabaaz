import test from 'node:test';
import assert from 'node:assert/strict';
import { apiOrigin, loadContent } from '../shared/api-client.js';
import { publicPayload } from '../backend/src/content.js';
import { original } from './support/fixture.js';
test('API origins reject credentials, paths and executable schemes', () => {
  assert.equal(apiOrigin('https://api.example.com/'), 'https://api.example.com');
  for (const url of ['https://user:secret@api.example.com', 'https://api.example.com/path', 'javascript:alert(1)', 'https://api.example.com/?secret=bad']) assert.throws(() => apiOrigin(url));
});
test('web and native paths resolve against the configured API, with no credential headers', async () => {
  const saved = globalThis.fetch;
  try {
    for (const view of ['web', 'home']) {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, `https://api.example.com/api/v1/content?view=${view}`);
        assert.equal(options.cache, 'no-store'); assert.equal(options.headers, undefined);
        return new Response(JSON.stringify(publicPayload({ tables: original, revision: 5, updatedAt: '2026-09-22' }, view)));
      };
      const data = await loadContent({ baseUrl: 'https://api.example.com', view });
      assert.equal(data.revision, 5);
      if (view === 'web') assert.match(data.tables.Shows[0].image, /^https:\/\/api.example.com\/media\//);
      else assert.equal(data.runtime.UPCOMING_FOLDER, 'https://api.example.com/media/UpcomingReleases/');
    }
  } finally { globalThis.fetch = saved; }
});
test('invalid API versions and HTTP failures are explicit errors', async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"schemaVersion":2,"revision":1}');
    await assert.rejects(loadContent({ baseUrl: 'https://api.example.com' }), /unsupported response/);
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    await assert.rejects(loadContent({ baseUrl: 'https://api.example.com' }), /HTTP 503/);
  } finally { globalThis.fetch = saved; }
});
