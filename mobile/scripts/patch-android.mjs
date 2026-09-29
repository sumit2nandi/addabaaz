// Keeps the generated Android project (mobile/android, created by `npx cap add android`) new enough for today's libraries and for Google Play.
//
// Why: Capacitor 7's Android template is generated with Android Gradle Plugin (AGP) 8.7.2 and compileSdk/targetSdk 35. Newer libraries
// (for example androidx.browser 1.9.0, used by the social-login plugin) need AGP 8.9.1+ and compileSdk 36, and since 31 Aug 2026
// Google Play only accepts new apps and updates that target API 36. This script raises those numbers - and only ever raises them,
// so running it twice (or on an already-newer project) changes nothing.
//
// It runs automatically after `npm run sync` and `npm run add:android`; you can also run it by hand:  npm run android:patch
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_AGP = '8.9.1';           // Android Gradle Plugin
const SDK = 36;                    // compileSdk and targetSdk (Android 16)

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'android');
if (!fs.existsSync(root)) { console.log('[android:patch] no mobile/android folder yet (run `npx cap add android` first) - nothing to do.'); process.exit(0); }

// "8.10.0" > "8.9.1" when compared number by number (a plain string comparison would get this wrong).
const older = (a, b) => { const [x, y] = [a, b].map((v) => v.split('.').map(Number)); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };

// Rewrites a file with `edit(text)`; logs only when something actually changed.
function patch(file, label, edit) {
  const p = path.join(root, file); if (!fs.existsSync(p)) return;
  const before = fs.readFileSync(p, 'utf8'), after = edit(before);
  if (after !== before) { fs.writeFileSync(p, after); console.log(`[android:patch] ${file}: ${label}`); }
}

patch('build.gradle', `Android Gradle Plugin -> ${MIN_AGP} (if it was lower)`, (t) =>
  t.replace(/(com\.android\.tools\.build:gradle:)(\d+\.\d+\.\d+)/, (m, pre, v) => (older(v, MIN_AGP) ? pre + MIN_AGP : m)));

patch('variables.gradle', `compileSdk/targetSdk -> ${SDK} (if they were lower)`, (t) =>
  t.replace(/((?:compileSdkVersion|targetSdkVersion)\s*=\s*)(\d+)/g, (m, pre, v) => (Number(v) < SDK ? pre + SDK : m)));

console.log('[android:patch] done. In Android Studio: SDK Manager -> install "Android 16 (API 36)" if asked, then File -> Sync Project with Gradle Files.');
