// Admin → Broadcast: the console section that sends an announcement to viewers over app push
// (native FCM tokens + browser Web Push) or e-mail, with a test send and live progress.
//
// These are source pins: the page is a plain ES module loaded on demand, and the pieces it relies on
// span the console, the server and the mobile shell, so a change in any of them would silently break
// broadcasting without failing any other test.
// Run: node --test test/frontend/broadcast-admin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const view = read('admin/js/views/notifications.js');
const main = read('admin/js/main.js');
const adminServer = read('server/src/admin.js');
const extra = read('server/src/admin-extra.js');
const app = read('server/src/app.js');
const unsubscribeRoute = read('server/src/routes/unsubscribe.js');
const campaigns = read('server/src/campaigns.js');
const fcm = read('server/src/fcm.js');
const features = read('server/src/features.js');
const emails = read('server/src/emails.js');
const jobs = read('server/src/jobs.js');
const migration = read('server/migrations/011_notifications.sql');
const guestMigration = read('server/migrations/013_guest_push_devices.sql');
const sw = read('sw.js');
const mobilePkg = JSON.parse(read('mobile/package.json'));

test('the console has a Broadcast section that offers both channels', () => {
  assert.match(main, /\['notifications', 'Broadcast', 'bell'\]/, 'the sidebar links to Broadcast');
  assert.match(main, /\/\^notifications\$\/, \(\) => import\('\.\/views\/notifications\.js'\)/, 'the route still loads the page');
  assert.match(view, /data-ch="\$\{v\}"/, 'the two composers are tab-switched');
  assert.match(view, /\[\['push', 'App push', 'bell'\], \['email', 'E-mail', 'mail'\]\]/, 'App push and E-mail are the channels');
  // Composer fields: audience, title, message, link (+ optional button label for e-mail).
  assert.match(view, /name="audience"/); assert.match(view, /name="title"/); assert.match(view, /name="body"/); assert.match(view, /name="url"/); assert.match(view, /name="button"/);
  // Both channels go through one endpoint, with the channel in the body.
  assert.match(view, /api\.post\('\/notifications\/send', payload\(\)\)/);
  assert.match(view, /const payload = \(\) => \(\{ channel, audience: form\.audience\.value, title: form\.title\.value, body: form\.body\.value, url: form\.url\.value/);
  // Test sends, and the live progress poller.
  assert.match(view, /api\.post\('\/notifications\/test', payload\(\)\)/, 'Send a test to me');
  assert.match(view, /`\/notifications\/\$\{id\}`|api\.get\('\/notifications'\)/, 'progress is polled while sending');
  assert.match(view, /!done\(c\.status\)/, 'the poller only runs while a broadcast is in flight');
  assert.match(view, /ctx\.stale\(\)/, 'the poller stops when the page is left');
  // Nothing may go back to the old push-only wording/flow.
  assert.doesNotMatch(view, /web-push message to viewers/, 'the old push-only subtitle is gone');
});

test('the server exposes the broadcast API: send, status, test, devices, unsubscribe', () => {
  assert.match(extra, /router\.post\('\/notifications\/send'/, 'POST /admin/notifications/send');
  assert.match(extra, /router\.get\('\/notifications\/:id'/, 'GET /admin/notifications/:id (progress)');
  assert.match(extra, /router\.post\('\/notifications\/test'/, 'POST /admin/notifications/test');
  assert.match(extra, /const channel = b\.channel === 'email' \? 'email' : 'push'/, 'the channel is chosen by the request');
  assert.match(extra, /mailConfigured\(\)/, 'e-mail needs SMTP');
  assert.match(extra, /pushConfigured\(\)/, 'push needs VAPID or FCM');
  assert.match(extra, /campaigns\.start\(/, 'sending is handed to the campaign engine');
  assert.match(extra, /status\(202\)/, 'sending answers 202 (it runs in the background)');
  // E-mail audiences are the Users-page filters.
  assert.match(extra, /EMAIL_AUDIENCES = \[/);
  for (const id of ['all', 'paid', 'free', 'expiring', 'expired']) assert.match(extra, new RegExp(`id: '${id}'`));
  // The unsubscribe link is signed and needs no session.
  assert.match(unsubscribeRoute, /api\.get\('\/notifications\/unsubscribe'/, 'public unsubscribe route');
  assert.match(app, /crypto\.createHmac\('sha256', secret\)\.update\(`unsub:\$\{userId\}`\)/, 'the link is signed with the session secret');
  assert.match(app, /unsubscribeUrlFor/, 'campaign e-mails carry the link');
  // Device registration for the native apps.
  assert.match(features, /api\.post\('\/devices'/); assert.match(features, /api\.delete\('\/devices'/); assert.match(features, /api\.get\('\/devices'/);
  assert.match(features, /db\.devices\.upsert\(req\.user\.id, \{ hash: endpointHash\(token\)/, 'tokens are stored hashed');
});

test('campaigns send in the background, e-mail respects unsubscribes, and interrupted sends resume', () => {
  assert.match(campaigns, /export function createCampaigns\(/, 'the engine exists');
  assert.match(campaigns, /setImmediate\(\(\) => svc\.run\(id, opts\)/, 'push/e-mail sending is not awaited by the request');
  assert.match(campaigns, /db\.campaigns\.progress\(/, 'progress is written as it sends');
  assert.match(campaigns, /emailAudience\(campaign\.audience, \{ limit: pageSize, offset: cursor \}\)/, 'e-mail goes out in pages');
  assert.match(campaigns, /unsubscribeUrl: unsubscribeUrlFor \? unsubscribeUrlFor\(u\) : ''/, 'every campaign mail carries the unsubscribe link');
  assert.match(campaigns, /async resume\(/, 'a deploy-interrupted broadcast can continue');
  assert.match(jobs, /campaigns\?\.resume\(\{ resolveAudience: audienceResolver/, 'the housekeeping job resumes them at boot');
  assert.match(jobs, /export function audienceResolver/, 'show/launch audiences are resolved from the catalog on resume');
  assert.match(app, /app\.locals\.campaigns = campaigns/, 'index.js can reach the engine');
  assert.match(read('server/src/index.js'), /campaigns: app\.locals\.campaigns/, 'and passes it to the jobs');
  // The e-mail template: subject/body from the composer + the unsubscribe footer.
  assert.match(emails, /export function campaignEmail\(/, 'the announcement template exists');
  assert.match(emails, /String\(o\.body \|\| ''\)\.split\(\/\\n\{2,\}\/\)/, 'blank lines become paragraphs');
  assert.match(emails, /unsubscribeUrl/, 'the footer carries the unsubscribe link');
});

test('app push uses FCM with the service-account env, and dead tokens are cleaned up', () => {
  assert.match(fcm, /export function createFcm\(/, 'the FCM sender exists');
  assert.match(fcm, /messages:send/); assert.match(fcm, /oauth2\.googleapis\.com\/token/);
  assert.match(fcm, /FCM_SERVICE_ACCOUNT_FILE/); assert.match(fcm, /FCM_SERVICE_ACCOUNT\b/);
  assert.match(fcm, /UNREGISTERED\|NOT_FOUND\|INVALID_ARGUMENT/, 'unregistered tokens are detected');
  assert.match(read('server/src/push.js'), /nativeConfigured/, 'push.notify reports/uses the native channel');
  assert.match(read('server/src/push.js'), /db\.devices\.removeHash\(endpointHash\(t\)\)/, 'dead tokens are deleted');
  assert.match(app, /fcmFromEnv\(\)/, 'the server builds the FCM service from the environment');
  assert.match(adminServer, /item\('apppush', 'App push'/, 'the dashboard checklist reports app push');
});

test('the databases pieces exist and the app registers its token', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS push_devices/, 'native device tokens');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS campaigns/, 'broadcast history + progress');
  assert.match(migration, /ALTER TABLE users ADD COLUMN email_opt_out_at/, 'unsubscribe flag');
  assert.match(read('server/src/db-extra.js'), /const campaigns = \{/, 'db.campaigns');
  assert.match(read('server/src/db-extra.js'), /const devices = \{/, 'db.devices');
  assert.match(read('server/src/db-admin.js'), /async emailAudience\(/, 'e-mail audiences come from the Users filters');
  assert.match(read('server/src/db-admin.js'), /async setEmailOptOut\(/, 'unsubscribe is honoured');
  // The Android app: guest-default registration, account association, opt-out and tap → page.
  assert.match(read('app/js/native-messaging-plugin.js'), /Plugins\?\.FirebaseMessaging/, 'uses Capacitor native bridge plugin proxies in plain HTML apps');
  assert.match(read('app/js/native-messaging-plugin.js'), /registerPlugin\('FirebaseMessaging'\)/, 'supports Capacitor module-runtime registration too');
  assert.match(read('app/js/push-native.js'), /P\.getToken\(\)/, 'native app push uses FCM registration tokens');
  assert.match(read('app/js/push-native.js'), /tokenReceived/, 'rotated FCM tokens are re-registered');
  assert.match(read('app/js/push-native.js'), /u\.remote\.registerDevice\(token/, 'signed-in token is registered with the API');
  assert.match(read('app/js/push-native.js'), /u\.remote\.registerGuestDevice\(token/, 'guest token is registered without sign-in');
  assert.match(read('app/js/push-native.js'), /OPT_OUT_KEY/, 'the device can explicitly opt out');
  assert.match(read('app/js/push-native.js'), /detachNativePush/, 'sign-out and opt-out detach the right audience');
  assert.match(read('app/js/push.js'), /if \(nativePushSupported\(\)\) \{ initNativePush\(\); return; \}/, 'push.js routes native builds to it');
  assert.match(read('app/js/views/account-extra.js'), /wireNotifications\(root, \{ guest: true,/, 'guest settings expose the notification switch');
  assert.match(read('app/js/views/account-extra.js'), /local profile and watch data stay on this phone/, 'guest scope is explained');
  assert.match(features, /api\.post\('\/devices\/guest'/, 'the guest registration endpoint is public');
  assert.match(read('server/src/db-extra.js'), /async upsertGuest\(/, 'guest devices are stored anonymously');
  assert.match(guestMigration, /user_id CHAR\(36\) NULL/, 'guest registrations may have no account foreign key');
  assert.match(read('app/js/data/adapters.js'), /registerGuestDevice\(token, platform = 'android', label = null, prefs = null\)/, 'API client has an anonymous registration method (and can carry the device’s notification choices)');
  assert.equal(mobilePkg.dependencies['@capacitor-firebase/messaging'], '7.5.0', 'the native shell ships the Firebase Messaging plugin');
  assert.equal(mobilePkg.dependencies['@capacitor/push-notifications'], undefined, 'do not register two competing native push plugins');
  assert.match(sw, /'app\/js\/push-native\.js'/, 'the module is precached');
});
