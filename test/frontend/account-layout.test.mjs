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
  assert.match(account, /settingGroups\(\)\.map\(accountGroup\)/);
  assert.match(account, /wireAccountAccordion\(ctx.root, settingSection, wireSetting, ctx\)/);
  assert.match(account, /<footer class="profile-footer">/,
    'the page ends in a footer, not another settings card');
  assert.match(account, /<button class="logout-link" id="signout">Sign out<\/button>/);
  assert.doesNotMatch(account, /profile-legal|app-version|Log Out/,
    'duplicate legal links and the version are removed from the profile footer');
  const index = read('index.html');
  assert.match(index, /<\/nav>\s*<\/div>\s*<p class="app-version" id="appVersion"><\/p>\s*<\/footer>/,
    'the version is below the main footer navigation');
  assert.match(read('app/js/ui/shell.js'), /version.textContent = `App Version \$\{CONFIG.version\}`/);
  assert.match(css, /\.logout-link \{[^}]*color: var\(--accent-2\)/,
    'Sign out uses the brighter theme red');
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
  assert.doesNotMatch(extras, /\['privacy',/,
    'the Privacy group is gone from the menu (its choices live in the footer)');
  assert.doesNotMatch(extras, /\['app',/,
    'so is the App group (install stays global, the version is in the footer)');
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

test('deletion action follows the public details and the profile footer stays compact', () => {
  const deletion = read('app/js/views/deletion.js');
  assert.doesNotMatch(read('app/js/views/account-extra.js'), /\['danger',/);
  assert.ok(deletion.indexOf('id="delAcc"') > deletion.indexOf('Privacy contact:'));
  assert.match(deletion, /app.user.account \? html`/);
  assert.match(deletion, /wireAccountDeletion\(ctx.root\)/);
  assert.match(read('app/js/views/account-extra.js'), /export function wireAccountDeletion[\s\S]*confirmDialog[\s\S]*u.deleteAccount\(\)/);
  assert.doesNotMatch(read('index.html').match(/<footer[\s\S]*?<\/footer>/)[0], /Coming Soon/);
  assert.match(read('app/css/styles.css'), /\.profile-page \{ padding-bottom: 8px; \}/);
  assert.match(read('app/css/styles.css'), /:has\(\.profile-page\) \.footer \{ margin-top: 8px; \}/);
});
