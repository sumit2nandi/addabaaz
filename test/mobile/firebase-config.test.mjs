import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureAndroidFirebase, configureIosFirebase } from '../../mobile/scripts/configure-firebase.mjs';
import { patchAppDelegate } from '../../mobile/scripts/patch-ios.mjs';

const androidConfig = (packageName = 'in.addabaaz.app') => JSON.stringify({
  project_info: { project_number: '123456789', project_id: 'addabaaz-test', storage_bucket: 'addabaaz-test.appspot.com' },
  client: [{ client_info: { mobilesdk_app_id: '1:123456789:android:abc123', android_client_info: { package_name: packageName } } }],
});
const iosConfig = (bundleId = 'in.addabaaz.app') => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>BUNDLE_ID</key><string>${bundleId}</string>
  <key>GOOGLE_APP_ID</key><string>1:123456789:ios:abc123</string>
  <key>PROJECT_ID</key><string>addabaaz-test</string>
</dict></plist>`;
const tempFile = (t, name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'addabaaz-firebase-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, name);
};

test('Android Firebase config is optional when the Actions secret is empty', () => {
  assert.equal(configureAndroidFirebase('', { output: '/tmp/unused-google-services.json' }), false);
});

test('Android Firebase config validates the package id and writes google-services.json', (t) => {
  const output = tempFile(t, 'android/app/google-services.json');
  assert.equal(configureAndroidFirebase(androidConfig(), { output }), true);
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).client[0].client_info.android_client_info.package_name, 'in.addabaaz.app');
  assert.throws(() => configureAndroidFirebase(androidConfig('com.wrong.app'), { output }), /must include an Android client for in\.addabaaz\.app/);
  assert.throws(() => configureAndroidFirebase('{not-json}', { output }), /complete, raw google-services\.json/);
});

test('iOS Firebase config validates the bundle id and writes GoogleService-Info.plist', (t) => {
  const output = tempFile(t, 'ios/App/GoogleService-Info.plist');
  assert.equal(configureIosFirebase(iosConfig(), { output }), true);
  assert.match(fs.readFileSync(output, 'utf8'), /<key>PROJECT_ID<\/key><string>addabaaz-test<\/string>/);
  assert.throws(() => configureIosFirebase(iosConfig('com.wrong.app'), { output }), /BUNDLE_ID must be in\.addabaaz\.app/);
  assert.throws(() => configureIosFirebase('not a plist', { output }), /complete XML GoogleService-Info\.plist/);
});

test('iOS Firebase notification callbacks are patched idempotently', () => {
  const source = 'import UIKit\nimport Capacitor\n\n@UIApplicationMain\nclass AppDelegate: UIResponder, UIApplicationDelegate {\n    var window: UIWindow?\n}\n';
  const patched = patchAppDelegate(source);
  assert.match(patched, /capacitorDidRegisterForRemoteNotifications/);
  assert.match(patched, /capacitorDidFailToRegisterForRemoteNotifications/);
  assert.match(patched, /didReceiveRemoteNotification/);
  assert.equal(patchAppDelegate(patched), patched);
});
