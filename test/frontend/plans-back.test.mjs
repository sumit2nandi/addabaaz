import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Plans offers a circular history-back button with Account fallback across redraws', () => {
  const source = readFileSync(new URL('../../app/js/views/plans.js', import.meta.url), 'utf8');
  assert.match(source, /class="account-edit-back" data-plans-back aria-label="Back to previous page"/);
  assert.match(source, /icon\('left', \{ size: 24 \}\)/);
  assert.match(source, /back\('\/account'\)/);
  assert.equal((source.match(/\$\{backButton\}/g) || []).length, 2);
  assert.match(source, /ctx.onCleanup\(\(\) => ctx.root.removeEventListener\('click', onBack\)\)/);
});
