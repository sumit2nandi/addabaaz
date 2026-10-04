// Uninstalling the app must really delete the phone-side data, and a reinstall must start signed out.
//
// The app keeps nothing outside its own sandbox: the session token is `ab.token` in the WebView's
// localStorage (app/js/data/api.js) and Android deletes that storage when the app is uninstalled. The
// hole was the *backup copy*: Capacitor's generated manifest ships `android:allowBackup="true"`, so a
// Google Drive auto-backup (or a "copy apps & data" phone transfer) could restore the WebView storage —
// session token included — and the reinstalled app came back signed in as the old account.
//
// mobile/scripts/patch-android.mjs closes those paths in the generated project; this pins the edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  disableBackup, isBackupDisabled, backupRulesXml, BACKUP_RULES_RES, BACKUP_RULES_ATTR,
} from '../../mobile/scripts/android-manifest.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const generated = read('test/mobile/fixtures/AndroidManifest.capacitor7.xml');

test('the Capacitor template really does allow backup — that is what restored the old session', () => {
  assert.match(generated, /<application[\s\S]*?android:allowBackup="true"/, 'the fixture is Capacitor 7\'s own manifest');
  assert.equal(isBackupDisabled(generated), false, 'a freshly generated app would be restored from a backup');
  // …and the thing a restore brings back is the signed-in session.
  assert.match(read('app/js/data/api.js'), /storage\('ab\.token'/, 'the session token lives in the WebView storage');
  assert.equal(/Capacitor\.Plugins\.(Filesystem|Preferences)/.test(read('app/js/data/api.js')), false, 'and nowhere else that could outlive the install');
});

test('disableBackup turns cloud backup, the pre-12 backup file and device transfers off', () => {
  const patched = disableBackup(generated);
  const application = (patched.match(/<application\b[^>]*>/) || [''])[0];
  assert.match(application, /android:allowBackup="false"/, 'no cloud backup');
  assert.match(application, /android:fullBackupContent="false"/, 'and none on API 23–30 either');
  assert.match(application, /android:dataExtractionRules="@xml\/data_extraction_rules"/, 'Android 12+ reads the rules file');
  assert.equal(isBackupDisabled(patched), true);
  const strip = (xml) => xml.replace(/\n        android:(allowBackup|fullBackupContent|dataExtractionRules)="[^"]*"/g, '');
  assert.equal(strip(patched), strip(generated), 'the rest of the manifest is untouched');
  assert.equal(disableBackup(patched), patched, 'idempotent: every `cap sync` may run it again');
});

test('a manifest whose application tag has none of the attributes gets them added', () => {
  const bare = generated.replace(/^.*android:allowBackup="true"\n/m, '');
  assert.equal(/allowBackup|dataExtractionRules|fullBackupContent/.test(bare), false);
  const patched = disableBackup(bare);
  assert.equal(isBackupDisabled(patched), true);
  assert.equal(disableBackup(patched), patched, 'still idempotent');
  assert.equal(patched.replace(/<application\n        android:allowBackup="false"\n        android:fullBackupContent="false"\n        android:dataExtractionRules="@xml\/data_extraction_rules"/, '<application'),
    bare, 'the attributes are inserted, nothing else moves');
});

test('the Android 12+ rules file excludes every domain from cloud backup and device transfer', () => {
  const rules = backupRulesXml();
  assert.match(rules, /<data-extraction-rules>/, 'the shape Android expects');
  for (const section of ['cloud-backup', 'device-transfer']) {
    const body = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1] || '';
    for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
      assert.match(body, new RegExp(`<exclude domain="${domain}" path="\\." />`), `${section}: ${domain} excluded`);
    }
  }
  assert.match(rules, /<\/data-extraction-rules>/, 'and it is closed');
  assert.match(backupRulesXml(), /Written by mobile\/scripts\/patch-android\.mjs/, 'the file says who writes it');
  assert.equal(BACKUP_RULES_ATTR, '@xml/data_extraction_rules');
  assert.equal(BACKUP_RULES_RES, 'app/src/main/res/xml/data_extraction_rules.xml', 'the resource the attribute points at');
});

test('the Android build script applies it, writes the rules file and fails loudly if the template changes', () => {
  const patch = read('mobile/scripts/patch-android.mjs');
  assert.match(patch, /import \{[^}]*disableBackup, isBackupDisabled, backupRulesXml, BACKUP_RULES_RES[^}]*\} from '\.\/android-manifest\.mjs'/);
  assert.match(patch, /const out = disableBackup\(t\);/);
  assert.match(patch, /if \(!isBackupDisabled\(out\)\) throw new Error\('\[android:patch\] could not disable backup/, 'a template change must stop the build, not ship a restorable app');
  assert.match(patch, /fs\.writeFileSync\(rules, backupRulesXml\(\)\)/, 'the rules file is written into the generated project');
  assert.match(patch, /uninstall/i, 'the reason is written down next to the code');
});

test('docs/MOBILE.md explains that uninstall deletes the data and a reinstall starts signed out', () => {
  const doc = read('docs/MOBILE.md');
  assert.match(doc, /Uninstalling really deletes the data/);
  assert.match(doc, /android:allowBackup="false"/);
  assert.match(doc, /data_extraction_rules\.xml/);
  assert.match(doc, /reinstall[^.]*signed out|signed out[^.]*reinstall/i, 'the promise to the user is spelled out');
  assert.match(doc, /Sign out everywhere/, 'and what to do before passing the phone on');
});
