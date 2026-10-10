import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
test('social buttons use official Google icon mode and accessible logo-only custom controls', () => {
  const source = read('app/js/social.js');
  assert.match(source, /renderButton\(real, \{ type: 'standard'.*shape: 'rectangular'/);
  // Google's button is the official white one: 'outline' theme (multicolor G on white), rectangular
  // shape, with a "Sign in/up with Google" label, in GIS mode and in the native/fallback button.
  assert.match(source, /theme: 'outline'/);
  assert.match(source, /text: signup \? 'signup_with' : 'signin_with'/);
  assert.match(source, /signup \? 'Sign up with Google' : 'Sign in with Google'/);
  assert.match(source, /class="btn-social btn-google" data-p="google"[^>]*>\$\{G_LOGO\}<span>\$\{gLabel\}<\/span>/);
  assert.match(source, /data-p="\$\{p\}" aria-label="Continue with/);
  assert.doesNotMatch(source, /<span>Continue with|<span>Google unavailable/);
  assert.match(source, /disabled aria-label="Google sign-in unavailable"/);
  assert.match(source, /box.classList.add\('social-compact'\)/);
  const css = read('app/css/styles.css');
  assert.match(css, /\.social-compact \.btn-social \{ width: 44px; height: 44px;/);
  assert.match(css, /\.social\.social-compact \{ display: flex; flex-wrap: wrap;/);
  // Google's own light-theme colors (#747775 stroke, #1F1F1F label) and 40px height; up to 400px wide.
  assert.match(css, /\.btn-social\.btn-google \{ background: #fff; border-color: #747775; color: #1f1f1f;.*border-radius: 4px/);
  assert.match(css, /\.social-compact \.btn-social\.btn-google \{ width: 100%; max-width: 400px;.*height: 40px;.*border-radius: 4px/);
});
