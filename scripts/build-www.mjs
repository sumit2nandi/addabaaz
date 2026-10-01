#!/usr/bin/env node
/* Produces ./www — the exact static bundle that Capacitor packages into the Android/iOS apps
 * (and that you can also upload to any static host / CDN).
 *
 *   API_BASE=https://api.addabaaz.in npm run build:www
 *
 * - copies only what the app needs (never server/, scripts/, originals)
 * - writes app/env.js from environment variables
 * - stamps the service-worker cache version */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Folders: the repository root and the output folder `www/` (recreated on every build; it is git-ignored).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Copy only what the browser app needs. Server code, scripts and original artwork are never included.
for (const item of ['index.html', 'manifest.webmanifest', 'sw.js', 'app', 'data', 'media']) {
  fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}

// Bake the API address into app/env.js. Empty = auto-detect (same-origin /api/v1, else static/local mode); 'off' = never call an API.
const envFile = path.join(out, 'app/env.js');
const src = fs.readFileSync(envFile, 'utf8');
const apiBase = process.env.API_BASE ?? '';
const patched = src
  .replace(/API_BASE:\s*'[^']*'/, `API_BASE: ${JSON.stringify(apiBase)}`);
fs.writeFileSync(envFile, patched);

// Stamp the service worker with the git commit so each build gets a fresh offline cache (old caches are deleted on activate).
let stamp = String(Date.now());
try { stamp = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim(); } catch { /* not a git checkout */ }
// Minify the service worker first, then stamp it (minification may re-quote the VERSION literal).
const { minifyTree, minifyFile } = await import('./lib/minify.mjs');
await minifyFile(path.join(out, 'sw.js'), path.join(out, 'sw.js'));
const swFile = path.join(out, 'sw.js');
fs.writeFileSync(swFile, fs.readFileSync(swFile, 'utf8').replace(/const VERSION\s*=\s*["'][^"']*["']/, `const VERSION="v2.0.0-${stamp}"`));

// Minify the copied web sources: shipped files keep their paths but carry no comments or formatting.
await minifyTree(path.join(out, 'app'), path.join(out, 'app'));

// Print the size of the finished bundle.
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`✔ www/ built (${(size(out) / 1048576).toFixed(1)} MB) · API_BASE=${apiBase || '(auto-detect)'} · sw=${stamp}`);
