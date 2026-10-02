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
