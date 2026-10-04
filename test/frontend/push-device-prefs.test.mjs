// The app's notification settings: the same three switches the browser has, on the device's own row.
//
// Reported from a phone: "Why does notifications in app only show this one option whereas web shows
// multiple?" — the web kept three per-subscription choices (episodes / launches / news) and the app kept
// none, so Account → Notifications had only the master switch. This pins the client wiring; the live
// audience filtering runs against MySQL in server/test/engagement.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the settings screen shows the three switches on the app too', () => {
  const view = read('app/js/views/account-extra.js');
  // The old rule was `s.subscribed && !s.native`, which is exactly why the app showed one row.
  assert.doesNotMatch(view, /s\.subscribed && !s\.native/, 'the app is no longer excluded');
  assert.match(view, /const topics = s\.subscribed && \(!s\.native \|\| !s\.guest\);/, 'a signed-in app gets the topics; a guest app has no account to target them with');
  for (const label of ['New episodes of shows I follow', 'When a Coming Soon title launches', 'Announcements &amp; offers']) {
    assert.match(view, new RegExp(label.replace(/&/g, '&')), `${label} is offered`);
  }
  assert.match(view, /data-pp="episodes"/); assert.match(view, /data-pp="launches"/); assert.match(view, /data-pp="news"/);
});

test('the app sends the choices to the device row, keyed by its FCM token', () => {
  const native = read('app/js/push-native.js');
  assert.match(native, /export async function setNativePushPrefs\(prefs\)/, 'a native setter exists');
  assert.match(native, /await u\.remote\.devicePrefs\(token, prefs\);/, 'it writes to the device token');
  assert.match(native, /const prefs = token \? \(await u\.remote\.deviceStatus\?\.\(token\)\.catch\(\(\) => \(\{\}\)\)\)\?\.prefs : null;/, 'and reads the stored choices back for the screen');
  assert.match(native, /prefs \|\| \{ episodes: true, launches: true, news: false \}/, 'falling back to the server defaults');
  const push = read('app/js/push.js');
  assert.match(push, /export async function setPushPrefs\(prefs\) \{ if \(nativePushSupported\(\)\) return setNativePushPrefs\(prefs\);/, 'setPushPrefs routes to it instead of returning early');
  assert.doesNotMatch(push, /setPushPrefs\(prefs\) \{ if \(nativePushSupported\(\)\) return;/, 'the old no-op is gone');
  const adapters = read('app/js/data/adapters.js');
  assert.match(adapters, /deviceStatus\(token\) \{ return this\.api\.post\('\/devices\/status', \{ token \}\); \}/);
  assert.match(adapters, /devicePrefs\(token, prefs\) \{ return this\.api\.patch\('\/devices\/prefs', \{ token, \.\.\.prefs \}\); \}/);
  assert.match(adapters, /registerDevice\(token, platform = 'android', label = null, prefs = null\)/, 'registration can carry them too');
});

test('the server keeps them per device and filters the targeted audiences', () => {
  const migration = read('server/migrations/019_push_device_prefs.sql');
  assert.match(migration, /ALTER TABLE push_devices\n  ADD COLUMN episodes TINYINT\(1\) NOT NULL DEFAULT 1,/, 'episodes default on');
  assert.match(migration, /ADD COLUMN launches TINYINT\(1\) NOT NULL DEFAULT 1,/, 'launches default on');
  assert.match(migration, /ADD COLUMN news     TINYINT\(1\) NOT NULL DEFAULT 0;/, 'announcements default off, like the browser');
  assert.equal(/ALTER TABLE push_devices/.test(read('server/migrations/019_push_device_prefs.sql')), true);

  const db = read('server/src/db-extra.js');
  assert.match(db, /async getPrefs\(hash\)/, 'choices are read by token hash');
  assert.match(db, /async setPrefs\(hash, prefs\)/, 'and written the same way');
  assert.match(db, /INSERT INTO push_devices \(id, user_id, platform, token_hash, token, label, episodes, launches, news\)/, 'registration stores them');
  assert.match(db, /ON DUPLICATE KEY UPDATE user_id = VALUES\(user_id\), token = VALUES\(token\)/, 'a re-registration keeps them (the apps send the token on every start)');
  // The three audience kinds mirror the browser's filters.
  assert.match(db, /if \(a\.kind === 'episodes'\) \{\n        const vids[\s\S]{0,120}pd\.episodes = 1 AND/, 'episodes audience filters on the switch');
  assert.match(db, /else if \(a\.kind === 'launches'\) rows = await q\(`\$\{sel\} WHERE pd\.launches = 1 AND/, 'launches too');
  assert.match(db, /else if \(a\.kind === 'news'\) rows = await q\(`\$\{sel\} WHERE pd\.news = 1`\)/, 'and announcements');
  assert.match(db, /else if \(a\.kind === 'user'\) rows = await q\(`\$\{sel\} WHERE pd\.user_id = \?`/, 'a test send reaches the admin’s own devices regardless');

  const features = read('server/src/features.js');
  assert.match(features, /api\.post\('\/devices\/status'/, 'the status route exists');
  assert.match(features, /api\.patch\('\/devices\/prefs'/, 'the write route exists');
  assert.match(features, /if \(v !== undefined && typeof v !== 'boolean'\) throw bad\('Notification choices must be true or false\.'\)/, 'and is validated');
  assert.match(features, /guestDeviceLimit/, 'both sit behind the guest rate limit, since they work by token possession');
});

test('the docs describe the app switches, not only the browser ones', () => {
  assert.match(read('docs/ENGAGEMENT.md'), /migration 019/, 'the engagement doc names the migration');
  assert.match(read('docs/ENGAGEMENT.md'), /Account → Notifications screen shows the same switches on the web and in the app/);
  assert.match(read('docs/MOBILE.md'), /same three notification switches as the website/);
  assert.match(read('docs/DATABASE.md'), /preference flags as a browser subscription/);
});
