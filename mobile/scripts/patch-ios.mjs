#!/usr/bin/env node
/* Keep the generated Capacitor iOS AppDelegate wired to Firebase Messaging notifications.
 * The native project is generated in CI (mobile/ios is git-ignored), so make this patch repeatable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DELEGATE = path.join(MOBILE, 'ios', 'App', 'App', 'AppDelegate.swift');
const MARKER = '// ADDABAAZ-FIREBASE-PUSH';

export function patchAppDelegate(source) {
  if (source.includes(MARKER)) return source;
  const classStart = source.indexOf('class AppDelegate');
  const classEnd = source.lastIndexOf('\n}');
  if (classStart < 0 || classEnd < classStart) throw new Error('AppDelegate.swift changed shape; could not add the Firebase notification callbacks.');
  const methods = `\n\n    ${MARKER}\n    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {\n        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)\n    }\n\n    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {\n        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)\n    }\n\n    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {\n        NotificationCenter.default.post(name: Notification.Name("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)\n    }\n`;
  return source.slice(0, classEnd) + methods + source.slice(classEnd);
}

function main() {
  if (!fs.existsSync(APP_DELEGATE)) {
    console.log('[ios:patch] no mobile/ios project yet; run `npm run add:ios` first.');
    return;
  }
  const before = fs.readFileSync(APP_DELEGATE, 'utf8');
  const after = patchAppDelegate(before);
  if (after !== before) {
    fs.writeFileSync(APP_DELEGATE, after);
    console.log('[ios:patch] AppDelegate.swift: Firebase remote-notification callbacks added.');
  } else console.log('[ios:patch] AppDelegate.swift: Firebase callbacks already present.');
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try { main(); }
  catch (error) { console.error(`[ios:patch] ${error.message}`); process.exitCode = 1; }
}
