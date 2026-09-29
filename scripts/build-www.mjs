#!/usr/bin/env node
/* Produces ./www — the exact static bundle that Capacitor packages into the Android/iOS apps
 * (and that you can also upload to any static host / CDN).
 *
 *   API_BASE=https://api.addabaaz.in PREMIUM_ENABLED=false npm run build:www
 *
 * - copies only what the app needs (never server/, scripts/, originals)
 * - writes app/env.js from environment variables
 * - stamps the service-worker cache version */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const item of ['index.html', 'manifest.webmanifest', 'sw.js', 'app', 'data', 'media']) {
  fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}

const envFile = path.join(out, 'app/env.js');
const src = fs.readFileSync(envFile, 'utf8');
const apiBase = process.env.API_BASE ?? '';
const premium = String(process.env.PREMIUM_ENABLED ?? 'false') === 'true';
const patched = src
  .replace(/API_BASE:\s*'[^']*'/, `API_BASE: ${JSON.stringify(apiBase)}`)
  .replace(/PREMIUM_ENABLED:\s*(true|false)/, `PREMIUM_ENABLED: ${premium}`);
fs.writeFileSync(envFile, patched);

let stamp = String(Date.now());
try { stamp = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim(); } catch { /* not a git checkout */ }
const swFile = path.join(out, 'sw.js');
fs.writeFileSync(swFile, fs.readFileSync(swFile, 'utf8').replace(/const VERSION = '[^']*'/, `const VERSION = 'v2.0.0-${stamp}'`));

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`✔ www/ built (${(size(out) / 1048576).toFixed(1)} MB) · API_BASE=${apiBase || '(auto-detect)'} · premium=${premium} · sw=${stamp}`);
