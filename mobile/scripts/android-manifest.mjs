// Text edits for the generated AndroidManifest.xml (mobile/android/app/src/main/AndroidManifest.xml).
// Kept free of file access so tests can import it; scripts/patch-android.mjs applies it to the real file.

// The opening tag of every <activity ...> element (attributes may span several lines).
const ACTIVITY_TAG = /<activity\b[^>]*>/g;
// The app's own activity: Capacitor generates `android:name=".MainActivity"`.
const isMainActivity = (tag) => /android:name\s*=\s*"[^"]*\bMainActivity"/.test(tag);

/**
 * Locks the main activity to portrait, so turning the phone never switches the app to landscape.
 * Idempotent: an existing android:screenOrientation on that activity is rewritten to "portrait", otherwise the attribute is added.
 * Other activities (plugin screens, OAuth redirects) are left alone.
 */
export function lockPortrait(xml) {
  return xml.replace(ACTIVITY_TAG, (tag) => {
    if (!isMainActivity(tag)) return tag;
    if (/android:screenOrientation\s*=/.test(tag)) return tag.replace(/(android:screenOrientation\s*=\s*)(["'])[^"']*\2/, '$1"portrait"');
    return tag.replace(/<activity\b/, '<activity\n            android:screenOrientation="portrait"');
  });
}

/** True when the main activity is locked to portrait (used to fail loudly if a future Capacitor template no longer matches). */
export const isPortraitLocked = (xml) => (xml.match(ACTIVITY_TAG) || [])
  .some((tag) => isMainActivity(tag) && /android:screenOrientation\s*=\s*"portrait"/.test(tag));

// Google sign-in on native ends in a deep link back into the app (in.addabaaz.app://oauth?ticket=…).
// MainActivity needs a VIEW/BROWSABLE intent filter for that scheme, or Android never routes the link home.
const oauthFilter = (scheme) => `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${scheme}" />
            </intent-filter>`;

/** Adds the OAuth deep-link intent filter to MainActivity. Idempotent; leaves other activities alone. */
export function addOAuthRedirect(xml, scheme) {
  if (xml.includes(`android:scheme="${scheme}"`)) return xml;
  const i = xml.indexOf('.MainActivity');
  if (i === -1) return xml;
  const close = xml.indexOf('</activity>', i);
  if (close === -1) return xml;
  return xml.slice(0, close) + oauthFilter(scheme) + '\n        ' + xml.slice(close);
}

/** True when MainActivity can receive the app-scheme deep link used by Google sign-in. */
export const hasOAuthRedirect = (xml, scheme) => xml.includes(`android:scheme="${scheme}"`);

// ---------------------------------------------------------------------------------------------------
// Backup / restore: uninstalling the app must really delete its data.
//
// Capacitor's template ships `android:allowBackup="true"`. Android then keeps a copy of the app's
// private storage — including the WebView localStorage that holds the signed-in session token
// (`ab.token`, see app/js/data/api.js) — in the user's Google Drive auto-backup and in "copy apps &
// data" phone transfers. Reinstalling the app could therefore restore that copy and come back signed
// in as the previous account, even though uninstalling had removed everything from the phone.
//
// `android:allowBackup="false"` stops cloud backup. Since Android 12 that attribute no longer stops
// device-to-device transfers, so the manifest also points `android:dataExtractionRules` at the rules
// file below, and `android:fullBackupContent="false"` covers API 23–30.
// ---------------------------------------------------------------------------------------------------

/** The app's own `<application ...>` opening tag (a manifest has exactly one). */
const APPLICATION_TAG = /<application\b[^>]*>/;
/** Where the backup rules live inside the generated Android project. */
export const BACKUP_RULES_RES = 'app/src/main/res/xml/data_extraction_rules.xml';
export const BACKUP_RULES_ATTR = '@xml/data_extraction_rules';

/**
 * Turns every Android backup/restore path off for this app. Idempotent: existing values are rewritten,
 * missing attributes are added to <application>, everything else is left byte for byte alone.
 */
export function disableBackup(xml, rules = BACKUP_RULES_ATTR) {
  const wanted = new Map([['allowBackup', 'false'], ['fullBackupContent', 'false'], ['dataExtractionRules', rules]]);
  return xml.replace(APPLICATION_TAG, (tag) => {
    const missing = [...wanted].filter(([name]) => !new RegExp(`android:${name}\\s*=`).test(tag));
    const rewritten = tag.replace(new RegExp(`android:(${[...wanted.keys()].join('|')})\\s*=\\s*(["'])[^"']*\\2`, 'g'),
      (m, name) => `android:${name}="${wanted.get(name)}"`);
    return missing.length
      ? rewritten.replace(/<application\b/, '<application\n' + missing.map(([n, v]) => `        android:${n}="${v}"`).join('\n'))
      : rewritten;
  });
}

/** True when the manifest really forbids cloud backup, device transfers and the pre-12 backup file. */
export const isBackupDisabled = (xml) => {
  const tag = (xml.match(APPLICATION_TAG) || [''])[0];
  return /android:allowBackup\s*=\s*"false"/.test(tag)
    && /android:fullBackupContent\s*=\s*"false"/.test(tag)
    && /android:dataExtractionRules\s*=\s*"@xml\/data_extraction_rules"/.test(tag);
};

/**
 * The Android 12+ rules file the manifest points at: nothing goes to the cloud (`allowBackup` already
 * says that) and nothing travels to a new phone — every domain excluded, so the WebView storage cannot
 * arrive on a fresh install by that route either.
 */
export const backupRulesXml = () => `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by mobile/scripts/patch-android.mjs. A restored copy of the app's storage is exactly what
     used to sign a reinstalled app back in as the old account, so nothing is backed up and nothing is
     transferred. See docs/MOBILE.md -> "Uninstalling really deletes the data". -->
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </device-transfer>
</data-extraction-rules>
`;
