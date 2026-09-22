// Destructive integration tests ONLY against a disposable *_test database.
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { databaseConfig } from '../src/config.js';
import { migrate } from '../scripts/migrate.js';
import { ContentRepository } from '../src/repository.js';
import { sections, sqlTable } from '../src/content.js';
import { original } from '../../tests/support/fixture.js';

test('MySQL 8: migration, persistence, order, revision conflicts and rollback', async () => {
  if (!process.env.DB_NAME?.endsWith('_test')) throw new Error('Refusing destructive integration tests: DB_NAME must end in _test.');
  const pool = mysql.createPool(databaseConfig());
  try {
    await migrate(pool);
    for (const name of [...sections].reverse()) await pool.query(`DELETE FROM ${sqlTable(name)}`);
    await pool.query('UPDATE content_meta SET revision = 0 WHERE id = 1');
    const repo = new ContentRepository(pool);
    await assert.rejects(repo.read(), /not initialized/);
    assert.equal(await repo.replace(original, 0), 1);
    assert.deepEqual((await new ContentRepository(pool).read()).tables, original);
    await migrate(pool); // Restart/migration must never reset existing content.
    assert.equal((await repo.read()).revision, 1);
    const changed = structuredClone(original); changed.Shows[0].title = 'SQL content বাংলা'; changed.Promos.reverse();
    await repo.replace(changed, 1);
    assert.deepEqual((await repo.read()).tables, changed);
    await assert.rejects(repo.replace(original, 1), /Content changed/);
    await pool.query("ALTER TABLE content_promos ADD CONSTRAINT test_rollback CHECK (title <> 'FORCE_FAILURE')");
    try {
      const broken = structuredClone(original); broken.Promos[0].title = 'FORCE_FAILURE';
      await assert.rejects(repo.replace(broken, 2));
      assert.equal((await repo.read()).revision, 2);
      assert.deepEqual((await repo.read()).tables, changed);
    } finally { await pool.query('ALTER TABLE content_promos DROP CHECK test_rollback'); }
    await repo.addInquiry({ name: 'Test', email: 'test@example.com', phone: '', message: 'A saved message' });
    assert.ok((await repo.inquiries()).length > 0);
  } finally { await pool.end(); }
});
