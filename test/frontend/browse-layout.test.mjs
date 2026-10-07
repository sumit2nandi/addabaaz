import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Shows page opens directly on the genre filters, with page-font titles', () => {
  const browse = read('app/js/views/browse.js');

  assert.doesNotMatch(browse, /id="showsHeading"/,
    'no Shows heading leaves dead space above the filters');
  assert.match(browse, /<section aria-label="Shows">/,
    '...the section keeps its accessible name without the visible heading');
  assert.doesNotMatch(browse, /class="bn"/,
    'show tiles use the page font — the Tiro Bangla serif override made Latin titles look foreign');
  assert.match(browse, /<h2 class="sub-h" id="episodesHeading">All episodes<\/h2>/,
    'the episodes section keeps its heading below the shows grid');
});
