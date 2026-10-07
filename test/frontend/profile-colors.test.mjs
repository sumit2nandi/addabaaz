import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avatar } from '../../app/js/ui/components.js';
import { avatarColor } from '../../app/js/data/user.js';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('profiles use circular initials and retain saved colours, with red as default', () => {
  assert.match(avatar({ name: 'Sumit' }).s, /--av:#b80000/);
  for (let color = 0; color < 8; color++) {
    const output = avatar({ name: 'Sumit', color }).s;
    assert.ok(output.includes(`--av:${avatarColor(color)}`));
    assert.match(output, />S<\/span>/);
    assert.doesNotMatch(output, /<img/);
  }
  assert.match(read('app/css/styles.css'), /\.avatar \{[^}]*border-radius: 50%/);
});

test('picker has five single-row choices and keeps legacy saved colours editable', () => {
  const source = read('app/js/views/profiles.js');
  assert.match(source, /const colors = \[0, 1, 2, 3, color >= 5 && color <= 7 \? color : 4\]/);
  assert.match(source, /p\?\.color \?\? 0/);
  assert.match(source, /colors.map/);
  assert.match(source, /aria-pressed/);
  assert.doesNotMatch(source, /AVATARS|avatar-options/);
  assert.match(read('app/css/styles.css'), /\.swatches \{ display: grid; grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(read('server/src/routes/accounts.js'), /name, kids, color = 0/);
});
