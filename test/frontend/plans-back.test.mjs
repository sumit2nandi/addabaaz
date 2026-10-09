import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Plans places the shared plain-arrow Back beside its heading in both rendering branches', () => {
  const source = read('app/js/views/plans.js');
  assert.ok(source.includes("pageBack(ctx, '/account')"));
  assert.match(source, /sectionHeader\(\{ title: 'Plans Need the ADDABAAZ Server', back: backButton \}\)/);
  assert.equal((source.match(/back: backButton/g) || []).length, 3, 'fallback and both regular plan headers use the inline arrow');
});

test('pages with a Back action use the shared plain arrow beside the page title', () => {
  for (const view of ['mylist', 'settings', 'support', 'deletion', 'studio', 'legal']) {
    const source = read(`app/js/views/${view}.js`);
    assert.match(source, /pageBack\(ctx/);
    assert.match(source, /backButton/);
    assert.doesNotMatch(source, /class="back-link"|class="back-row"/);
  }
  assert.equal((read('app/js/views/studio.js').match(/back: backButton/g) || []).length, 3);
  assert.equal((read('app/js/views/support.js').match(/back: backButton/g) || []).length, 2);
  assert.match(read('app/js/views/settings.js'), /class="settings-page-heading">\$\{backButton\}<h1>/);
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
    assert.ok(button.classList.contains('page-back'));
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
