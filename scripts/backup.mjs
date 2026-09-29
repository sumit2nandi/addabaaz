#!/usr/bin/env node
/* npm run backup                      → BACKUP_DIR (default ./backups)/addabaaz-<UTC time>.ndjson.gz[.enc]
 * Env: BACKUP_DIR, BACKUP_PASSPHRASE (encrypts the file — strongly recommended), BACKUP_KEEP (default 14),
 *      BACKUP_R2_BUCKET (+ BACKUP_R2_* credentials) to also copy it to a separate R2 bucket, UPLOAD_DIR, DB_* / DATABASE_URL. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup, pruneBackups, backupName, uploadBackup } from '../server/src/backup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups')), pass = process.env.BACKUP_PASSPHRASE || '';
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(root, 'uploads'));
try {
  if (!pass) console.warn('⚠ BACKUP_PASSPHRASE is not set — the backup will contain customer emails and password hashes unencrypted.');
  const now = new Date(), file = path.join(dir, backupName(now, !!pass));
  const r = await createBackup({ file, uploadDir, passphrase: pass, now });
  console.log(`✔ ${r.file}\n  ${r.tables} tables, ${r.rows} rows, ${r.files} uploaded files, ${(r.bytes / 1048576).toFixed(2)} MB${r.encrypted ? ', encrypted' : ''}`);
  const key = await uploadBackup(r.file).catch((e) => { console.error('✖ R2 copy failed:', e.message); process.exitCode = 1; return null; });
  if (key) console.log(`✔ copied to R2: ${key}`);
  const gone = pruneBackups(dir, Number(process.env.BACKUP_KEEP) || 14); if (gone.length) console.log(`  removed ${gone.length} old backup(s)`);
} catch (e) { console.error('✖ Backup failed:', e.message); process.exit(1); }
