import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Plans uses the shared previous-page button in both rendering branches', () => {
  const source = read('app/js/views/plans.js');
  assert.ok(source.includes("pageBack(ctx, '/account')"));
  assert.equal((source.match(/\$\{backButton\}/g) || []).length, 2);
});

test('all requested pages use shared circular Back without old text back links', () => {
  for (const view of ['mylist', 'settings', 'support', 'deletion', 'studio', 'legal']) {
    const source = read(`app/js/views/${view}.js`);
    assert.match(source, /pageBack\(ctx/);
    assert.match(source, /\$\{backButton\}/);
    assert.doesNotMatch(source, /class="back-link"/);
  }
  assert.equal((read('app/js/views/studio.js').match(/\$\{backButton\}/g) || []).length, 3);
  assert.equal((read('app/js/views/support.js').match(/\$\{backButton\}/g) || []).length, 2);
});

test('shared button navigates back, falls home for direct entry, and cleans up its handler', async () => {
  const { parseHTML } = await import('linkedom');
  const { pageBack } = await import('../../app/js/ui/page-back.js');
  const saved = Object.fromEntries(['window', 'history', 'HashChangeEvent'].map(key => [key, globalThis[key]]));
  let backs = 0, destination, cleanup;
  const { document, window } = parseHTML('<main></main>');
  globalThis.window = window;
  window.__navDepth = 1;
  globalThis.history = { length: 2, back() { backs++; }, replaceState(_s, _t, url) { destination = url; } };
  globalThis.HashChangeEvent = window.Event;
  const root = document.querySelector('main');
  try {
    root.innerHTML = pageBack({ root, onCleanup(fn) { cleanup = fn; } }).s;
    const button = root.querySelector('button');
    assert.equal(button.getAttribute('aria-label'), 'Back to previous page');
    assert.ok(button.classList.contains('account-edit-back'));
    button.click();
    assert.equal(backs, 1);
    window.__navDepth = 0;
    button.click();
    assert.equal(destination, '#/');
    cleanup();
    window.__navDepth = 1;
    button.click();
    assert.equal(backs, 1);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
