// The video editor's "Show to Admins only" checkbox: a dependent option of "Hide from the public website".
// It appears (unticked) only while hidden is on, clears itself when hidden is unticked, and the video list
// marks hidden admins-only rows so editors can see who a hidden video is still visible to.
// Run: node --test test/frontend/admin-video-admins-only.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const content = readFileSync(new URL('../../admin/js/views/content.js', import.meta.url), 'utf8');

test('the admins-only checkbox is a dependent option of "Hide from the public website"', () => {
  const hiddenField = content.indexOf("{ k: 'hidden', label: 'Hide from the public website', type: 'bool'");
  const adminsField = content.indexOf("{ k: 'adminsOnly', label: 'Show to Admins only', type: 'bool'");
  assert.ok(hiddenField > -1, 'the existing hide checkbox is untouched');
  assert.ok(adminsField > hiddenField, 'the new checkbox sits directly below it in the video form');
  const definition = content.slice(adminsField, content.indexOf('},', adminsField));
  assert.match(definition, /wide: true/, 'it spans the modal like its parent checkbox');
  assert.doesNotMatch(definition, /dflt: true/, 'it starts unchecked — hiding a video never widens its audience by itself');
  assert.match(definition, /Hide from the public website/, 'its help text names the parent option it depends on');
});

test('the checkbox row only exists while hidden is ticked, and unticking hidden clears it', () => {
  assert.match(content, /const hiddenBox = form\.elements\.hidden, adminsBox = form\.elements\.adminsOnly;/,
    'both boxes are read through form.elements (form.hidden is the form’s own hidden attribute, not the input)');
  assert.match(content, /adminsRow\.style\.display = hiddenBox\.checked \? '' : 'none'/,
    'the row follows the parent checkbox (style, not [hidden]: .field sets display:grid in admin.css)');
  assert.match(content, /if \(!hiddenBox\.checked\) adminsBox\.checked = false;/,
    'unticking “Hide from the public website” also unticks “Show to Admins only”');
  assert.match(content, /hiddenBox\.addEventListener\('change', syncHidden\); syncHidden\(\);/,
    'the initial state is applied when the modal opens, so editing a hidden admins-only video shows it ticked');
});

test('the video list marks hidden admins-only rows', () => {
  assert.match(content, /v\.hidden && v\.adminsOnly \? html` \$\{badge\('Admins only', 'warn'\)\}` : ''/,
    'a hidden video that admins can still watch carries a badge next to its Hidden status');
});
