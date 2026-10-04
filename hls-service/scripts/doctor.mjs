#!/usr/bin/env node
/**
 * `npm run doctor` — checks this machine before you rely on it: ffmpeg, the data folder, the settings,
 * and (if configured) the R2 bucket itself, with a probe file that is uploaded and deleted again.
 *
 * Safe to run any time: it writes nothing except a temporary probe object in the bucket.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configFromEnv, prepareDataDirs, configProblems } from '../src/config.js';
import { createR2 } from '../src/r2.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const warn = (m) => console.log(`  ⚠ ${m}`);
const bad = (m) => console.log(`  ✖ ${m}`);
let problems = 0;

console.log('\nADDABAAZ HLS converter — setup check\n');
const cfg = prepareDataDirs(configFromEnv());

console.log('ffmpeg');
for (const [label, cmd] of [['ffmpeg', cfg.ffmpeg], ['ffprobe', cfg.ffprobe]]) {
  const res = spawnSync(cmd, ['-version'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    bad(`${label} not usable (“${cmd}”): ${res.error?.message || `exit ${res.status}`}`);
    problems++;
  } else {
    const version = /version (\S+)/.exec(res.stdout || '')?.[1] || 'unknown';
    const encoders = cmd === cfg.ffmpeg ? spawnSync(cmd, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '' : '';
    const x264 = /libx264/.test(encoders);
    const major = Number(String(version).split('.')[0]);
    if (label === 'ffmpeg' && !x264) { bad(`${label} ${version} has no libx264 encoder — install a full build (apt install ffmpeg / apk add ffmpeg / brew install ffmpeg)`); problems++; }
    else if (label === 'ffmpeg' && Number.isFinite(major) && major > 0 && major < 5) warn(`${label} ${version} is old: variant names in the master playlist need ffmpeg ≥ 5 (folders will be numbered instead)`);
    else ok(`${label} ${version}${x264 ? ' with libx264' : ''}`);
  }
}
if (fs.existsSync(path.resolve(cfg.root, '.tools'))) ok(`local tools folder: ${path.resolve(cfg.root, '.tools')}`);

console.log('\ndisk');
try {
  const stat = fs.statfsSync(cfg.dataDir);
  const freeGb = (Number(stat.bavail) * Number(stat.bsize)) / 1024 ** 3;
  if (freeGb < 5) { warn(`only ${freeGb.toFixed(1)} GB free under ${cfg.dataDir} — a long video needs several times its own size`); }
  else ok(`${freeGb.toFixed(1)} GB free under ${cfg.dataDir}`);
} catch { warn('could not read free disk space'); }

console.log('\nsettings');
console.log(`  data dir          : ${cfg.dataDir}`);
console.log(`  jobs at a time    : ${cfg.concurrency}`);
console.log(`  max upload        : ${(cfg.maxUploadBytes / 1024 ** 3).toFixed(2)} GB`);
console.log(`  local retention   : ${cfg.retentionHours} h`);
console.log(`  default preset    : ${cfg.defaultPreset}`);
console.log(`  R2 prefix         : ${cfg.r2.prefix}`);
const issues = configProblems(cfg);
if (cfg.token) ok('CONVERTER_TOKEN is set'); else { bad('CONVERTER_TOKEN is not set — the portal and API cannot authenticate anyone'); problems++; }
for (const issue of issues.filter((i) => !/CONVERTER_TOKEN is not set/.test(i))) warn(issue);
if (cfg.site.configured) ok(`catalog bridge → ${cfg.site.apiUrl}`); else console.log('  · catalog bridge: off (APP_API_URL + APP_ADMIN_TOKEN not set) — the portal will only print the R2 key');

console.log('\nCloudflare R2');
const r2 = createR2(cfg.r2, { log: (m) => console.log(`    ${m}`) });
if (!r2.configured) { warn(`not configured: ${r2.reason}`); console.log('    (encoding still works — you can download the package as a ZIP)'); }
else {
  const res = await r2.check();
  for (const step of res.steps) (step.ok ? ok : bad)(`${step.name}: ${step.detail}`);
  if (!res.ok) { problems++; console.log('    → Cloudflare → R2 → Manage API tokens: give this token “Object Read & Write” for the bucket.'); }
}

console.log(`\n${problems ? `${problems} problem(s) above` : 'Everything looks ready.'}\n`);
console.log(problems ? 'Next: fix the lines marked ✖, then run “npm start” and open the portal.' : `Next: “npm start” (or “docker compose up --build”), then open http://localhost:${cfg.port}\n`);
process.exit(problems ? 1 : 0);
