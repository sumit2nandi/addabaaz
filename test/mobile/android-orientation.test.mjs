import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { lockPortrait, isPortraitLocked, addOAuthRedirect, hasOAuthRedirect } from '../../mobile/scripts/android-manifest.mjs';
import { stableSigning, hasStableSigning } from '../../mobile/scripts/android-gradle.mjs';
import { mainActivityInstallsFullscreen, hasCoreDependency } from '../../mobile/scripts/android-fullscreen.mjs';

// The Android app must not rotate to landscape when the phone is turned: the main activity is locked to portrait in the
// generated AndroidManifest.xml. mobile/android is generated in CI (`cap add android`) and git-ignored, so the lock is applied by
// mobile/scripts/patch-android.mjs. The fixture is the manifest Capacitor 7 really generates (`npx cap add android`).
const SCRIPTS = new URL('../../mobile/scripts/', import.meta.url);
const generated = fs.readFileSync(new URL('./fixtures/AndroidManifest.capacitor7.xml', import.meta.url), 'utf8');
const LOCK_LINE = '            android:screenOrientation="portrait"\n';
const activityTag = (xml, name) => (xml.match(/<activity\b[^>]*>/g) || []).find((tag) => tag.includes(name));

test('a freshly generated Capacitor manifest is not locked: the app would rotate with the phone', () => {
  assert.match(generated, /android:name="\.MainActivity"/, 'the fixture really is Capacitor\'s manifest');
  assert.equal(/screenOrientation/.test(generated), false);
  assert.equal(isPortraitLocked(generated), false);
});

test('lockPortrait adds one attribute to MainActivity and changes nothing else', () => {
  const locked = lockPortrait(generated);
  assert.equal(isPortraitLocked(locked), true);
  assert.match(activityTag(locked, '.MainActivity'), /android:screenOrientation="portrait"/);
  assert.equal(locked.replace(LOCK_LINE, ''), generated, 'removing the added line gives the original back, byte for byte');
  assert.equal(lockPortrait(locked), locked, 'idempotent: patching on every `cap sync` is safe');
});

test('an existing orientation on MainActivity is replaced, other activities keep theirs', () => {
  const other = '<activity android:name="com.example.AuthRedirectActivity" android:screenOrientation="sensor" android:exported="true"/>';
  const withLandscape = generated
    .replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="sensorLandscape"')
    .replace('</application>', `${other}\n    </application>`);
  const locked = lockPortrait(withLandscape);
  const main = activityTag(locked, '.MainActivity');
  assert.match(main, /android:screenOrientation="portrait"/);
  assert.equal((main.match(/screenOrientation/g) || []).length, 1, 'a single attribute, not two');
  assert.equal(/sensorLandscape/.test(locked), false);
  assert.ok(locked.includes(other), 'a different activity is untouched');
});

test('a manifest without MainActivity is reported as not locked (so the build can stop)', () => {
  const odd = '<manifest><application><activity android:name=".SomethingElse"/></application></manifest>';
  assert.equal(lockPortrait(odd), odd);
  assert.equal(isPortraitLocked(lockPortrait(odd)), false);
});

test('addOAuthRedirect puts the app-scheme deep-link filter on MainActivity only, idempotently', () => {
  const scheme = 'in.addabaaz.app';
  const withFilter = addOAuthRedirect(generated, scheme);
  assert.ok(hasOAuthRedirect(withFilter, scheme), 'the deep-link filter is present');
  const start = withFilter.indexOf('.MainActivity');
  const close = withFilter.indexOf('</activity>', start);
  const filter = withFilter.indexOf(`android:scheme="${scheme}"`);
  assert.ok(filter > start && filter < close, 'the filter sits inside the MainActivity element');
  assert.match(withFilter, /android.intent.category.BROWSABLE/, 'browsers may hand the link to the app');
  assert.equal(addOAuthRedirect(withFilter, scheme), withFilter, 'a second patch changes nothing');
  const other = '<activity android:name="com.example.Other" android:exported="true"/>';
  const two = addOAuthRedirect(generated.replace('</application>', `${other}\n    </application>`), scheme);
  assert.equal((two.match(new RegExp(`android:scheme="${scheme}"`, 'g')) || []).length, 1, 'other activities get no filter');
});

// The app/build.gradle Capacitor 7 generates (`npx cap add android`), for the signing patch.
const GRADLE = `apply plugin: 'com.android.application'

android {
    namespace "in.addabaaz.app"
    compileSdkVersion rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "in.addabaaz.app"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}

dependencies {
    implementation fileTree(include: ['*.jar'], dir: 'libs')
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
}
`;

// The two template snippets are separate on purpose: GRADLE (above) mirrors Capacitor 7's
// app/build.gradle for the signing patch; the integration test also checks the androidx.core line
// the fullscreen client needs is added to its dependencies block.

test('stableSigning points debug builds at the shared CI key, idempotently', () => {
  const signed = stableSigning(GRADLE);
  assert.ok(hasStableSigning(signed), 'the ciDebug signing config is present');
  assert.match(signed, /storeFile file\('ci-debug\.p12'\)/);
  assert.match(signed, /storeType 'PKCS12'/);
  const bt = signed.indexOf('buildTypes');
  const dbg = signed.indexOf('debug {', bt);
  const rel = signed.indexOf('release {', bt);
  assert.ok(dbg > bt && dbg < rel, 'the debug build type is declared before release');
  assert.match(signed, /debug \{\s*signingConfig signingConfigs\.ciDebug/, 'debug builds use the shared key');
  assert.equal(signed.match(/signingConfig signingConfigs\.ciDebug/g).length, 1, 'release keeps its default signing');
  assert.equal(stableSigning(signed), signed, 'idempotent: patching on every `cap sync` is safe');
  assert.equal(stableSigning('no android block here'), 'no android block here', 'unknown files pass through untouched');
});

test('npm run android:patch locks the generated project, is idempotent, and fails loudly on an unknown manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-android-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    for (const f of ['patch-android.mjs', 'android-manifest.mjs', 'android-icons.mjs', 'android-gradle.mjs', 'android-fullscreen.mjs']) fs.copyFileSync(new URL(f, SCRIPTS), path.join(dir, 'scripts', f));
    fs.cpSync(new URL('../../mobile/android-icons', import.meta.url), path.join(dir, 'android-icons'), { recursive: true });
    fs.copyFileSync(new URL('../../mobile/capacitor.config.json', import.meta.url), path.join(dir, 'capacitor.config.json'));
    fs.mkdirSync(path.join(dir, 'keystores'));
    fs.copyFileSync(new URL('../../mobile/keystores/ci-debug.p12', import.meta.url), path.join(dir, 'keystores', 'ci-debug.p12'));
    const manifest = path.join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, generated);
    const buildGradle = path.join(dir, 'android', 'app', 'build.gradle');
    fs.writeFileSync(buildGradle, GRADLE);
    const styles = path.join(dir, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
    fs.mkdirSync(path.dirname(styles), { recursive: true });
    fs.writeFileSync(styles, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <style name="AppTheme" parent="Theme.AppCompat.NoActionBar">\n    </style>\n    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">\n        <item name="windowActionBar">false</item>\n    </style>\n    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n        <item name="android:background">@drawable/splash</item>\n    </style>\n</resources>\n`);
    // Capacitor's stock MainActivity (package rewritten to the appId), for the fullscreen patch.
    const mainActivity = path.join(dir, 'android', 'app', 'src', 'main', 'java', 'in', 'addabaaz', 'app', 'MainActivity.java');
    fs.mkdirSync(path.dirname(mainActivity), { recursive: true });
    fs.writeFileSync(mainActivity, 'package in.addabaaz.app;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n');
    const run = () => execFileSync(process.execPath, [path.join(dir, 'scripts', 'patch-android.mjs')], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

    const first = run();
    assert.match(first, /AndroidManifest\.xml: main activity locked to portrait/);
    assert.ok(fs.existsSync(path.join(dir, 'android', 'app', 'src', 'main', 'res', 'mipmap-mdpi', 'ic_launcher.png')), 'the patch also stamps the logo launcher icons');
    assert.ok(fs.existsSync(path.join(dir, 'android', 'app', 'src', 'main', 'res', 'drawable-xxxhdpi', 'splash.png')), 'the branded dark splash replaces the stock white Capacitor tile');
    assert.ok(fs.existsSync(path.join(dir, 'android', 'app', 'src', 'main', 'res', 'drawable', 'splash.png')), 'the template splash.png itself is overwritten');
    const patched = fs.readFileSync(manifest, 'utf8');
    assert.equal(isPortraitLocked(patched), true);
    assert.equal(patched, addOAuthRedirect(lockPortrait(generated), 'in.addabaaz.app'), 'portrait lock plus the Google sign-in deep-link filter');
    assert.ok(fs.existsSync(path.join(dir, 'android', 'app', 'ci-debug.p12')), 'the shared CI key was copied into the app module');
    assert.ok(hasStableSigning(fs.readFileSync(buildGradle, 'utf8')), 'debug builds are signed with the shared key, so new APKs install over old ones');
    assert.ok(hasCoreDependency(fs.readFileSync(buildGradle, 'utf8')), 'androidx.core is on the app classpath for the fullscreen insets');
    const patchedStyles = fs.readFileSync(styles, 'utf8');
    assert.match(patchedStyles, /windowSplashScreenAnimatedIcon/, 'the system splash uses the dark logo artwork');
    assert.match(patchedStyles, /ab-dark-window/, 'the window theme patch was applied');
    assert.match(patchedStyles, /<item name="android:navigationBarColor">#050505<\/item>/, 'nav bar is dark - no white strips around full-screen video');
    assert.match(patchedStyles, /<item name="android:windowBackground">#050505<\/item>/, 'the activity window itself is dark');
    assert.match(patchedStyles, /ab-dark-window-activity/, 'the theme the activity really runs in (AppTheme.NoActionBar) was patched too');
    assert.match(patchedStyles, /<item name="android:windowLightNavigationBar">false<\/item>/, 'dark nav bar with light icons (no white bar in the system light mode)');
    assert.match(patchedStyles, /<item name="android:windowLightStatusBar">false<\/item>/);

    // Full-screen video: MainActivity installs the client that shows the video alone on black.
    const patchedActivity = fs.readFileSync(mainActivity, 'utf8');
    assert.ok(mainActivityInstallsFullscreen(patchedActivity), 'the fullscreen client is installed');
    assert.ok(fs.existsSync(path.join(path.dirname(mainActivity), 'FullscreenClient.java')), 'the client class is written next to MainActivity');
    assert.match(first, /fullscreen video client installed/);

    const second = run();
    assert.equal(/locked to portrait/.test(second), false, 'a second run has nothing to change');
    assert.equal(fs.readFileSync(mainActivity, 'utf8'), patchedActivity, 'a second run leaves MainActivity alone');
    assert.equal(fs.readFileSync(manifest, 'utf8'), patched);

    fs.writeFileSync(manifest, '<manifest><application><activity android:name=".SomethingElse"/></application></manifest>');
    assert.throws(run, (e) => /could not lock MainActivity to portrait/.test(String(e.stderr)), 'an unrecognised manifest stops the build instead of shipping a rotating app');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
