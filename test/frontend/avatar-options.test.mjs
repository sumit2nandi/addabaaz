import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { AVATARS, avatarOption } from '../../app/js/ui/avatar-options.js';
import { avatar } from '../../app/js/ui/components.js';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('avatar slots render bundled illustrations and default to a red initial', () => {
  assert.equal(AVATARS.length, 8);
  for (let color = 1; color < AVATARS.length; color++) {
    const { document } = parseHTML(avatar({ name: 'Viewer', color }).s);
    const src = document.querySelector('img').getAttribute('src');
    assert.ok(existsSync(new URL(`../../${src}`, import.meta.url)));
  }
  for (const color of [0, undefined, -1, 99]) {
    assert.equal(avatarOption(color), AVATARS[0]);
    const { document } = parseHTML(avatar({ name: 'Sumit', color }).s);
    assert.equal(document.querySelector('.avatar').textContent, 'S');
    assert.match(document.querySelector('.avatar').getAttribute('style'), /--av:#b80000/);
  }
});

test('picker saves avatar choices and server creation honors selected slot instead of rotating colours', () => {
  const profile = read('app/js/views/profiles.js');
  assert.doesNotMatch(profile, /class="swatches"|aria-label="Colour"/);
  assert.match(profile, /p\?\.color \?\? 0/);
  assert.match(profile, /AVATARS.map/);
  assert.match(profile, /u.createProfile\(\{ name, color, kids \}\)/);
  assert.match(read('app/js/data/user.js'), /color: color \?\? 0/);
  assert.match(read('server/src/routes/accounts.js'), /name, kids, color = 0/);
  assert.match(read('server/src/routes/accounts.js'), /name, kids, color \}, MAX_PROFILES/);
  assert.match(read('server/src/db.js'), /async create\(userId, \{ id, name, kids = false, color = 0 \}/);
  assert.doesNotMatch(read('server/src/db.js'), /const color = n % palette/);
});
