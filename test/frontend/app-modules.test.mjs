// Guard against deploying from a stale git index (the "Update index.html" incident): CI must fail
// BEFORE a deploy if any frontend module the app lazy-loads or imports is missing from the checkout —
// otherwise every affected page crashes at runtime with "Failed to fetch dynamically imported module".
//
// Run:  node --test test/frontend/app-modules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { ROUTES } = await import('../../app/js/routes.js');

// Follows static relative imports (same regex as server/src/seo.js modulePreloads) and returns the missing files.
function missingImports(entryRel, seen = new Set()) {
  const missing = [];
  const walk = (rel) => {
    if (seen.has(rel)) return [];
    seen.add(rel);
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); return; }
    if (!rel.endsWith('.js')) return;
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/gm)) {
      walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1] || m[2] || m[3])));
    }
  };
  walk(entryRel);
  return missing;
}

test('every route has its view module: app/js/views/<view>.js exists for all ROUTES entries', () => {
  const views = [...new Set(ROUTES.map((r) => r.view))];
  const missing = views.map((v) => `app/js/views/${v}.js`).filter((f) => !fs.existsSync(path.join(root, f)));
  assert.deepEqual(missing, [], `view module(s) missing from the checkout: ${missing.join(', ')}`);
});

test('every module reachable from the app entry point (main.js + all views) exists', () => {
  const entries = ['app/js/main.js', ...ROUTES.map((r) => `app/js/views/${r.view}.js`)];
  const missing = entries.flatMap((e) => missingImports(e));
  assert.deepEqual([...new Set(missing)], [], `imported module(s) missing from the checkout: ${[...new Set(missing)].join(', ')}`);
});
