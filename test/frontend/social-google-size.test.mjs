// Google's sign-in button is drawn by Google at size "large": 40px tall, and any width from 200 to 400px.
// The slots around it must match that height and never be narrower than the button, or it is clipped.
// Run: node --test test/frontend/social-google-size.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.document = document;
globalThis.window = window;
window.ADDABAAZ_ENV = { API_BASE: 'https://api.test' };

const { googleButtonWidth } = await import('../../app/js/social.js');

test('Google’s button is drawn at the slot width, within its 200–400px range, in whole pixels', () => {
  assert.equal(googleButtonWidth(440), 400, 'a wide card is capped at Google’s maximum');
  assert.equal(googleButtonWidth(384), 384, 'a card that fits is filled');
  assert.equal(googleButtonWidth(358.7), 358, 'fractions round down so the button never overflows its slot');
  assert.equal(googleButtonWidth(120), 200, 'Google’s minimum');
  assert.equal(googleButtonWidth(0), 260, 'a hidden, not-yet-laid-out slot uses a middle width until it has one');
  assert.equal(googleButtonWidth(Number.NaN), 260);
});

test('the web slot and the native button are Google’s 40px “large” size, up to 400px wide', () => {
  const css = read('app/css/styles.css');
  assert.match(css, /\.social-compact \.social-g \{[^}]*max-width: 400px;[^}]*height: 40px;[^}]*min-height: 40px;/);
  assert.match(css, /\.social-compact \.social-g \{ contain: layout paint size; \}/);
  assert.match(css, /\.social-compact \.btn-social\.btn-google \{[^}]*max-width: 400px;[^}]*height: 40px;/);
});

test('the admin console shows Google at the same 40px size, centred in its slot', () => {
  const admin = read('admin/admin.css');
  assert.match(admin, /\.login-social \.social-g \{[^}]*align-items: center;[^}]*height: 40px;/);
  assert.doesNotMatch(admin, /\.login-social \.social-g \{[^}]*min-height: 44px/);
});

test('the web button is redrawn when its width changes, so a resized card never clips it', () => {
  const source = read('app/js/social.js');
  assert.match(source, /new ResizeObserver\(draw\)/);
  assert.match(source, /googleButtonWidth\(el\.getBoundingClientRect\(\)\.width\)/);
  assert.match(source, /if \(width === drawn\) return;/);
});
