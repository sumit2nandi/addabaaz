#!/usr/bin/env node
/* npm run restore -- <backup file> [--force] [--check]
 *   --check   only verify the file (decrypt, checksum row counts) — changes nothing
 *   --force   required to actually REPLACE the database content and uploaded files
 * Env: BACKUP_PASSPHRASE (if encrypted), UPLOAD_DIR, DB_* / DATABASE_URL. The schema is migrated first. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../server/src/db.js';
import { migrate } from '../server/src/migrate.js';
import { dbConfigFromEnv } from '../server/src/config.js';
import { inspectBackup, restoreBackup } from '../server/src/backup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error('Usage: restore.mjs <backup file> [--check | --force]'); process.exit(2); }
const pass = process.env.BACKUP_PASSPHRASE || '';
try {
  const info = await inspectBackup(file, pass);
  console.log(`Backup from ${info.createdAt}: ${Object.keys(info.tables).length} tables, ${info.rows} rows, ${info.files} files — intact.`);
  if (flags.includes('--check')) process.exit(0);
  if (!flags.includes('--force')) { console.error('This REPLACES the database content and uploads with the backup. Re-run with --force (or --check to only verify).'); process.exit(1); }
  const config = dbConfigFromEnv(), db = await createDb({ config, ensureDatabase: true });
  await migrate(db); await db.close();
  const r = await restoreBackup({ file, config, uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(root, 'uploads')), passphrase: pass, log: console.log });
  console.log(`✔ restored ${r.rows} rows in ${r.tables} tables and ${r.files} files (backup taken ${r.createdAt}). Restart the server so caches are cleared.`);
} catch (e) { console.error('✖', e.message); process.exit(1); }
