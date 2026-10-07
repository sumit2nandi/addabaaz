import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { accountNav } from '../../app/js/ui/account-nav.js';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('desktop navigation preserves filtered destinations and marks only the current page', () => {
  const groups = [
    { id: 'playback', title: 'Playback', ic: 'play', href: '#/account/playback' },
    { id: 'help', title: 'Help & support', ic: 'chat', href: '#/support' },
  ];
  const { document } = parseHTML(accountNav(groups, 'help').s);
  const nav = document.querySelector('nav');
  assert.equal(nav.getAttribute('aria-label'), 'Account settings');
  assert.equal(nav.querySelectorAll('a').length, 3);
  assert.equal(nav.querySelectorAll('[aria-current]').length, 1);
  assert.equal(nav.querySelector('[aria-current]').getAttribute('href'), '#/support');
  assert.equal(nav.querySelector('a').getAttribute('href'), '#/account');
  assert.equal(nav.querySelector('[href="#/account/security"]'), null);
});

test('desktop layouts cover settings and support without replacing mobile navigation', () => {
  const css = read('app/css/styles.css');
  assert.match(css, /\.account-sidebar \{ display: none; \}/);
  const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
  assert.match(desktop, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(desktop, /grid-template-columns: 250px minmax\(0, 1fr\)/);
  assert.match(desktop, /\.account-sidebar \{ display: grid;/);
  assert.match(read('app/js/views/settings.js'), /accountNav\(settingGroups\(\), meta.id\)/);
  assert.match(read('app/js/views/settings.js'), /pageBack\(ctx/);
  assert.match(read('app/js/views/support.js'), /accountNav\(settingGroups\(\), 'help'\)/);
});
