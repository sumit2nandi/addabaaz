import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('sign-in and signup share a compact scoped layout without hiding auth methods or navigation', () => {
  const view = read('app/js/views/auth.js');
  assert.match(view, /class="auth-page auth-entry"/);
  for (const id of ['emailPane', 'otpPane', 'social', 'authClose', 'pwt', 'as']) assert.ok(view.includes(`id="${id}"`));
  for (const href of ['#/forgot', '#/support', '#/terms', '#/privacy']) assert.ok(view.includes(href));
  assert.match(view, /class="auth-footer-links"/);
  assert.match(view, /signup \? 'Create account' : 'Welcome back'/);
});

test('mobile compaction retains readable inputs, tap targets and page scrolling', () => {
  const css = read('app/css/styles.css');
  const compact = css.slice(css.indexOf('/* Compact sign-in/sign-up only;'));
  assert.match(compact, /@media \(max-width: 599px\)/);
  assert.match(compact, /min-height: 100svh; align-content: start/);
  assert.match(compact, /font-size: 16px; min-height: 44px/);
  assert.match(compact, /\.auth-brand img \{ width: 36px; height: 36px;/);
  assert.match(compact, /#otpVerify \{ margin-bottom: 0;/);
  assert.doesNotMatch(compact, /overflow: hidden|height: 100dvh/);
});

test('auth fields use minimalist underlines including the phone prefix group', () => {
  const css = read('app/css/styles.css');
  const minimal = css.slice(css.indexOf('/* Minimal underline inputs'));
  assert.match(minimal, /\.auth-entry \.form input:not\(\[type=checkbox\]\) \{\s*background: transparent;\s*border: 0;\s*border-bottom: 1px solid var\(--muted\);\s*border-radius: 0;\s*box-shadow: none;/);
  assert.match(minimal, /font-size: 16px/);
  assert.match(minimal, /min-height: 44px/);
  assert.match(minimal, /:focus \{[^}]*border-bottom-color: var\(--accent-2\)/);
  assert.match(minimal, /\.otp-phone \{[^}]*border-bottom: 1px solid var\(--muted\); border-radius: 0/);
  assert.match(minimal, /\.otp-phone:focus-within/);
  assert.match(minimal, /\.pw input:not\(\[type=checkbox\]\) \{ padding-right: 46px;/);
});
