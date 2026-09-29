// Tiny SQL migration runner: applies the numbered files in server/migrations/ once each, in order.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Folder that holds the .sql migration files (relative to this file).
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/**
 * Applies server/migrations/NNN_name.sql files in order, once each (tracked in `schema_migrations`).
 * A MySQL advisory lock makes it safe when several app instances start at the same time.
 * Note: MySQL DDL is not transactional — keep each migration small and idempotent-friendly.
 */
export async function migrate(db, { dir = DIR, log = () => {} } = {}) {
  // A dedicated connection is needed because the advisory lock belongs to one connection.
  const conn = await db.pool.getConnection();
  try {
    // Wait up to 60 s for the lock so two servers starting together do not run the same migration twice.
    const [[lock]] = await conn.query("SELECT GET_LOCK('addabaaz_migrate', 60) AS ok");
    if (lock.ok !== 1) throw new Error('Could not obtain the migration lock');
    // Bookkeeping table: one row per migration file that has been applied.
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [rows] = await conn.query('SELECT version FROM schema_migrations');
    // Names of migrations already applied.
    const done = new Set(rows.map((r) => r.version));
    // Only files named like 001_something.sql; sorting gives the order to run them.
    const files = fs.readdirSync(dir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
    const applied = [];
    for (const f of files) {
      // Skip migrations that ran before.
      if (done.has(f)) continue;
      log(`applying ${f}`);
      // Strip `--` comment lines and split into single statements (the driver runs one statement per query).
      const statements = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\s*--.*$/gm, '').split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
      for (const s of statements) await conn.query(s);
      // Record success only after every statement in the file ran.
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [f]);
      applied.push(f);
    }
    // Let the next instance proceed.
    await conn.query("SELECT RELEASE_LOCK('addabaaz_migrate')");
    return applied;
  } finally { conn.release(); }
}
