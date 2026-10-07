import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { savedEntries, savedListStrip } from '../../app/js/ui/saved-list.js';
import { parseHTML } from 'linkedom';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('My List includes explicit saves only, ignores unavailable and unknown items', () => {
  const catalog = { show: (id) => id === 's' ? { id } : null, video: (id) => ({ id }), soon: (id) => ({ id }) };
  const user = {
    listItems: () => [{ type: 'show', id: 's' }, { type: 'video', id: 'saved' }, { type: 'upcoming', id: 'soon' }, { type: 'show', id: 'gone' }, { type: 'unknown', id: 'x' }],
    continueWatching: () => { throw new Error('Watch history must not be used'); },
  };
  assert.deepEqual(savedEntries(user, catalog).map((x) => x.item.id), ['s', 'saved', 'soon']);
  user.listItems = () => [];
  assert.deepEqual(savedEntries(user, catalog), []);
});

test('account saved section follows Profiles, with an accessible view-all icon and empty state', () => {
  const { document } = parseHTML(savedListStrip([]).s);
  assert.equal(document.querySelector('a').getAttribute('href'), '#/list');
  assert.equal(document.querySelector('a').getAttribute('aria-label'), 'View all saved items');
  assert.match(document.textContent || document.toString(), /Nothing saved yet/);
  const account = read('app/js/views/account.js');
  assert.match(account, /\$\{profileStrip\(u\)\}\s*<div id="accountSavedList">/);
  assert.match(account, /u.on\('library'/);
  assert.doesNotMatch(read('app/js/views/mylist.js'), /continueWatching|where you left off/);
  assert.match(read('app/js/ui/saved-list.js'), /progress: false/);
  assert.match(read('app/css/styles.css'), /\.account-saved-track \{[^}]*overflow-x: auto/);
});
