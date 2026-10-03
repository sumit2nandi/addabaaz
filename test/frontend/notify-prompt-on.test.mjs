// The first-run notifications prompt must let go the moment notifications are on.
//
// Production bug this pins down: the prompt could stay on screen after the viewer had already allowed
// notifications — allowed in the browser dialog, ticked on the Account page, or enabled on another device.
// The switch itself is covered by server/test/... and app/js/push.js; here we check the prompt's own rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the prompt closes itself as soon as notifications are on', () => {
  const np = read('app/js/notify-prompt.js');
  assert.match(np, /async function notificationsOn\(\)/, 'it can ask whether this install already has them');
  assert.match(np, /state\?\.subscribed/, 'which means a real subscription, not just permission');
  assert.match(np, /function watchEnabled\(on\)/, 'and it watches for them being turned on');
  assert.match(np, /stop = watchEnabled\(\(\) => \{ if \(!done\) finish\(true\); \}\)/, 'closing the prompt when they are');
  assert.match(np, /live = null;/, 'and forgetting the open prompt so a later visit can ask again if needed');
  // Never show it when the answer is already known.
  assert.match(np, /if \(await notificationsOn\(\)\) \{ remember\(\); return false; \}/);
  assert.match(np, /turned on while we were waiting/, 'a second check after the delay');
  assert.match(np, /const vis = \(\) => \{ if \(!document\.hidden\) notificationsOn\(\)/, 'and when the tab comes back');
});

test('every way of enabling notifications announces itself so the prompt can react', () => {
  const push = read('app/js/push.js');
  assert.match(push, /const announce = \(\) => \{ try \{ app\.user\?\.emit\?\.\('push'\); \}/, 'one place to announce a change');
  const calls = (push.match(/announce\(\)/g) || []).length;
  assert.ok(calls >= 5, `every state-changing call announces (found ${calls})`);
  for (const fn of ['enablePush', 'disablePush', 'setPushPrefs', 'detachPush']) assert.ok(push.includes(`export async function ${fn}`), `${fn} exists`);
  // The Account page's listener was dead code before: nothing ever emitted `push`.
  assert.match(read('app/js/views/account-extra.js'), /app\.user\.on\('push', refresh\)/, 'the Account switch refreshes from it');
});

test('the browser’s own permission change is noticed too', () => {
  const np = read('app/js/notify-prompt.js');
  assert.match(np, /navigator\.permissions\?\.query\?\.\(\{ name: 'notifications' \}\)/, 'permissions.query');
  assert.match(np, /p\.addEventListener\('change', h\)/, 'listen for the change');
  assert.match(np, /p\.removeEventListener\('change', h\)/, 'and clean up after the prompt closes');
  assert.match(np, /for \(const f of off\)/, 'all watchers are removed when the prompt is done');
});
