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
  assert.match(browse, /<h2 class="sub-h" id="episodesHeading">All Episodes<\/h2>/,
    'the episodes section keeps its heading below the shows grid');
  assert.match(browse, /\$\{chip\('All', 'genre', ''\)\}\$\{chip\('Premium', 'access', 'premium'\)\}\$\{chip\('Free', 'access', 'free'\)\}/,
    'Premium and Free capsules sit right after All');
  assert.match(browse, /\(!st\.access \|\| \(s\.access \|\| 'free'\) === st\.access\)/,
    'the access capsules filter premium vs free shows (untagged shows count as free)');
  assert.match(browse, /if \(c\.dataset\.f === 'genre' && !c\.dataset\.v\) st\.access = ''/,
    'All clears the access filter too');
  assert.match(browse, /if \(st\.access\) q\.set\('access', st\.access\)/,
    'the access choice survives in the URL');
});
