/**
 * Backup & restore in pure Node — no mysqldump, tar or cloud SDK needed.
 *
 * A backup is one gzipped NDJSON file: a header line, then one line per table row and one per uploaded file
 * (admin-uploaded images and subtitles, base64). Optionally encrypted with AES-256-GCM (passphrase → scrypt key), because the
 * file contains customers' emails and password hashes.
 *
 *   {"t":"meta","format":1,"createdAt":…,"migrations":[…],"tables":{"users":123,…}}
 *   {"t":"row","table":"users","row":{…}}      … many …
 *   {"t":"file","path":"uploads/ab12.webp","b64":"…"}
 *   {"t":"end","rows":N,"files":M}              ← a backup without this line is truncated and is refused
 *
 * What is NOT in it: video objects stored in R2 (enable bucket versioning there), the JWT secret and other env vars.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, PassThrough } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import mysql from 'mysql2/promise';
import { dbConfigFromEnv } from './config.js';
import { createR2 } from './r2.js';

// Marker at the start of an encrypted backup file so restore knows to ask for the passphrase.
const MAGIC = Buffer.from('ABBK1');
// `schema_migrations` is not copied: the restore target must already have its own migrations applied.
const SKIP = new Set(['schema_migrations']);
/** Async line iterator over a stream (errors on the stream surface as exceptions from the for-await). */
// Reads a stream and yields one text line at a time (each line is one JSON record).
export async function* lines(stream) {
  let rest = '';
  // A chunk can end in the middle of a multi-byte character (gunzip emits fixed-size blocks), so the
  // bytes are decoded through one StringDecoder that carries the partial character over to the next
  // chunk. Decoding each chunk on its own would turn such a character into U+FFFD and quietly corrupt
  // the restored row (only for some titles, depending on where the boundaries fall).
  const decoder = new StringDecoder('utf8');
  try {
    for await (const chunk of stream) {
      rest += decoder.write(chunk);
      let i;
      while ((i = rest.indexOf('\n')) >= 0) { yield rest.slice(0, i); rest = rest.slice(i + 1); }
    }
    rest += decoder.end();
  } catch (e) { throw e instanceof SyntaxError ? e : new Error(stream.friendly || e.message); }
  if (rest) yield rest;
}
// Quotes a table name for SQL (table names come from the database itself, never from users).
const q = (id) => `\`${String(id).replace(/`/g, '')}\``;
// Rows inserted per statement when restoring.
const BATCH = 500;
// Tables whose rows carry large binary values (uploaded images) are paged in small steps, so a page never needs hundreds of megabytes ...
const PAGE_ROWS = { uploaded_files: 20 };
// ... and a restore INSERT is also cut once its binary values add up to about this much, to stay well under MySQL's max_allowed_packet.
const BATCH_BYTES = 4 * 1024 * 1024;
const binaryChars = (row) => Object.values(row).reduce((n, v) => n + (v && typeof v === 'object' && typeof v.$b64 === 'string' ? v.$b64.length : 0), 0);

// JSON cannot hold binary or JSON columns natively: Buffers are wrapped as { $b64 } and decoded again on restore.
const encodeValue = (v) => (Buffer.isBuffer(v) ? { $b64: v.toString('base64') } : v);
const decodeValue = (v) => (v && typeof v === 'object' && !Array.isArray(v) && '$b64' in v && Object.keys(v).length === 1 ? Buffer.from(v.$b64, 'base64')
  : v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) ? JSON.stringify(v) : v);   // JSON columns come back parsed; write them back as text

// One dedicated connection (not the app's pool): a backup needs a consistent snapshot on a single connection.
function connect(config = dbConfigFromEnv()) {
  return mysql.createConnection({ ...config, timezone: 'Z', charset: 'utf8mb4', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
}
// Lists every uploaded file so images and subtitles are included in the backup.
async function listUploads(dir) {
  const out = [];
  const walk = async (d) => { for (const e of await fs.promises.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.isFile() && !e.name.startsWith('.')) out.push(p); } };
  await walk(dir); return out;
}
// Turns the passphrase into an AES key with scrypt (slow on purpose, to resist guessing).
const deriveKey = (pass, salt) => crypto.scryptSync(pass, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

/** Writes a backup to `file` (a .ndjson.gz, or .ndjson.gz.enc when a passphrase is given). Returns a summary. */
export async function createBackup({ file, config, uploadDir, passphrase = '', now = new Date() }) {
  const conn = await connect(config);
  try {
    // Read all tables inside one repeatable-read transaction so the backup is consistent even while the site is live.
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ'); await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');   // one consistent point in time
    const [trows] = await conn.query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
    const tables = trows.map((r) => Object.values(r)[0]).filter((t) => !SKIP.has(t)).sort();
    const migrations = (await conn.query('SELECT version FROM schema_migrations ORDER BY version').then(([r]) => r.map((x) => x.version)).catch(() => []));
    const counts = {}; for (const t of tables) counts[t] = Number((await conn.query(`SELECT COUNT(*) AS n FROM ${q(t)}`))[0][0].n);

    // Pipeline: JSON lines -> gzip -> (optional AES-GCM encryption) -> file. It is written to `<file>.part` and renamed when complete, so a crash never leaves a half backup under the real name.
    const gz = zlib.createGzip({ level: 6 });
    const chunks = new PassThrough();
    const line = (o) => chunks.write(JSON.stringify(o) + '\n');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.part';
    let sink = fs.createWriteStream(tmp), salt, iv, cipher;
    const writing = (async () => {
      if (passphrase) {
        salt = crypto.randomBytes(16); iv = crypto.randomBytes(12); cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
        sink.write(Buffer.concat([MAGIC, salt, iv]));
        await pipeline(chunks, gz, cipher, sink, { end: false });
        sink.end(cipher.getAuthTag()); await new Promise((r) => sink.on('finish', r));
      } else await pipeline(chunks, gz, sink);
    })();

    // Write order: meta line, every table's rows, uploaded files, then the `end` line with totals (used to detect truncation).
    let rows = 0, files = 0;
    line({ t: 'meta', format: 1, createdAt: now.toISOString(), migrations, tables: counts });
    for (const t of tables) {
      let last = 0;
      // stream in pages by LIMIT/OFFSET on the snapshot — simple, and tables here are small
      const size = PAGE_ROWS[t] || 2000;
      for (;;) {
        const [page] = await conn.query(`SELECT * FROM ${q(t)} LIMIT ? OFFSET ?`, [size, last]);
        if (!page.length) break;
        for (const r of page) { line({ t: 'row', table: t, row: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, encodeValue(v)])) }); rows++; }
        last += page.length; if (page.length < size) break;
        if (chunks.writableNeedDrain) await new Promise((r) => chunks.once('drain', r));
      }
    }
    await conn.query('COMMIT');
    if (uploadDir) for (const p of await listUploads(uploadDir)) { line({ t: 'file', path: 'uploads/' + path.relative(uploadDir, p).split(path.sep).join('/'), b64: (await fs.promises.readFile(p)).toString('base64') }); files++; }
    line({ t: 'end', rows, files });
    chunks.end(); await writing;
    fs.renameSync(tmp, file);
    return { file, bytes: fs.statSync(file).size, tables: tables.length, rows, files, encrypted: !!passphrase };
  } finally { await conn.end().catch(() => {}); }
}

// Opens a backup for reading, decrypting if needed. Errors (wrong passphrase, damaged file) are turned into friendly messages.
async function openBackup(file, passphrase) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, head = Buffer.alloc(MAGIC.length); fs.readSync(fd, head, 0, MAGIC.length, 0);
  const encrypted = head.equals(MAGIC), gz = zlib.createGunzip();
  if (!encrypted) {
    fs.closeSync(fd); gz.friendly = 'This backup file is damaged or not a backup.';
    const src = fs.createReadStream(file); src.on('error', (e) => gz.destroy(e)); src.pipe(gz); return gz;
  }
  if (!passphrase) { fs.closeSync(fd); throw new Error('This backup is encrypted — set BACKUP_PASSPHRASE.'); }
  const hdr = Buffer.alloc(MAGIC.length + 28); fs.readSync(fd, hdr, 0, hdr.length, 0);
  const tag = Buffer.alloc(16); fs.readSync(fd, tag, 0, 16, size - 16); fs.closeSync(fd);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, hdr.subarray(5, 21)), hdr.subarray(21, 33)); decipher.setAuthTag(tag);
  const src = fs.createReadStream(file, { start: hdr.length, end: size - 17 });
  gz.friendly = 'Wrong passphrase, or the backup is damaged.';
  src.on('error', (e) => gz.destroy(e)); decipher.on('error', (e) => gz.destroy(e));
  src.pipe(decipher).pipe(gz); return gz;
}

/** Reads and validates a whole backup (without touching the database). Throws if truncated, corrupt or wrongly encrypted. */
// Used by `npm run restore -- <file> --check`.
export async function inspectBackup(file, passphrase = '') {
  const rl = lines(await openBackup(file, passphrase));
  let meta = null, end = null, rows = 0, files = 0;
  for await (const l of rl) { if (!l) continue; const o = JSON.parse(l); if (o.t === 'meta') meta = o; else if (o.t === 'row') rows++; else if (o.t === 'file') files++; else if (o.t === 'end') end = o; }
  if (!meta || !end) throw new Error('This backup is incomplete (no end marker) — it was probably cut short.');
  if (end.rows !== rows || end.files !== files) throw new Error('This backup is damaged (row counts differ).');
  return { ...meta, rows, files };
}

/**
 * Replaces the database content and uploaded files with the backup. The target database must already be migrated to at least the
 * backup's schema version (run `npm run db:migrate` first — the CLI does). DESTRUCTIVE: every table in the backup is emptied first.
 */
export async function restoreBackup({ file, config, uploadDir, passphrase = '', log = () => {} }) {
  const info = await inspectBackup(file, passphrase);                       // validate before deleting anything
  const conn = await connect(config);
  try {
    const applied = new Set((await conn.query('SELECT version FROM schema_migrations').then(([r]) => r.map((x) => x.version)).catch(() => [])));
    // Refuse to restore into a database whose schema is older than the backup's.
    const missing = info.migrations.filter((m) => !applied.has(m));
    if (missing.length) throw new Error(`The database schema is older than the backup (missing ${missing.join(', ')}). Run: npm run db:migrate`);
    const [trows] = await conn.query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
    const have = new Set(trows.map((r) => Object.values(r)[0]));
    const cols = new Map();
    // Everything is restored in one transaction, with foreign-key checks off while tables are refilled; any error rolls the whole restore back.
    await conn.query('SET FOREIGN_KEY_CHECKS = 0'); await conn.query('START TRANSACTION');
    try {
      for (const t of Object.keys(info.tables)) { if (!have.has(t)) throw new Error(`Table ${t} doesn't exist in the target database.`); await conn.query(`DELETE FROM ${q(t)}`); cols.set(t, new Set((await conn.query(`SHOW COLUMNS FROM ${q(t)}`))[0].map((c) => c.Field))); }
      const buf = new Map(); let rows = 0, files = 0;
      const flush = async (t) => { const b = buf.get(t); if (!b?.rows.length) return; await conn.query(`INSERT INTO ${q(t)} (${b.keys.map(q).join(',')}) VALUES ?`, [b.rows]); rows += b.rows.length; b.rows = []; b.bytes = 0; };
      const pending = [];
      const rl = lines(await openBackup(file, passphrase));
      for await (const l of rl) {
        if (!l) continue; const o = JSON.parse(l);
        if (o.t === 'row') {
          const known = cols.get(o.table), keys = Object.keys(o.row).filter((k) => known.has(k));
          let b = buf.get(o.table); if (!b) { b = { keys, rows: [], bytes: 0 }; buf.set(o.table, b); }
          b.rows.push(b.keys.map((k) => decodeValue(o.row[k]))); b.bytes += binaryChars(o.row); if (b.rows.length >= BATCH || b.bytes >= BATCH_BYTES) await flush(o.table);
        } else if (o.t === 'file') pending.push(o);
        if (pending.length && pending.length % 50 === 0) log(`${pending.length} files read…`);
      }
      for (const t of buf.keys()) await flush(t);
      await conn.query('COMMIT');
      if (uploadDir) for (const f of pending) {
        // Restore uploaded files, refusing any path that would escape the uploads folder.
        const rel = f.path.replace(/^uploads\//, ''); const dest = path.resolve(uploadDir, rel);
        if (rel.includes('..') || !dest.startsWith(path.resolve(uploadDir) + path.sep)) continue;               // never write outside the upload folder
        fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.from(f.b64, 'base64')); files++;
      }
      return { rows, files, tables: Object.keys(info.tables).length, createdAt: info.createdAt };
    } catch (e) { await conn.query('ROLLBACK').catch(() => {}); throw e; }
    finally { await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {}); }
  } finally { await conn.end().catch(() => {}); }
}

/** Deletes all but the newest `keep` local backups in `dir`. */
// Retention: keep the newest N backups.
export function pruneBackups(dir, keep = 14) {
  const all = fs.readdirSync(dir).filter((f) => /^addabaaz-\d{8}T\d{6}Z\.ndjson\.gz(\.enc)?$/.test(f)).sort().reverse();
  for (const f of all.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
  return all.slice(keep);
}
// File name like addabaaz-20260929T101500Z.ndjson.gz (`.enc` appended when encrypted).
export const backupName = (now = new Date(), encrypted = false) => `addabaaz-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}.ndjson.gz${encrypted ? '.enc' : ''}`;

/** Uploads a finished backup to a *separate* R2 bucket (BACKUP_R2_BUCKET; credentials fall back to the R2_* ones). Returns the key, or null when not configured. */
export async function uploadBackup(file, env = process.env, fetchImpl = fetch) {
  if (!env.BACKUP_R2_BUCKET) return null;
  const r2 = createR2({ R2_ACCOUNT_ID: env.BACKUP_R2_ACCOUNT_ID || env.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: env.BACKUP_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: env.BACKUP_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY, R2_BUCKET: env.BACKUP_R2_BUCKET, R2_ENDPOINT: env.BACKUP_R2_ENDPOINT || env.R2_ENDPOINT });
  if (!r2.configured) throw new Error('BACKUP_R2_BUCKET is set but the R2 credentials are incomplete.');
  const key = `backups/${path.basename(file)}`;
  const res = await fetchImpl(r2.presignPut(key, { ttl: 900 }), { method: 'PUT', body: fs.readFileSync(file), headers: { 'Content-Type': 'application/octet-stream' } });
  if (!res.ok) throw new Error(`R2 upload failed (${res.status})`);
  return key;
}
