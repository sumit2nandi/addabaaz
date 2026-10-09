// Guard the modular-monolith boundaries: route adapters are injected, persistence stays inward, and modules remain acyclic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldBuildWebAssets } from '../src/web-assets.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ROUTES = path.join(SRC, 'routes');

function sourceFiles(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return entry.isFile() && entry.name.endsWith('.js') ? [file] : [];
  });
}

function localDependencies(file, source) {
  const specs = [...source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  return specs.map((spec) => path.resolve(path.dirname(file), spec)).filter((resolved) => resolved.endsWith('.js') && fs.existsSync(resolved));
}

test('server modules form an acyclic dependency graph', () => {
  const files = sourceFiles();
  const graph = new Map(files.map((file) => [file, localDependencies(file, fs.readFileSync(file, 'utf8'))]));
  const active = new Set(), done = new Set(), cycles = [];
  function visit(file, stack = []) {
    if (active.has(file)) { cycles.push([...stack, file].map((p) => path.relative(SRC, p)).join(' -> ')); return; }
    if (done.has(file)) return;
    active.add(file);
    for (const dep of graph.get(file) || []) visit(dep, [...stack, file]);
    active.delete(file); done.add(file);
  }
  for (const file of files) visit(file);
  assert.deepEqual(cycles, [], `circular imports: ${cycles.join('; ')}`);
});

test('HTTP route modules use injected ports and do not depend on Express composition or MySQL', () => {
  const modules = fs.readdirSync(ROUTES).filter((name) => name.endsWith('.js'));
  assert.ok(modules.length >= 8, 'route domains are split into focused modules');
  for (const name of modules) {
    const source = fs.readFileSync(path.join(ROUTES, name), 'utf8');
    assert.match(source, /export function register[A-Za-z]+/u, `${name} exposes an explicit route-registration boundary`);
    assert.doesNotMatch(source, /from\s+['"][^'"]*(?:\/app\.js|\/db\.js|mysql2\/)/u, `${name} must not import the composition root or SQL driver`);
    assert.doesNotMatch(source, /process\.env/u, `${name} must receive configuration through its factory arguments`);
  }
});

test('persistence adapters do not depend on HTTP transport', () => {
  for (const name of ['db.js', 'db-admin.js', 'db-billing.js', 'db-extra.js']) {
    const source = fs.readFileSync(path.join(SRC, name), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*(?:express|\/routes\/|\/app\.js)/u, `${name} must remain transport-independent`);
  }
});

test('production reuses prebuilt web assets, while dev or incomplete builds regenerate them', () => {
  assert.equal(shouldBuildWebAssets({ enabled: true, production: true, ready: true }), false);
  assert.equal(shouldBuildWebAssets({ enabled: true, production: true, ready: false }), true);
  assert.equal(shouldBuildWebAssets({ enabled: true, production: false, ready: true }), true);
  assert.equal(shouldBuildWebAssets({ enabled: false, production: true, ready: false }), false);
});
