import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
test('social buttons use official Google icon mode and accessible logo-only custom controls', () => {
  const source = read('app/js/social.js');
  assert.match(source, /renderButton\(real, \{ type: 'standard'.*shape: 'rectangular'/);
  assert.match(source, /data-p="\$\{p\}" aria-label="Continue with/);
  assert.doesNotMatch(source, /<span>Continue with|<span>Google unavailable/);
  assert.match(source, /disabled aria-label="Google sign-in unavailable"/);
  assert.match(source, /box.classList.add\('social-compact'\)/);
  const css = read('app/css/styles.css');
  assert.match(css, /\.social-compact \.btn-social \{ width: 44px; height: 44px;/);
  assert.match(css, /\.social\.social-compact \{ display: flex; flex-wrap: wrap;/);
});
