// Each profile settings group opens its own sub-page behind /account/<group>; the profile page
// itself only lists the groups. The group table lives in account-extra.js so the list and the
// sub-pages can never disagree about what exists.
// Run: node --test test/frontend/settings-layout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('every settings group opens its own sub-page', () => {
  const routes = read('app/js/routes.js');
  const view = read('app/js/views/settings.js');
  const extras = read('app/js/views/account-extra.js');
  const css = read('app/css/styles.css');

  assert.match(routes, /\['\/account\/:group', 'settings'\]/,
    'the router maps /account/<group> to the settings view');
  assert.match(view, /settingGroups\(\)\.find\(\(g\) => g\.id === ctx\.params\.group\)/,
    'the sub-page looks the group up in the shared table, so list and pages agree');
  assert.match(view, /if \(!meta \|\| !body\) \{ go\('\/account', \{ replace: true \}\); return; \}/,
    'unknown groups — and groups hidden from this viewer — bounce back to the profile page');
  assert.match(view, /ctx\.setTitle\(meta\.title\)/,
    'the tab title names the group');
  assert.match(view, /class="page page-narrow account-page/,
    'sub-pages keep the account styling scope (red actions included)');
  assert.match(view, /ctx\.params\.group === 'danger'\) \{ go\('\/delete-account', \{ replace: true \}\); return; \}/,
    'danger is the delete-account page now, so the group redirects there');
  assert.match(view, /pageBack\(ctx/,
    'every sub-page offers a way back to the profile page');
  assert.match(view, /wireSetting\(meta\.id, ctx\.root, ctx\)/,
    'the sub-page wires its section once it is in the DOM');
  assert.match(css, /\.back-link \{ display: inline-flex; align-items: center;/,
    'the back link is a tap-friendly row');
  for (const id of ['playback', 'security', 'kids', 'refer', 'notify']) {
    assert.match(extras, new RegExp(`if \\(id === '${id}'\\) return `),
      `the ${id} group has a sub-page section`);
  }
  for (const id of ['playback', 'security', 'kids', 'refer', 'notify']) {
    assert.match(extras, new RegExp(`if \\(id === '${id}'\\) return wire`),
      `the ${id} group has its wiring hooked up`);
  }
  assert.match(extras, /<section class="account-section">\s*<h2 class="sub-h">Security<\/h2>/,
    'the Security section keeps its heading');
  assert.match(extras, /<div id="referSlot" class="account-section"><\/div>/,
    'Refer & earn keeps its asynchronous slot');
  assert.match(extras, /<div id="notifySlot" class="account-section"><\/div>/,
    'notifications keep their asynchronous slot');
  assert.match(extras, /title: 'Refer & Earn Is Off'/,
    'an empty Refer & earn page explains itself instead of rendering blank');
  assert.match(extras, /title: 'Notifications Unavailable'/,
    'an empty Notifications page explains itself instead of rendering blank');
  assert.match(extras, /install the ADDABAAZ app to get episode, launch and announcement alerts/,
    'browsers without push (iPhone Safari tabs) get an honest explanation, not a dead toggle');
  assert.match(extras, /title: 'Sign In for Notifications'/,
    'signed-out viewers are pointed at sign-in instead of a dead end');
  assert.match(extras, /\['notify', 'Notifications', '[^\]]*'auth'\]/,
    'guests keep their notifications group');
  assert.doesNotMatch(extras, /\['danger',/,
    'deletion lives on its own page now — the danger group redirects instead of listing a row');
});
