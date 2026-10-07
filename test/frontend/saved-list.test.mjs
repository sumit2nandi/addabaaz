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

test('saved upcoming cards expose the same removal toggle as saved shows', async () => {
  const { app } = await import('../../app/js/app.js');
  const { savedCard } = await import('../../app/js/ui/saved-list.js');
  const previous = app.user;
  app.user = { inList: (type, id) => type === 'upcoming' && id === 'soon-one' };
  try {
    const { document } = parseHTML(savedCard({ type: 'upcoming', item: { id: 'soon-one', title: 'Soon', poster: 'poster.jpg' } }).s);
    const button = document.querySelector('.card-quick .list-btn');
    assert.ok(button);
    assert.equal(button.getAttribute('data-list'), 'upcoming:soon-one');
    assert.equal(button.getAttribute('aria-label'), 'Remove from My List');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('a').getAttribute('href'), '#/soon/soon-one');
  } finally { app.user = previous; }
});
