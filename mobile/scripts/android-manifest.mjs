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
