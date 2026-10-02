// Backup / restore round-trip tests, cross-device resume, and the HLS encoder helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { dbConfigFromEnv } from '../src/config.js';
import { createBackup, restoreBackup, inspectBackup, pruneBackups, backupName, uploadBackup } from '../src/backup.js';

// Database for the tests: TEST_DATABASE_URL or a local MySQL. Each file creates its own throw-away database (unique name) and drops it at the end, so tests never touch real data.
const cfg0 = dbConfigFromEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/x' });
const config = { ...cfg0, database: `addabaaz_bak_${process.pid}_${Date.now().toString(36)}` };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-bak-')), uploads = path.join(tmp, 'uploads'), uploads2 = path.join(tmp, 'uploads2');
// Shared state for the tests in this file (database, HTTP server, base URL).
let db, server, base;
// Runs once before the tests: create + migrate the database and start the app on a random free port.
test.before(async () => {
  db = await createDb({ config, ensureDatabase: true }); await migrate(db);
  fs.mkdirSync(path.join(uploads, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'a.bin'), Buffer.from([0, 1, 2, 250, 251, 252, 255])); fs.writeFileSync(path.join(uploads, 'sub', 'b.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nহ্যালো\n');
  const app = createApp({ db, jwtSecret: 'test-secret', rate: false, uploadDir: uploads });
  server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
// Clean up: stop the server and drop the temporary database.
test.after(async () => { server?.close(); if (db) { await db.dropDatabase(); await db.close(); } fs.rmSync(tmp, { recursive: true, force: true }); });
// Tiny HTTP client: calls the running app's API and returns `{ status, body }`; pass a token to act as a signed-in user.
const call = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null };
};

test('watch progress follows the account across two devices (resume anywhere)', async () => {
  const s = await call('POST', '/auth/signup', { name: 'Two Devices', email: 'two@example.com', password: 'password123' });
  const phone = s.body.token, pid = s.body.profiles[0].id;
  const tv = (await call('POST', '/auth/login', { email: 'two@example.com', password: 'password123' })).body.token;   // a second, independent session
  const vid = (await call('GET', '/catalog')).body.videos.find((v) => v.kind === 'episode');
  assert.equal((await call('PUT', `/profiles/${pid}/progress/${vid.id}`, { position: 321, duration: vid.duration || 900 }, phone)).status, 204);
  const seen = (await call('GET', `/profiles/${pid}/library`, null, tv)).body;
  assert.equal(seen.progress[vid.id].position, 321, 'the TV resumes where the phone stopped');
  await call('PUT', `/profiles/${pid}/progress/${vid.id}`, { position: 500, duration: vid.duration || 900 }, tv);
  assert.equal((await call('GET', `/profiles/${pid}/library`, null, phone)).body.progress[vid.id].position, 500, 'and the phone picks up from the TV');
});

async function counts() {
  const [rows] = await db.pool.query('SHOW TABLES'); const out = {};
  for (const r of rows) { const t = Object.values(r)[0]; if (t === 'schema_migrations') continue; out[t] = Number((await db.pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``))[0][0].n); }
  return out;
}

test('backup → wipe → restore round-trips every table and uploaded file (encrypted)', async () => {
  const s = await call('POST', '/auth/signup', { name: 'Round Trip', email: 'rt@example.com', password: 'password123' });
  await db.pool.query("INSERT INTO comments (id, video_id, user_id, author, body) VALUES ('c1','v1',?, 'Round', 'দারুণ! 🎉 emoji and “quotes”')", [s.body.user.id]);
  await db.pool.query("INSERT INTO error_log (source, message) VALUES ('client', 'boom')");
  // Uploaded images live in MySQL too (the upload folder is only a cache): big binary rows must survive the round trip. Three ~1.5 MB
  // images make the restore cut its INSERT by size (it flushes once the binary values add up to about 4 MB).
  const blobs = [0, 1, 2].map((i) => ({ name: `${String(i + 1).repeat(24)}.png`, data: crypto.randomBytes(1_500_000 + i) }));
  for (const b of blobs) await db.uploads.put(b.name, 'image/png', b.data);
  const before = await counts(); assert.ok(before.users >= 2 && before.catalog_items > 0, 'there is data to lose'); assert.equal(before.uploaded_files, 3);
  const usersBefore = (await db.pool.query('SELECT id, email, password_hash, created_at FROM users ORDER BY id'))[0];
  const catBefore = (await db.pool.query('SELECT * FROM catalog_items ORDER BY 1,2'))[0];

  const file = path.join(tmp, 'out', backupName(new Date(), true));
  const r = await createBackup({ file, config, uploadDir: uploads, passphrase: 'correct horse battery staple' });
  assert.equal(r.files, 2); assert.ok(r.rows > 10); assert.ok(r.encrypted);
  assert.ok(!fs.readFileSync(file).includes('rt@example.com'), 'ciphertext contains no plain text');
  const info = await inspectBackup(file, 'correct horse battery staple'); assert.equal(info.rows, r.rows);
  await assert.rejects(inspectBackup(file, 'wrong'), /Wrong passphrase|damaged/);
  await assert.rejects(inspectBackup(file, ''), /encrypted/);

  // disaster
  await db.pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of Object.keys(before)) await db.pool.query(`DELETE FROM \`${t}\``);
  await db.pool.query('SET FOREIGN_KEY_CHECKS = 1');
  assert.equal((await counts()).users, 0);

  const res = await restoreBackup({ file, config, uploadDir: uploads2, passphrase: 'correct horse battery staple' });
  assert.equal(res.rows, r.rows); assert.equal(res.files, 2);
  assert.deepEqual(await counts(), before, 'row counts match table by table');
  assert.deepEqual((await db.pool.query('SELECT id, email, password_hash, created_at FROM users ORDER BY id'))[0], usersBefore, 'users incl. password hashes and timestamps are identical');
  assert.deepEqual((await db.pool.query('SELECT * FROM catalog_items ORDER BY 1,2'))[0], catBefore, 'catalog (JSON columns) is identical');
  assert.equal((await db.pool.query("SELECT body FROM comments WHERE id = 'c1'"))[0][0].body, 'দারুণ! 🎉 emoji and “quotes”', 'unicode survives');
  for (const b of blobs) {
    const back = await db.uploads.get(b.name);
    assert.equal(back.type, 'image/png'); assert.deepEqual(back.data, b.data, 'images stored in MySQL are byte-identical after the restore');
  }
  assert.deepEqual(fs.readFileSync(path.join(uploads2, 'a.bin')), Buffer.from([0, 1, 2, 250, 251, 252, 255]), 'binary uploads are byte-identical');
  assert.match(fs.readFileSync(path.join(uploads2, 'sub', 'b.vtt'), 'utf8'), /হ্যালো/);
  // and the restored accounts can sign in
  assert.equal((await call('POST', '/auth/login', { email: 'rt@example.com', password: 'password123' })).status, 200);
  assert.equal((await call('POST', '/auth/login', { email: 'two@example.com', password: 'password123' })).status, 200);
});

test('a truncated or tampered backup is refused before anything is deleted', async () => {
  const file = path.join(tmp, 'plain.ndjson.gz'); await createBackup({ file, config, uploadDir: uploads });
  const users = (await counts()).users;
  const bytes = fs.readFileSync(file); const cut = path.join(tmp, 'cut.ndjson.gz');
  fs.writeFileSync(cut, zlib.gzipSync(zlib.gunzipSync(bytes).toString('utf8').split('\n').slice(0, -2).join('\n') + '\n'));   // end marker missing
  await assert.rejects(restoreBackup({ file: cut, config, uploadDir: uploads2 }), /incomplete/);
  const bad = path.join(tmp, 'bad.ndjson.gz'); fs.writeFileSync(bad, bytes.subarray(0, Math.floor(bytes.length / 2)));
  await assert.rejects(restoreBackup({ file: bad, config, uploadDir: uploads2 }));
  assert.equal((await counts()).users, users, 'database untouched');
  // path traversal inside a hostile backup is ignored
  const lines = zlib.gunzipSync(bytes).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  const end = lines.pop(); lines.push({ t: 'file', path: 'uploads/../../evil.txt', b64: Buffer.from('x').toString('base64') }); end.files += 1; lines.push(end);
  const evil = path.join(tmp, 'evil.ndjson.gz'); fs.writeFileSync(evil, zlib.gzipSync(lines.map((l) => JSON.stringify(l)).join('\n') + '\n'));
  await restoreBackup({ file: evil, config, uploadDir: uploads2 });
  assert.ok(!fs.existsSync(path.join(tmp, 'evil.txt')));
});

test('an older schema is refused, retention keeps the newest N, and the R2 copy is a signed PUT', async () => {
  const file = path.join(tmp, 'schema.ndjson.gz'); await createBackup({ file, config });
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').trim().split('\n').map((l) => JSON.parse(l)); lines[0].migrations.push('999_future.sql');
  fs.writeFileSync(file, zlib.gzipSync(lines.map((l) => JSON.stringify(l)).join('\n') + '\n'));
  await assert.rejects(restoreBackup({ file, config }), /schema is older/);
  const dir = path.join(tmp, 'keep'); fs.mkdirSync(dir);
  for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(dir, backupName(new Date(Date.UTC(2026, 0, i)))), 'x');
  assert.equal(pruneBackups(dir, 2).length, 3); assert.equal(fs.readdirSync(dir).length, 2);
  assert.equal(await uploadBackup(file, {}), null, 'no bucket → skipped');
  let put; const env = { BACKUP_R2_BUCKET: 'bk', R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK' };
  const key = await uploadBackup(file, env, async (url, init) => { put = { url, init }; return { ok: true, status: 200 }; });
  assert.match(key, /^backups\/schema\.ndjson\.gz$/); assert.match(put.url, /^https:\/\/acc\.r2\.cloudflarestorage\.com\/bk\/backups\/schema\.ndjson\.gz\?.*X-Amz-Signature=/); assert.equal(put.init.method, 'PUT');
});

import { pickLadder, ffmpegArgs, probeInfo, LADDER } from '../src/hls.js';
test('HLS encoder helpers: never upscale, aligned keyframes, one output per rung', () => {
  assert.deepEqual(pickLadder(1080).map((r) => r.name), ['1080p', '720p', '480p', '360p']);
  assert.deepEqual(pickLadder(1072).map((r) => r.name), ['1080p', '720p', '480p', '360p'], '1072-tall "1080p" sources count as 1080p');
  assert.deepEqual(pickLadder(720).map((r) => r.name), ['720p', '480p', '360p']);
  assert.deepEqual(pickLadder(240).map((r) => r.name), ['360p'], 'always at least one rung');
  assert.deepEqual(pickLadder(2160, { max: 720 }).map((r) => r.name), ['720p', '480p', '360p']);
  const a = ffmpegArgs({ input: 'in.mov', outDir: 'out', ladder: pickLadder(720), fps: 25 });
  const s = a.join(' ');
  assert.match(s, /split=3\[s0\]\[s1\]\[s2\]/); assert.match(s, /-g 150 -keyint_min 150 -sc_threshold 0/, '25fps × 6s = 150-frame GOP on every rung');
  assert.match(s, /-var_stream_map v:0,a:0,name:720p v:1,a:1,name:480p v:2,a:2,name:360p out\/%v\/index\.m3u8$/);
  assert.match(ffmpegArgs({ input: 'in.mov', outDir: 'out', ladder: [LADDER[3]], hasAudio: false }).join(' '), /-var_stream_map v:0,name:360p/);
  const p = probeInfo({ streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001' }, { codec_type: 'audio' }], format: { duration: '61.5' } });
  assert.deepEqual(p, { width: 1920, height: 1080, fps: 30, hasAudio: true, duration: 61.5 });
  assert.throws(() => probeInfo({ streams: [{ codec_type: 'audio' }] }), /No video stream/);
});
