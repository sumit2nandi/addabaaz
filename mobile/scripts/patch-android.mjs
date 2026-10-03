// Keeps the generated Android project (mobile/android, created by `npx cap add android`) new enough for today's libraries and for Google Play.
//
// Why: Capacitor 7's Android template is generated with Android Gradle Plugin (AGP) 8.7.2 and compileSdk/targetSdk 35. Newer libraries
// (for example androidx.browser 1.9.0, used by the social-login plugin) need AGP 8.9.1+ and compileSdk 36, and since 31 Aug 2026
// Google Play only accepts new apps and updates that target API 36. This script raises those numbers - and only ever raises them,
// so running it twice (or on an already-newer project) changes nothing.
//
// It also locks the app to portrait: the main activity gets android:screenOrientation="portrait" in AndroidManifest.xml, so turning
// the phone never switches the app to landscape (the whole UI is designed for portrait). To allow rotation again, remove the
// `patch('app/src/main/AndroidManifest.xml', ...)` call at the bottom of this file - otherwise every sync would put the lock back.
//
// It runs automatically after `npm run sync` and `npm run add:android`; you can also run it by hand:  npm run android:patch
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockPortrait, isPortraitLocked, addOAuthRedirect, hasOAuthRedirect } from './android-manifest.mjs';
import { stampLauncherIcons } from './android-icons.mjs';
import { stableSigning, hasStableSigning } from './android-gradle.mjs';
import { patchMainActivity, mainActivityInstallsFullscreen, writeFullscreenClient, addCoreDependency, javaSourceDir } from './android-fullscreen.mjs';

// Deep-link scheme for the Google sign-in redirect back into the app (= the Capacitor appId;
// the API's /auth/google/native-page deep-links to the same scheme, keep them in step).
const APP_SCHEME = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'capacitor.config.json'), 'utf8')).appId;

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

patch('app/src/main/AndroidManifest.xml', 'main activity locked to portrait + OAuth deep-link filter', (t) => {
  const out = addOAuthRedirect(lockPortrait(t), APP_SCHEME);
  // Never ship an app that rotates by accident: if the generated manifest no longer looks the way this expects, stop the build.
  if (!isPortraitLocked(out)) throw new Error('[android:patch] could not lock MainActivity to portrait - AndroidManifest.xml changed shape; update mobile/scripts/android-manifest.mjs.');
  if (!hasOAuthRedirect(out, APP_SCHEME)) throw new Error('[android:patch] could not add the OAuth redirect filter - AndroidManifest.xml changed shape; update mobile/scripts/android-manifest.mjs.');
  return out;
});

// The install screen and title bar show the brand name exactly as the user reads it on the website.
patch('app/src/main/res/values/strings.xml', 'app_name -> Addabaaz', (t) =>
  t.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Addabaaz</string>'));

// Android 12+ system splash: use the dark logo artwork as the splash icon instead of the launcher
// icon's square, so launching never shows white squares around the logo.
patch('app/src/main/res/values/styles.xml', 'system splash shows the dark logo artwork', (t) =>
  t.includes('windowSplashScreenAnimatedIcon') ? t : t.replace(
    /(<style name="AppTheme\.NoActionBarLaunch"[^>]*>\s*<item name="android:background">@drawable\/splash<\/item>)/,
    '$1\n        <item name="android:windowSplashScreenBackground">#050505</item>\n        <item name="android:windowSplashScreenAnimatedIcon">@drawable/splash</item>'));

// The activity window and both system bars are the brand dark: white strips must never show
// around full-screen video (or anywhere else - overscroll, rotation, immersive transitions).
patch('app/src/main/res/values/styles.xml', 'window + status/nav bars are dark, no white strips', (t) =>
  t.includes('ab-dark-window') ? t : t.replace(
    /(<style name="AppTheme" parent="Theme\.AppCompat\.NoActionBar">)/,
    '$1\n        <!-- ab-dark-window -->\n        <item name="android:windowBackground">#050505</item>\n        <item name="android:statusBarColor">#050505</item>\n        <item name="android:navigationBarColor">#050505</item>'));

// ...and the same on AppTheme.NoActionBar - the theme the activity actually runs in (Capacitor
// switches to it in onCreate), which does not inherit from AppTheme. Without this the running
// window falls back to the DayNight defaults, which is where the white status/navigation strips
// around full-screen video came from: light bars in the system's light mode.
const stylesXml = 'app/src/main/res/values/styles.xml';
patch(stylesXml, 'running theme (AppTheme.NoActionBar) is dark, bars use light icons', (t) =>
  t.includes('ab-dark-window-activity') ? t : t.replace(
    /(<style name="AppTheme\.NoActionBar" parent="Theme\.AppCompat\.DayNight\.NoActionBar">)/,
    '$1\n        <!-- ab-dark-window-activity -->\n        <item name="android:windowBackground">#050505</item>\n        <item name="android:statusBarColor">#050505</item>\n        <item name="android:navigationBarColor">#050505</item>\n        <item name="android:windowLightStatusBar">false</item>\n        <item name="android:windowLightNavigationBar">false</item>\n        <item name="android:enforceStatusBarContrast">false</item>\n        <item name="android:enforceNavigationBarContrast">false</item>'));
// That theme is where the white strips came from, so a build whose styles.xml no longer has the
// shape above must stop instead of shipping light system bars.
const stylesPath = path.join(root, stylesXml);
if (fs.existsSync(stylesPath) && !fs.readFileSync(stylesPath, 'utf8').includes('ab-dark-window-activity')) {
  throw new Error('[android:patch] could not darken AppTheme.NoActionBar - styles.xml changed shape; update mobile/scripts/patch-android.mjs.');
}

// Full-screen video the YouTube-app way: the player's fullscreen button hands the video to the OS
// view, and the client MainActivity installs shows it alone on a black screen with both system bars
// hidden. Capacitor's own WebChromeClient refuses that path (immediately cancels the custom view),
// which is why fullscreen used to grow inside the page and leave the white strips.
const mainActivity = path.join(javaSourceDir(root, APP_SCHEME), 'MainActivity.java');
if (fs.existsSync(mainActivity)) {
  const before = fs.readFileSync(mainActivity, 'utf8');
  const after = patchMainActivity(before);
  if (after !== before) fs.writeFileSync(mainActivity, after);
  if (!mainActivityInstallsFullscreen(fs.readFileSync(mainActivity, 'utf8'))) {
    throw new Error('[android:patch] could not install the fullscreen client in MainActivity.java - the generated file changed shape; update mobile/scripts/android-fullscreen.mjs.');
  }
  console.log(`[android:patch] ${path.relative(root, mainActivity)}: fullscreen video client installed`);
  const { file, changed } = writeFullscreenClient(root, APP_SCHEME);
  if (file) console.log(`[android:patch] ${path.relative(root, file)}${changed ? '' : ' (already current)'}: the video alone on a black screen in fullscreen`);
}
patch('app/build.gradle', 'androidx.core on the app classpath (fullscreen video insets)', (t) => addCoreDependency(t));

// Every CI APK is signed with the same shared debug key, so a fresh build installs as an
// UPDATE over an older one (Android refuses "App not installed" signature-mismatch updates
// when each runner used its own throwaway keystore). The key is a DEBUG key checked into the
// repo on purpose - it protects nothing and is meant to be public.
const keystore = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'keystores', 'ci-debug.p12');
if (fs.existsSync(keystore)) {
  fs.copyFileSync(keystore, path.join(root, 'app', 'ci-debug.p12'));
  console.log('[android:patch] app/ci-debug.p12: shared CI debug signing key');
}
patch('app/build.gradle', 'debug builds signed with the shared CI key (new APKs update old installs)', (t) => {
  const out = stableSigning(t);
  if (!hasStableSigning(out)) throw new Error('[android:patch] could not add the stable debug signing config - app/build.gradle changed shape; update mobile/scripts/android-gradle.mjs.');
  return out;
});

// The APK installs with the website logo as its launcher icon (not the stock Capacitor bot):
// the pre-rendered logo PNGs replace every mipmap density and the adaptive-icon XML is dropped.
for (const line of stampLauncherIcons(root)) console.log(`[android:patch] res: ${line}`);

console.log('[android:patch] done. In Android Studio: SDK Manager -> install "Android 16 (API 36)" if asked, then File -> Sync Project with Gradle Files.');
