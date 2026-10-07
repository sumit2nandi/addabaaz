import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Account keeps its single-column mobile layout and widens to two columns on desktop', () => {
  const css = read('app/css/styles.css');
  const account = read('app/js/views/account.js');
  const extras = read('app/js/views/account-extra.js');

  assert.match(css, /\.account-grid \{ display: grid; grid-template-columns: minmax\(0, 1fr\); align-items: start; \}/,
    'the Account sections stay in one column by default for mobile and app webviews');
  assert.match(css, /@media \(min-width: 900px\) \{\s*\.page\.account-page \{ max-width: 1320px; \}\s*\.who \{ grid-template-columns: auto minmax\(0, 1fr\) auto; \}\s*\.who-actions \{ grid-column: auto; \}\s*\.account-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    'desktop Account uses a wider profile row and a two-column settings grid');
  assert.match(css, /\.who-actions \{[^}]*justify-content: flex-end/,
    'profile actions, including Sign out, align to the right');
  assert.match(css, /\.account-section:empty \{ display: none; \}/,
    'empty asynchronous sections do not leave gaps in the desktop grid');
  assert.doesNotMatch(account.match(/<section class="card-panel who">[\s\S]*?<\/section>/)[0], /id="signout"/,
    'Sign out no longer crowds the profile card');
  assert.match(account, /<p class="signout-wrap"><button class="btn btn-ghost" id="signout">/,
    'Sign out lives as a quiet row at the bottom of the page');
  assert.match(account, /<div class="account-grid">[\s\S]*?<section class="account-section">\s*<h2 class="sub-h">Playback<\/h2>/,
    'static Account settings are grouped as responsive grid sections');
  assert.doesNotMatch(account, /sectionHeader/,
    'the page opens directly on the profile card, with no header above it');
  assert.doesNotMatch(account, /Who’s watching\?/,
    'profile switching lives in the profile menu, not on this page');
  assert.doesNotMatch(account, /Manage profiles/,
    'profile management lives in the profile menu, not on this page');
  assert.doesNotMatch(account, /<h2 class="sub-h">Explore<\/h2>/,
    'the Explore link list is gone (Studio pages stay in the Studio menu)');
  assert.match(extras, /<section class="account-section">\s*<h2 class="sub-h">Security<\/h2>/,
    'security settings participate in the desktop grid');
  assert.match(extras, /<div id="referSlot" class="account-section"><\/div>/,
    'the asynchronous referral slot participates in the grid');
  assert.match(extras, /<div id="notifySlot" class="account-section"><\/div>/,
    'the asynchronous notification slot participates in the grid');
});

test('unsubscribed website viewers get a Subscribe banner above the settings grid', () => {
  const css = read('app/css/styles.css');
  const account = read('app/js/views/account.js');

  assert.match(account, /u\.supportsAuth && !u\.isPremium && !isNative \? html`<section class="card-panel subscribe-banner">/,
    'the banner shows only for unsubscribed viewers, on the website (never in native apps, never in local mode)');
  assert.match(account, /<a class="btn btn-light" href="#\/plans">Subscribe<\/a>/,
    'the banner links to the plans page');
  assert.match(account, /\$\{extras\.banner\}\s*\$\{u\.supportsAuth && !u\.isPremium && !isNative \? html`<section class="card-panel subscribe-banner">/,
    'the banner sits above the profile card');
  assert.match(account, /u\.isPremium \? html`<em class="premium-word premium-sup">premium<\/em>` : html`<em class="pill free">Free<\/em>`/,
    'the profile name carries a Free pill or a superscript premium exponent');
  assert.doesNotMatch(account, /<h2 class="sub-h">Access<\/h2>/,
    'the Access section is gone (billing lives on the plans page now)');
  assert.match(css, /\.premium-sup \{[^}]*font-size: 12\.5px[^}]*vertical-align: super/,
    'premium exponents are small and raised');
  assert.match(account, /<h2>Subscribe to <em class="premium-word">premium<\/em><\/h2>/,
    'the banner brands it premium in glittery gold, with no ADDABAAZ prefix');
  assert.match(css, /\.subscribe-banner \{[^}]*display: flex[^}]*margin-top: 0; margin-bottom: 14px/,
    'the banner hugs the top of the page with breathing room above the profile card');
  assert.match(css, /\.pill\.free \{[^}]*color: #fff/,
    'the Free badge is bold white');
});
