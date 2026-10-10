import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { profileStrip } from '../../app/js/ui/profile-strip.js';
import { CONFIG } from '../../app/js/config.js';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('profile picker marks active profile and exposes edit, add and kids labels', () => {
  const { document } = parseHTML(profileStrip({ activeId: 'a', profiles: [
    { id: 'a', name: 'Viewer', color: 0 }, { id: 'b', name: 'Child', color: 1, kids: true },
  ] }).s);
  assert.equal(document.querySelectorAll('[data-account-profile]').length, 2);
  assert.equal(document.querySelector('[aria-pressed="true"]').dataset.accountProfile, 'a');
  assert.equal(document.querySelector('.profile-kids-label').textContent, 'Kids');
  assert.equal(document.querySelector('.profile-edit').getAttribute('href'), '#/profiles?manage=1');
  assert.equal(document.querySelector('.profile-choice[href]').getAttribute('href'), '#/profiles?manage=1&add=1');
});

test('profile cap hides Add, and switching retains parental checks', () => {
  const profiles = Array.from({ length: CONFIG.maxProfiles }, (_, i) => ({ id: String(i), name: 'Profile' }));
  const { document } = parseHTML(profileStrip({ profiles, activeId: '0' }).s);
  assert.equal(document.querySelector('.profile-add-icon'), null);
  const account = read('app/js/views/account.js');
  assert.ok(account.indexOf('${profileStrip(u)}') > account.indexOf('<section class="profile-head">'));
  assert.ok(account.indexOf('${profileStrip(u)}') < account.indexOf('<nav class="card-panel list group-list"'));
  assert.match(account, /await mayLeaveKids\(u, target\)/);
  assert.match(account, /await u.selectProfile\(target.id\)/);
  assert.match(read('app/js/views/profiles.js'), /ctx.query.add === '1' && u.profiles.length < CONFIG.maxProfiles/);
  const css = read('app/css/styles.css');
  assert.match(css, /\.avatar \{[^}]*border-radius: 50%/);
  assert.match(css, /\.avatar.xl \{ border-radius: 50%; \}/);
  assert.match(css, /\.avatar-btn \{[^}]*border-radius: 50%/);
});
