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

  // On the Account Overview / Edit Account pages the sidebar's own link is the current one.
  const overview = parseHTML(accountNav(groups, 'overview').s).document.querySelector('nav');
  assert.equal(overview.querySelectorAll('[aria-current]').length, 1);
  assert.equal(overview.querySelector('[aria-current]').getAttribute('href'), '#/account');
  assert.equal(overview.querySelector('[aria-current]').classList.contains('account-overview'), true);
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
  const accountDetails = read('app/js/views/account-details.js');
  assert.match(accountDetails, /class="account-edit-header"><a class="page-back"[\s\S]*?<\/a><h1>Edit Account<\/h1>/,
    'account details places a plain arrow immediately before its page title');
  assert.match(css, /\.account-edit-header \{ display: flex; align-items: center;/,
    'the account details title and arrow share one row');
  assert.match(read('app/js/views/support.js'), /accountNav\(settingGroups\(\), 'help'\)/);
});

test('Account overview and Edit Account join the desktop sidebar layout (phones keep the stacked flow)', () => {
  const css = read('app/css/styles.css');
  const account = read('app/js/views/account.js');
  const details = read('app/js/views/account-details.js');
  for (const [name, src] of [['account', account], ['account-details', details]]) {
    assert.match(src, /<div class="account-layout">\$\{accountNav\(settingGroups\(\), 'overview'\)\}<div class="account-content">/,
      `${name} wraps its content in the shared sidebar + content shell`);
  }
  assert.match(account, /import \{ accountNav \} from '\.\.\/ui\/account-nav\.js';/);
  assert.match(details, /import \{ accountNav \} from '\.\.\/ui\/account-nav\.js';/);
  assert.match(css, /\.profile-page, \.settings-page, \.support-page, \.account-details-page \{ max-width: 1200px; padding-top: 36px; \}/,
    'the details page gets the same desktop width as the other account pages');
  assert.match(css, /\.account-sidebar \{ display: none; \}/,
    'below 1024px the sidebar stays hidden, so phones keep the existing single-column flow');
  const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
  assert.match(desktop, /\.account-layout \{ display: grid; grid-template-columns: 250px minmax\(0, 1fr\)/,
    'on desktop the account pages become sidebar + content');
});
