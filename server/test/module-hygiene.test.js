// Module hygiene for server/src: no module may call a shared helper it never imported.
//
// `node --check` only sees syntax, and the DB-backed tests only see the paths they exercise — a call to a
// helper that exists in a sibling module but is not imported throws a ReferenceError at RUNTIME, which
// the API turns into a 500 `server_error`. That is exactly how a `mergeUsers` refusing two unrelated
// accounts answered 500 instead of 400/409. This test reads every server module and checks the helpers
// that are imported across files. No database needed.
// Run: node --test server/test/module-hygiene.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = new URL('../src/', import.meta.url);
// Helpers that live in shared error/HTTP/email modules and must be imported by name.
const SHARED = ['HttpError', 'bad', 'wrap', 'isDuplicate', 'normalizeEmail', 'emailKey', 'visibleEmail', 'plainEmail'];

/** Identifiers the module imports (named, aliased, default) or defines at top level. */
function availableNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+'[^']+';/g)) {
    const clause = m[1];
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const [orig, alias] = part.trim().split(/\s+as\s+/);
        if (orig) names.add((alias || orig).trim());
      }
    }
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/^,|,$/g, '').trim();
    if (rest && !rest.startsWith('{')) for (const part of rest.split(',')) if (part.trim()) names.add(part.trim());
  }
  for (const m of src.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}

function sourceFiles(dir = DIR) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = new URL(entry.name, dir);
    if (entry.isDirectory()) return sourceFiles(new URL(entry.name + '/', dir));
    return entry.isFile() && entry.name.endsWith('.js') ? [file] : [];
  });
}

test('every server module imports the shared helpers it uses', () => {
  const complaints = [];
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const available = availableNames(src);
    const code = src.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');          // ignore comments and JSDoc
    for (const name of SHARED) {
      const used = new RegExp(`(?:new\\s+${name}\\b|\\b${name}\\s*\\()`).test(code);
      if (used && !available.has(name)) complaints.push(`${file} uses ${name}() but never imports/defines it`);
    }
  }
  assert.deepEqual(complaints, []);
});
