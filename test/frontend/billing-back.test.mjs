import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('billing uses the plain Back arrow beside its title in normal and failed states', () => {
  const view = read('app/js/views/billing.js');
  assert.match(view, /class="page-back" href="#\/plans" aria-label="Back to plan details"/);
  const backLink = view.match(/const backLink = html`([^`]+)`;/)[1];
  assert.doesNotMatch(backLink, /title=|<span|href="#\/account"/);
  assert.match(backLink, />\$\{icon\('left', \{ size: 28 \}\)\}<\/a>/);
  assert.equal((view.match(/back: backLink/g) || []).length, 2, 'normal and failed billing headers both place the arrow inline');
  assert.match(read('app/css/styles.css'), /\.page-back \{[^}]*border: 0[^}]*border-radius: 0/);
});
