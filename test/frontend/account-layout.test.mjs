import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Account is a compact profile header over a settings-group list', () => {
  const css = read('app/css/styles.css');
  const account = read('app/js/views/account.js');
  const extras = read('app/js/views/account-extra.js');

  assert.match(css, /\.profile-head \{ display: flex; align-items: center;/,
    'the profile header is one compact row (avatar, name, actions)');
  assert.match(css, /\.profile-head h2 \{ font-size: 20px; \}/,
    'the profile name stays modest — the page is a list, not a hero');
  assert.match(css, /\.profile-actions \{[^}]*justify-content: flex-end/,
    'guest sign-in actions align to the right of the header');
  assert.match(css, /\.group-list \.row-link \+ \.row-link \{ border-top: 1px solid var\(--border\); \}/,
    'group rows are separated by hairlines');
  assert.match(css, /\.account-section:empty \{ display: none; \}/,
    'empty asynchronous sections collapse instead of leaving gaps');
  assert.match(account, /<section class="profile-head">[\s\S]*?avatar\(p, \{ size: 48 \}\)/,
    'the header shows a small avatar next to the name');
  assert.match(account, /<nav class="card-panel list group-list" aria-label="Settings">/,
    'the groups render as one labelled list');
  assert.match(account, /settingGroups\(\)\.map\(\(g\) => html`<a class="row-link\$\{g\.id === 'danger' \? ' danger' : ''\}" href="\$\{g\.href\}">/,
    'every group is a link row, with the delete row in the danger style');
  assert.match(account, /<footer class="profile-footer">/,
    'the page ends in a footer, not another settings card');
  assert.match(account, /<button class="logout-link" id="signout">Log Out<\/button>/,
    'Log Out is a plain blue line, like the reference footer');
  assert.match(account, /<a href="#\/privacy">Privacy Policy<\/a><span aria-hidden="true">•<\/span><a href="#\/terms">Terms of Use<\/a>/,
    'the footer links the Privacy Policy and Terms of Use');
  assert.match(account, /<p class="app-version">App Version \$\{CONFIG\.version\}<\/p>/,
    'the footer shows the app version');
  assert.match(css, /\.logout-link \{[^}]*color: #4da3ff/,
    'Log Out is bright blue on the dark background');
  assert.doesNotMatch(account.match(/<section class="profile-head">[\s\S]*?<\/section>/)[0], /id="signout"/,
    'Log Out no longer crowds the profile header');
  assert.doesNotMatch(account, /account-grid/,
    'the stacked settings grid is gone — groups open their own sub-pages');
  assert.doesNotMatch(account, /<h2 class="sub-h">/,
    'no settings section renders inline on the profile page anymore');
  assert.doesNotMatch(account, /sectionHeader/,
    'the page opens directly on the profile header, with no header above it');
  assert.doesNotMatch(account, /Who’s watching\?/,
    'profile switching lives in the profile menu, not on this page');
  assert.doesNotMatch(account, /Manage profiles/,
    'profile management lives in the profile menu, not on this page');
  assert.doesNotMatch(account, /<h2 class="sub-h">Explore<\/h2>/,
    'the Explore link list is gone (Studio pages stay in the Studio menu)');
  assert.match(extras, /\['security', 'Security', 'Password, sessions and devices', 'lock', 'account'\]/,
    'the group table keeps every setting, with per-group visibility');
  assert.match(extras, /\['help', 'Help & support', 'Help Centre and contact us', 'chat', 'all', '#\/support'\]/,
    'Help & support stays one tap away, leaving the page for the Support page');
  assert.match(account, /resendVerification/,
    'the email-confirm banner still offers a resend from this page');
  assert.doesNotMatch(extras, /#\/privacy/,
    'the Privacy Policy link lives in the profile footer now, not in the Privacy group');
  assert.doesNotMatch(extras, /#\/terms/,
    'same for the Terms of Use link');
});

test('unsubscribed website viewers get a Subscribe banner above the profile header', () => {
  const css = read('app/css/styles.css');
  const account = read('app/js/views/account.js');

  assert.match(account, /u\.supportsAuth && !u\.isPremium && !isNative \? html`<section class="card-panel subscribe-banner">/,
    'the banner shows only for unsubscribed viewers, on the website (never in native apps, never in local mode)');
  assert.match(account, /<a class="btn btn-light" href="#\/plans">Subscribe<\/a>/,
    'the banner links to the plans page');
  assert.match(account, /\$\{verifyBanner\(\)\}\s*\$\{u\.supportsAuth && !u\.isPremium && !isNative \? html`<section class="card-panel subscribe-banner">/,
    'the banner sits below the email-confirm strip and above the profile header');
  assert.match(account, /u\.isPremium \? html`<em class="premium-word premium-sup">premium<\/em>` : html`<em class="pill free">Free<\/em>`/,
    'the profile name carries a Free pill or a superscript premium exponent');
  assert.doesNotMatch(account, /<h2 class="sub-h">Access<\/h2>/,
    'the Access section is gone (billing lives on the plans page now)');
  assert.match(css, /\.premium-sup \{[^}]*font-size: 12\.5px[^}]*vertical-align: super/,
    'premium exponents are small and raised');
  assert.match(account, /<h2>Subscribe to <em class="premium-word">premium<\/em><\/h2>/,
    'the banner brands it premium in glittery gold, with no ADDABAAZ prefix');
  assert.match(css, /\.subscribe-banner \{[^}]*display: flex[^}]*margin-top: 0; margin-bottom: 14px/,
    'the banner hugs the top of the page with breathing room above the profile header');
  assert.match(css, /\.pill\.free \{[^}]*color: #fff/,
    'the Free badge is bold white');
});
