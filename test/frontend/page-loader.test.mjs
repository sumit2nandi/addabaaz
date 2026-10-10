// A page that takes a moment to fetch shows the centred page loader: a SMALL, brand-red Material-style
// indeterminate arc (grow-and-shrink sweep, round caps, faint track) pinned in the centre of the SCREEN.
//
// It is laid over the page you are leaving instead of blanking it, and it never blocks the floating menu
// (pointer-events: none, and the bar paints above it). Pull-to-refresh uses the same Material arc (just a
// touch thicker); dialogs/other busy states keep the plain border-ring `.spinner`.
//
// Run: node --test test/frontend/page-loader.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const css = read('app/css/styles.css');
// The declaration block of a one-line rule (the way the other front-end tests read the stylesheet).
const rule = (selector) => css.split('\n').find((line) => line.startsWith(`${selector} `) || line.startsWith(`${selector}{`)) || '';

test('a slow page shows a small red Material loader centred in the screen', () => {
  const router = read('app/js/router.js');
  const loader = router.match(/const PAGE_LOADER = '([^']+)'/)?.[1];
  assert.ok(loader, 'the router owns the loader markup');
  assert.match(loader, /^<div class="page-loader" role="status" aria-label="Loading" aria-busy="true">/, 'announced to screen readers');
  // Material indeterminate arc: an SVG track plus a dash-animated arc (not the border-ring spinner).
  assert.match(loader, /<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="tr"[^>]*><\/circle><circle class="arc"[^>]*><\/circle><\/svg>/);
  assert.match(router, /this\.root\.insertAdjacentHTML\('beforeend', PAGE_LOADER\)/, 'laid over the page instead of blanking it');
  assert.match(router, /setTimeout\(\(\) => \{ if \(token === this\.#token\) this\.root\.insertAdjacentHTML/, 'only when the page is actually slow');
  assert.match(router, /clearTimeout\(skeleton\);/, 'and always cleared when the page arrives');

  const box = rule('.page-loader');
  assert.match(box, /position: fixed/, 'fixed to the viewport, so it is centred on the SCREEN');
  assert.match(box, /inset: 0/);
  assert.match(box, /place-items: center/);
  assert.match(box, /pointer-events: none/, 'never swallows taps meant for the menu');
  assert.match(box, /z-index: 90/, 'below the fixed top bar and floating menu (z-index 100)');
  assert.match(rule('.page-loader svg'), /width: 36px; height: 36px/, 'small');
  const arc = rule('.page-loader .arc');
  assert.match(arc, /stroke: var\(--accent\)/, 'brand red');
  assert.match(arc, /animation: loaderarc/, 'the sweep animates');
  assert.match(rule('.page-loader circle'), /stroke-linecap: round/, 'Material round caps');
  assert.match(rule('.page-loader .tr'), /stroke: rgba\(255,255,255/, 'a faint track behind the arc');
  assert.match(rule('@keyframes loaderarc') || css, /@keyframes loaderarc \{[\s\S]*?stroke-dasharray: 1 100[\s\S]*?stroke-dasharray: 75 100[\s\S]*?\}/, 'the arc grows and shrinks (indeterminate)');
  // 2 * PI * 15.9155 ≈ 100: the dash values above are that circumference, so the sweep loops seamlessly.
  assert.match(read('app/js/router.js'), /r="15\.9155"/);
  assert.match(rule('.page-loader svg'), /animation: spin/, 'while the whole ring revolves');
});

test('the border-ring spinner keeps its own look for dialogs/busy states', () => {
  assert.match(rule('.spinner'), /width: 34px; height: 34px/, 'the small border-ring spinner is untouched');
  // The boot splash is a separate mark and must not be caught by the page loader's rules.
  assert.doesNotMatch(css, /\.boot, \.page-loading/, 'the old combined boot/page-loading rule is gone');
  assert.match(rule('.boot'), /min-height: 70vh/, 'the boot splash keeps its own sizing');
});

test('pull-to-refresh uses its own, slightly heavier Material indeterminate arc', () => {
  const ptr = read('app/js/ui/ptr.js');
  // Same Material arc markup as the page loader (SVG track + dash-animated arc), not the plain border-ring spinner.
  assert.match(ptr, /<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="tr"[^>]*><\/circle><circle class="arc"[^>]*><\/circle><\/svg>/);
  assert.doesNotMatch(ptr, /<div class="spinner">/, 'no longer the plain border-ring spinner');
  assert.match(rule('.ptr svg'), /width: 34px; height: 34px/);
  assert.match(rule('.ptr svg'), /animation: spin/, 'the whole ring revolves');
  assert.match(rule('.ptr circle'), /stroke-width: 5/, 'a bit thicker than the page loader\'s stroke-width: 4');
  assert.match(rule('.ptr circle'), /stroke-linecap: round/, 'Material round caps');
  assert.match(rule('.ptr .tr'), /stroke: rgba\(255,255,255/, 'a faint track behind the arc');
  assert.match(rule('.ptr .arc'), /stroke: var\(--accent\)/, 'brand red');
  assert.match(rule('.ptr .arc'), /animation: loaderarc/, 'the same grow-and-shrink sweep as the page loader');
});
