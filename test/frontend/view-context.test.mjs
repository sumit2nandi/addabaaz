// The shell hands every page module a context object; a page that calls a member the shell does not provide
// dies on its first line and the router shows its generic "Something went wrong" screen instead of the page.
//
// That is exactly how the sign-in and support pages broke: they were written against the *console* context
// (`ctx.stale()`, which the admin/content shell has had all along) but they run in the viewer's router, whose
// context had no `stale` at all. Source-pin tests happily matched the string `ctx.stale()` and passed.
//
// This test parses the context literal from each shell and checks that every `ctx.<member>` a page module
// reads actually exists there — so a typo, or copying a page from the other shell, fails locally.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The body of the object literal assigned to `const ctx = { … }` (brace-matched, strings ignored). */
function ctxLiteral(source, file) {
  const at = source.indexOf('const ctx = {');
  assert.ok(at > -1, `${file} builds a context object`);
  const open = source.indexOf('{', at);
  let depth = 0, i = open, quote = null;
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1];
    if (quote) { if (ch === quote && prev !== '\\') quote = null; continue; }   // inside a string
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) break;
  }
  assert.ok(i < source.length, `${file}: the context literal is closed`);
  return source.slice(open + 1, i);
}

/** Keys of that literal: `a: 1, b, c: () => { … }` → [a, b, c] (top-level commas only). */
function ctxKeys(body) {
  const keys = [];
  let depth = 0, quote = null, item = '';
  const flush = () => {
    const m = item.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/);
    if (m) keys.push(m[1]);
    item = '';
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i], prev = body[i - 1];
    if (quote) { item += ch; if (ch === quote && prev !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; item += ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { flush(); continue; }
    item += ch;
  }
  flush();
  return keys;
}

/** Every `ctx.<name>` a file reads, with the line it happens on (for a useful failure message). */
function ctxUses(source) {
  const out = new Map();
  source.split('\n').forEach((line, n) => {
    for (const m of line.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) {
      if (!out.has(m[1])) out.set(m[1], n + 1);
    }
  });
  return out;
}

const pageFiles = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);

test('the viewer router provides every member the viewer page modules use', () => {
  const keys = ctxKeys(ctxLiteral(read('app/js/router.js'), 'app/js/router.js'));
  assert.ok(keys.includes('root') && keys.includes('setTitle') && keys.includes('onCleanup'), 'the basics are there');
  const allowed = new Set(keys);
  const bad = [];
  for (const file of pageFiles('app/js/views')) {
    for (const [name, line] of ctxUses(read(file))) {
      if (!allowed.has(name)) bad.push(`${file}:${line} reads ctx.${name}, which the router does not provide (it provides: ${keys.join(', ')})`);
    }
  }
  assert.deepEqual(bad, [], 'no viewer page may call a context member the router lacks');
  // The sign-in and support pages guard their awaited work with `ctx.stale()`; that guard must exist.
  assert.ok(keys.includes('stale'), 'the router context has `stale()` for pages that await');
  const guard = /ctx\.stale\?\.\(\)/;
  assert.match(read('app/js/views/auth.js'), guard, 'the sign-in page bails out when a newer navigation started');
  assert.match(read('app/js/views/support.js'), guard, 'and so does the support page');
});

test('the console shell provides every member the shared console pages use', () => {
  const keys = ctxKeys(ctxLiteral(read('admin/js/console.js'), 'admin/js/console.js'));
  const allowed = new Set(keys);
  const bad = [];
  for (const file of pageFiles('admin/js/views')) {
    for (const [name, line] of ctxUses(read(file))) {
      if (!allowed.has(name)) bad.push(`${file}:${line} reads ctx.${name}, which the console does not provide (it provides: ${keys.join(', ')})`);
    }
  }
  assert.deepEqual(bad, [], 'no console page may call a context member the console lacks');
  assert.ok(keys.includes('stale'), 'console pages rely on ctx.stale() after every await');
});

test('a page module kept from a previous release cannot crash the page it no longer belongs to', () => {
  // `stale` is optional at the call site: a browser can hold the cached shell from the previous release
  // next to a freshly fetched page module (the shell is precached, page modules are not). Optional calls
  // mean the worst case is a wasted render, never "ctx.stale is not a function".
  for (const file of ['app/js/views/auth.js', 'app/js/views/support.js']) {
    const src = read(file);
    assert.ok(!/ctx\.stale\(\)/.test(src), `${file} calls ctx.stale() unguarded`);
  }
});
