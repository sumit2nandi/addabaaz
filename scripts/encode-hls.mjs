#!/usr/bin/env node
/* Turns a source video into an adaptive-bitrate HLS package and (optionally) uploads it to your private R2 bucket.
 *
 *   npm run encode:hls -- <input.mov|mp4> [--out ./hls/<name>] [--name shahid-ep6] [--max 1080] [--upload] [--ffmpeg /path/to/ffmpeg]
 *
 * Needs ffmpeg + ffprobe on the machine that runs it (not on the web server). --upload sends every file to
 * premium/<name>/ using the R2_* credentials (a write-capable token) and prints the key to paste into the admin form:
 *   source = Premium video in Cloudflare R2, key = premium/<name>/master.m3u8
 *
 * NOTE: this script has been unit-tested for its command building, but it has NOT been run against real ffmpeg or R2 in the
 * environment where it was written. Try it on a short clip first. See docs/PREMIUM.md. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { LADDER, pickLadder, ffmpegArgs, probeInfo, contentType } from '../server/src/hls.js';
import { createR2 } from '../server/src/r2.js';

// Command-line parsing: the first non-flag argument is the input file; `opt('name', default)` reads `--name value`.
const argv = process.argv.slice(2), input = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out' && argv[argv.indexOf(a) - 1] !== '--name' && argv[argv.indexOf(a) - 1] !== '--max' && argv[argv.indexOf(a) - 1] !== '--ffmpeg');
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
if (!input || !fs.existsSync(input)) { console.error('Usage: encode-hls.mjs <input video> [--out dir] [--name slug] [--max 1080] [--upload] [--ffmpeg path]'); process.exit(2); }
const ffmpeg = opt('ffmpeg', 'ffmpeg'), ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const name = (opt('name', path.basename(input, path.extname(input))) || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video';
const outDir = path.resolve(opt('out', path.join('hls', name)));

// Step 1: inspect the source with ffprobe (size, frame rate, audio) to choose which quality levels to produce.
const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) { console.error(`Could not run ${ffprobe}. Install ffmpeg (https://ffmpeg.org/download.html) or pass --ffmpeg /path/to/ffmpeg.\n${probe.stderr || probe.error?.message || ''}`); process.exit(1); }
const info = probeInfo(JSON.parse(probe.stdout)), ladder = pickLadder(info.height, { max: Number(opt('max', 1080)) });
console.log(`Source ${info.width}×${info.height} @${info.fps}fps${info.hasAudio ? '' : ' (no audio)'} → ${ladder.map((r) => r.name).join(', ')}`);
// Step 2: run ffmpeg once, producing every quality level plus master.m3u8 in the output folder.
fs.rmSync(outDir, { recursive: true, force: true });
for (const r of ladder) fs.mkdirSync(path.join(outDir, r.name), { recursive: true });
const code = await new Promise((res) => { const p = spawn(ffmpeg, ffmpegArgs({ input, outDir, ladder, fps: info.fps, hasAudio: info.hasAudio }), { stdio: ['ignore', 'inherit', 'inherit'] }); p.on('exit', res); p.on('error', () => res(127)); });
if (code !== 0) { console.error(`ffmpeg failed (exit ${code}).`); process.exit(1); }
if (!fs.existsSync(path.join(outDir, 'master.m3u8'))) { console.error('ffmpeg finished but master.m3u8 is missing.'); process.exit(1); }
console.log(`✔ HLS package in ${outDir}`);

// Step 3 (optional): upload every file to the private R2 bucket under premium/<name>/.
if (argv.includes('--upload')) {
  const r2 = createR2(); if (!r2.configured) { console.error('R2 is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) — files were not uploaded.'); process.exit(1); }
  const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } }; walk(outDir);
  // Upload playlists last so viewers never see a playlist that points at files not uploaded yet.
  files.sort((a, b) => (a.endsWith('.m3u8') ? 1 : 0) - (b.endsWith('.m3u8') ? 1 : 0));      // segments first, playlists last: nobody sees a playlist that points at missing files
  let n = 0;
  for (const f of files) {
    const key = `premium/${name}/${path.relative(outDir, f).split(path.sep).join('/')}`;
    const res = await fetch(r2.presignPut(key, { ttl: 900 }), { method: 'PUT', body: fs.readFileSync(f), headers: { 'Content-Type': contentType(f) } });
    if (!res.ok) { console.error(`✖ upload of ${key} failed (${res.status}). Does the token have write access?`); process.exit(1); }
    if (++n % 20 === 0) console.log(`  ${n}/${files.length} files…`);
  }
  console.log(`✔ uploaded ${files.length} files.\n  In the admin: Video source → Premium video in Cloudflare R2 → key  premium/${name}/master.m3u8`);
} else console.log(`Next: upload the folder to R2 under premium/${name}/ (or re-run with --upload) and use  premium/${name}/master.m3u8  as the key.`);
