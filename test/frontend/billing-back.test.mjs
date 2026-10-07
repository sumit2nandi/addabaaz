import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('billing reuses the circular Account back button in normal, empty and failed states', () => {
  const view = read('app/js/views/billing.js');
  assert.match(view, /class="account-edit-back" href="#\/account" aria-label="Back to Account"/);
  assert.match(view, /\$\{backLink\}\s*\$\{sectionHeader/);
  assert.match(view, /\$\{backLink\}<div class="empty"><h2>Couldn’t load/);
  assert.equal((view.match(/\$\{backLink\}/g) || []).length, 2);
  assert.match(read('app/css/styles.css'), /\.account-edit-back \{[^}]*border-radius: 50%/);
});
