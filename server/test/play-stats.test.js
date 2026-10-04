// Database-backed play-count helpers that do not require a running MySQL instance.
// Run: node --test server/test/play-stats.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { extraDb } from '../src/db-extra.js';

test('all-time per-video view counts sum the persisted daily play aggregates', async () => {
  const queries = [];
  const rows = [
    { video_id: 'episode-1', plays: '12' },
    { video_id: 'reel-1', plays: 4 },
  ];
  const db = extraDb({
    q: async (sql, params = []) => { queries.push({ sql, params }); return rows; },
    tx: async (fn) => fn({ query: async () => ({ affectedRows: 1 }) }),
    iso: (date) => date?.toISOString?.() || null,
  });

  assert.deepEqual(await db.playStats.allTimeCounts(), { 'episode-1': 12, 'reel-1': 4 });
  assert.match(queries[0].sql, /SELECT video_id, SUM\(plays\) AS plays FROM play_stats GROUP BY video_id/);
  assert.deepEqual(queries[0].params, []);
});
