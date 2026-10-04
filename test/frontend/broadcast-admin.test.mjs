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
const deliveryMigration = read('server/migrations/023_campaign_delivery_details.sql');
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
  assert.match(view, /`\/notifications\/\$\{encodeURIComponent\(id\)\}\/deliveries\?/,
    'the detail popup loads paged recipient-level delivery outcomes');
  for (const status of ['pending', 'sent', 'failed', 'skipped']) assert.match(view, new RegExp(`\\b${status}: \\[`), `${status} is visible as an individual outcome`);
  assert.match(view, /!done\(c\.status\)/, 'the poller only runs while a broadcast is in flight');
  assert.match(view, /ctx\.stale\(\)/, 'the poller stops when the page is left');
  // Nothing may go back to the old push-only wording/flow.
  assert.doesNotMatch(view, /web-push message to viewers/, 'the old push-only subtitle is gone');
});

test('a recent broadcast opens a detail modal and Refresh preview reads the current form without sending', async () => {
  const { parseHTML } = await import('linkedom');
  const { document, window } = parseHTML('<!doctype html><html><body><main id="root"></main></body></html>');
  const previous = Object.fromEntries(['window', 'document', 'localStorage', 'fetch', 'setInterval', 'clearInterval'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const campaign = {
    id: 'campaign-1', channel: 'push', audience: 'news', title: 'Saved campaign title', body: 'Full saved campaign message',
    url: '/show/example', button: null, imageUrl: null, imageAlt: null, status: 'partial', total: 34, sent: 31,
    failed: 1, skipped: 2, cursor: 0, test: false, error: null, by: 'admin@example.com',
    createdAt: '2026-10-05T12:00:00.000Z', updatedAt: '2026-10-05T12:01:00.000Z', finishedAt: '2026-10-05T12:01:00.000Z',
    at: '2026-10-05T12:00:00.000Z',
  };
  const meta = {
    push: { web: true, native: true, webSubscribers: 23, nativeDevices: 11 },
    email: { configured: true, audiences: [] },
    audiences: [{ id: 'news', label: 'Announcements — viewers who opted in' }],
    campaigns: [campaign],
  };
  const calls = [];
  Object.defineProperty(window.HTMLElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(window.HTMLElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); } });
  globalThis.window = window;
  globalThis.document = document;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    let data;
    if (url === '/api/v1/admin/notifications') data = meta;
    else if (url === '/api/v1/admin/notifications/preview') data = { channel: 'push', push: { title: 'Draft title', body: 'Draft body', url: '/show/example' } };
    else if (url === '/api/v1/admin/notifications/campaign-1') data = { ...campaign, body: 'Latest full campaign details', done: true };
    else if (url.startsWith('/api/v1/admin/notifications/campaign-1/deliveries?')) data = {
      total: 3, limit: 50, offset: 0, deliveries: [
        { id: 'delivery-1', userId: 'account-1', name: 'Priya Das', email: 'priya@example.com', destination: 'Browser / web app', transport: 'web_push', status: 'sent' },
        { id: 'delivery-2', userId: 'account-2', name: 'Ravi Sen', email: 'ravi@example.com', destination: 'E-mail', transport: 'email', status: 'failed', error: 'SMTP connection refused' },
        { id: 'delivery-3', userId: null, name: 'Guest device', email: null, destination: 'Android · Guest Android', transport: 'app_push', status: 'skipped', error: 'Device token is expired.' },
      ],
    };
    else throw new Error(`Unexpected request ${options.method} ${url}`);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };

  try {
    const { default: notifications } = await import('../../admin/js/views/notifications.js');
    const root = document.querySelector('#root');
    await notifications(root, [], { stale: () => false });

    // Linkedom does not implement the browser's named form controls, so expose these controls as a real
    // browser form would. Clicking the actual button then exercises runPreview() and its payload builder.
    const form = root.querySelector('#bcf');
    for (const name of ['title', 'body', 'url', 'imageUrl', 'imageAlt']) {
      const control = form.querySelector(`[name="${name}"]`);
      Object.defineProperty(form, name, { configurable: true, value: control });
    }
    form.title.value = 'Draft title';
    form.body.value = 'Draft body';
    form.url.value = '/show/example';
    root.querySelector('#bc_preview').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const preview = calls.find((call) => call.url === '/api/v1/admin/notifications/preview');
    assert.ok(preview, 'Refresh preview calls the non-sending preview endpoint');
    assert.deepEqual(JSON.parse(preview.body), {
      channel: 'push', title: 'Draft title', body: 'Draft body', url: '/show/example', button: '', imageUrl: '', imageAlt: '',
    });
    assert.equal(root.querySelector('#bcPvState').textContent, 'Nothing has been sent.');
    assert.equal(calls.some((call) => call.url.endsWith('/notifications/send')), false, 'preview never starts a broadcast');

    assert.ok(root.querySelector('[data-campaign-open]'), 'the item title is also keyboard-accessible');
    root.querySelector('tr[data-campaign] td:nth-child(2)').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const modal = document.querySelector('dialog.modal[open]');
    assert.ok(modal, 'the recent item opens a popup');
    assert.match(modal.textContent, /Latest full campaign details/, 'the popup refreshes from GET /notifications/:id');
    assert.match(modal.textContent, /Announcements — viewers who opted in/);
    assert.match(modal.textContent, /34/);
    assert.match(modal.textContent, /31/);
    assert.match(modal.textContent, /1/);
    assert.match(modal.textContent, /2/);
    assert.match(modal.textContent, /Recipients and outcomes/);
    assert.match(modal.textContent, /Priya Das/);
    assert.match(modal.textContent, /priya@example\.com/);
    assert.match(modal.textContent, /account-1/);
    assert.match(modal.textContent, /Ravi Sen/);
    assert.match(modal.textContent, /SMTP connection refused/);
    assert.match(modal.textContent, /Guest device/);
    assert.match(modal.textContent, /Skipped/);
    assert.ok(calls.some((call) => call.url.startsWith('/api/v1/admin/notifications/campaign-1/deliveries?')),
      'the popup loads per-recipient outcomes from the paged details endpoint');
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('the server exposes the broadcast API: send, status, test, devices, unsubscribe', () => {
  assert.match(extra, /router\.post\('\/notifications\/send'/, 'POST /admin/notifications/send');
  assert.match(extra, /router\.get\('\/notifications\/:id'/, 'GET /admin/notifications/:id (progress)');
  assert.match(extra, /router\.get\('\/notifications\/:id\/deliveries'/, 'GET /admin/notifications/:id/deliveries pages recipient outcomes');
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
  assert.match(read('server/src/push.js'), /db\.devices\.removeHash\(endpointHash\(token\)\)/, 'dead tokens are deleted');
  assert.match(app, /fcmFromEnv\(\)/, 'the server builds the FCM service from the environment');
  assert.match(adminServer, /item\('apppush', 'App push'/, 'the dashboard checklist reports app push');
});

test('the databases pieces exist and the app registers its token', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS push_devices/, 'native device tokens');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS campaigns/, 'broadcast history + progress');
  assert.match(migration, /ALTER TABLE users ADD COLUMN email_opt_out_at/, 'unsubscribe flag');
  assert.match(deliveryMigration, /CREATE TABLE IF NOT EXISTS campaign_deliveries/, 'recipient-level delivery records');
  assert.match(deliveryMigration, /delivery_key\s+CHAR\(64\)/, 'raw device tokens are not used as durable delivery keys');
  assert.match(read('server/src/db-extra.js'), /async recordDelivery\(/, 'per-recipient outcomes are persisted');
  assert.match(read('server/src/db-extra.js'), /async deliveries\(/, 'outcomes can be searched and paged');
  assert.match(read('server/src/db-extra.js'), /async deliveryCounts\(/, 'the detail view gets status counts');
  assert.match(read('server/src/db-extra.js'), /u\.name AS account_name, u\.email AS account_email/, 'error records include their account snapshot lookup');
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
