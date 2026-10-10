import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('sign-in and signup share a compact scoped layout without hiding auth methods or navigation', () => {
  const view = read('app/js/views/auth.js');
  assert.match(view, /class="page auth-page auth-entry"/);
  for (const id of ['emailPane', 'otpPane', 'social', 'authClose', 'pwt', 'as']) assert.ok(view.includes(`id="${id}"`));
  for (const href of ['#/forgot', '#/support', '#/terms', '#/privacy']) assert.ok(view.includes(href));
  assert.match(view, /class="auth-footer-links"/);
  assert.match(view, /signup \? 'Create account' : 'Welcome back'/);
});

test('mobile compaction retains readable inputs, tap targets and page scrolling', () => {
  const css = read('app/css/styles.css');
  const compact = css.slice(css.indexOf('/* Compact sign-in/sign-up only;'));
  assert.match(compact, /@media \(max-width: 599px\)/);
  assert.match(compact, /min-height: 0; align-content: start/);
  assert.match(compact, /font-size: 16px; min-height: 44px/);
  assert.doesNotMatch(read('app/js/views/auth.js'), /auth-brand|classList.add\('bare'\)/);
  assert.match(compact, /\.auth-entry \.auth-card \{ background: transparent; border: 0/);
  assert.match(compact, /#otpVerify \{ margin-bottom: 0;/);
  assert.doesNotMatch(compact.replace(/\.auth-entry \.auth-field-label \{[^}]*\}/g, ''), /overflow: hidden|height: 100dvh/);
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

test('placeholder-led fields retain accessible labels and full-width submit buttons', () => {
  const source = read('app/js/views/auth.js');
  assert.match(source, /class="auth-field-label">Email<\/span>/);
  assert.match(source, /class="auth-field-label">Password<\/span>/);
  assert.match(source, /placeholder="Email address"/);
  assert.match(source, /class="btn btn-primary btn-lg block" type="submit" id="asub">\$\{signup \? 'Create account' : 'Sign in'\}/);
  assert.doesNotMatch(source, /auth-submit-circle|auth-submit-row/);
  assert.match(read('app/css/styles.css'), /\.auth-entry \.auth-field-label \{[^}]*clip-path: inset\(50%\)/);
});

test('sign-in and sign-up do not slide in on load, and the Google slot keeps its size', () => {
  const css = read('app/css/styles.css');
  assert.match(css, /\.view:has\(> \.auth-page\) \{ animation: none; \}/);
  assert.match(css, /\.social-compact \.social-g \{ position: relative; width: 100%; max-width: 400px; flex: 0 0 100%; height: 40px;/);
});

test('pull-to-refresh does not redraw sign-in or sign-up (it rebuilds the Google button)', () => {
  const main = read('app/js/main.js');
  assert.match(main, /if \(\/\^\\\/\(signin\|signup\)\\\/\?\$\/\.test\(parseLocation\(\)\.path\)\) return 'refreshed';/);
  assert.ok(main.indexOf("return 'refreshed'") < main.indexOf('await app.router.refresh()'));
});

test('the Google slot is fixed-size and contained, and Google\'s own button is left unsized', () => {
  const css = read('app/css/styles.css');
  assert.match(css, /\.social-compact \.social-g \{ contain: layout paint size; \}/);
  assert.doesNotMatch(css, /social-g iframe/);
});

test('desktop sign-in/sign-up is a two-panel card while phones keep the compact column', () => {
  const view = read('app/js/views/auth.js');
  assert.match(view, /<aside class="auth-side">/);
  assert.match(view, /<div class="auth-main">/);
  const css = read('app/css/styles.css');
  assert.match(css, /\.auth-side \{ display: none; \}/);
  assert.match(css, /\.auth-main \{ display: contents; \}/);
  const desktop = css.slice(css.indexOf('.auth-side { display: none; }'));
  assert.match(desktop, /@media \(min-width: 900px\) \{\s*\.auth-page\.auth-entry \{ padding: 56px/);
  assert.match(desktop, /\.auth-entry \.auth-card \{[^}]*grid-template-columns: minmax\(300px, 400px\) minmax\(0, 1fr\)/);
  assert.match(desktop, /\.auth-entry \.auth-side \{ display: flex/);
  assert.match(desktop, /\.auth-entry \.auth-main \{ display: grid; align-content: start/);
  assert.doesNotMatch(desktop, /overflow: hidden|height: 100dvh/);
});
