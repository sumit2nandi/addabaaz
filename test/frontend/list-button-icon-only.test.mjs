// The My List / Save video button is the + / ✓ icon and nothing else — on every page, not just the
// banners. The wording lives in the tooltip and the accessible name (`label`, kept per button in
// `data-list-add` so syncButtons can refresh it when the state flips), so no call site may draw text
// on the button or pass the retired `iconOnly` flag.
// Run:  node --test test/frontend/list-button-icon-only.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Call sites live in the view modules and in the shared components (cards use it too).
const SOURCES = ['app/js/ui/components.js', 'app/js/views/home.js', 'app/js/views/show.js', 'app/js/views/soon.js', 'app/js/views/watch.js'];

test('listBtn renders the icon alone, with the wording as its accessible name', () => {
  const src = read('app/js/ui/components.js');
  const fn = src.match(/export function listBtn\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, 'listBtn is exported');
  assert.doesNotMatch(fn, /<span class="lbl">/, 'the button never draws a text label');
  assert.doesNotMatch(fn, /iconOnly/, 'the retired iconOnly flag is gone (every list button is icon-only)');
  assert.match(fn, /data-list-add="\$\{label\}"/, 'each button keeps its own wording for later state changes');
  assert.match(fn, /aria-label="\$\{name\}"/, 'the icon button carries an accessible name');
  assert.match(fn, /title="\$\{name\}"/, 'and the same wording as a tooltip');
  assert.match(fn, /const name = on \? 'Remove from My List' : label;/, 'the name follows the saved state');
});

test('syncButtons refreshes the wording of every list button it touches', () => {
  const src = read('app/js/ui/components.js');
  assert.match(src, /b\.title = on \? 'Remove from My List' : \(b\.dataset\.listAdd \|\| 'Add to My List'\);/,
    'the tooltip and accessible name stay in step with the state');
  assert.match(src, /b\.setAttribute\('aria-label', b\.title\);/, 'and the accessible name is re-applied');
  const fn = src.match(/export function syncButtons\([\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(fn, /querySelector\('\.lbl'\)[\s\S]*data-list/, 'list buttons no longer rely on a label element');
});

test('every list button is a compact icon button', () => {
  for (const file of SOURCES) {
    // Drop the definition itself; only call sites are scanned (the default class covers a bare call).
    const src = read(file).replace(/export function listBtn\([\s\S]*?\n\}/, '');
    for (const call of src.match(/listBtn\([^)]*\)/g) || []) {
      assert.doesNotMatch(call, /iconOnly/, `${file}: ${call} — the retired iconOnly flag is gone`);
      // Poster/hover cards use the bare .icon-btn circle; every .btn variant asks for the square icon padding.
      const cls = call.match(/cls: '([^']*)'/)?.[1];
      if (cls) assert.match(cls, /(icon-only|icon-btn)/, `${file}: ${call} — an icon-only button class keeps the + square`);
    }
  }
});

test('the wording each button announces names what it saves', () => {
  const watch = read('app/js/views/watch.js');
  assert.match(watch, /listBtn\('show', show\.id, \{ label: 'Add show to My List', cls: 'btn btn-ghost icon-only' \}\)/,
    'the show-level action explains that it saves the whole show');
  assert.match(watch, /listBtn\('video', v\.id, \{ label: 'Save video', cls: 'btn btn-ghost icon-only' \}\)/,
    'and the episode-level action stays distinguishable from it');
  const soon = read('app/js/views/soon.js');
  assert.match(soon, /listBtn\('upcoming', u\.id, \{ label: 'Add to My List', cls: 'btn btn-glass btn-lg icon-only' \}\)/,
    'Coming Soon uses the same compact button as the banners');
});

test('CSS keeps the icon button the same height as the labelled buttons beside it', () => {
  const css = read('app/css/styles.css');
  assert.match(css, /\.watch-actions \.btn\.icon-only \{ padding: 10px 13px; \}/,
    'the watch row’s + lines up with Next / Cast / Share instead of standing taller');
  assert.match(css, /\.btn\.icon-only \{ padding: 13px; \}/, 'the shared icon-only padding remains for standalone buttons');
  assert.match(css, /img\.img-failed \{ opacity: 0; \}/, 'unrelated rules are untouched');
});
