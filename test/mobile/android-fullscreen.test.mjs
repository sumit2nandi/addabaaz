// Full-screen video in the Android app: the player's fullscreen button must show the video ALONE on
// a black screen (both system bars hidden) - the YouTube-app behaviour - instead of Capacitor's
// default, which cancels Android's custom-view fullscreen and leaves the video growing inside the
// page with white strips around it. mobile/android is generated in CI (`cap add android`) and
// git-ignored, so the fix lives in mobile/scripts/android-fullscreen.mjs, applied by
// mobile/scripts/patch-android.mjs on every sync.
// Run: node --test test/mobile/android-fullscreen.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  patchMainActivity,
  mainActivityInstallsFullscreen,
  fullscreenClientJava,
  addCoreDependency,
  hasCoreDependency,
  javaSourceDir,
  MAIN_ACTIVITY_MARKER,
  PAGE_EVENT,
} from '../../mobile/scripts/android-fullscreen.mjs';

// Exactly what Capacitor 7's `cap add android` writes (package already rewritten to the appId).
const STOCK = `package in.addabaaz.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`;

test('MainActivity is rewritten to install the fullscreen client, with the package kept', () => {
  const out = patchMainActivity(STOCK);
  assert.match(out, /^package in\.addabaaz\.app;/);
  assert.ok(mainActivityInstallsFullscreen(out), 'the client is installed in onCreate');
  assert.match(out, new RegExp(MAIN_ACTIVITY_MARKER), 'marked so later syncs recognise it');
  assert.match(out, /setWebChromeClient\(fullscreen\)/);
  assert.match(out, /new OnBackPressedCallback\(true\)/, 'back in full screen leaves full screen, not the app');
  assert.match(out, /fullscreen\.exitFullscreen\(\)/);
  assert.match(out, /Bridge bridge = getBridge\(\)/, 'the bridge is checked before use');
  assert.equal(patchMainActivity(out), out, 'idempotent: patching on every `cap sync` is safe');
});

test('an unrecognised MainActivity is left untouched (so the build can stop instead of shipping)', () => {
  const custom = 'package x;\npublic class MainActivity extends BridgeActivity { /* hand-written */ }\n';
  assert.equal(patchMainActivity(custom), custom);
  assert.equal(mainActivityInstallsFullscreen(custom), false);
});

test('the client accepts the custom view: video alone, black, edge to edge, both bars hidden', () => {
  const java = fullscreenClientJava('in.addabaaz.app');
  assert.match(java, /^package in\.addabaaz\.app;/);
  assert.match(java, /public class FullscreenClient extends BridgeWebChromeClient/, 'subclasses Capacitor - dialogs and file pickers keep working');
  assert.match(java, /public FullscreenClient\(Bridge bridge\)/);

  assert.match(java, /public void onShowCustomView\(View view, CustomViewCallback callback\)/);
  assert.match(java, /view\.setBackgroundColor\(Color\.BLACK\)/, 'the video sits on black');
  assert.match(java, /setDecorFitsSystemWindows\(window, false\)/, 'edge to edge: no window-background strips');
  assert.match(java, /bars\.hide\(WindowInsetsCompat\.Type\.systemBars\(\)\)/, 'status AND navigation bars hidden - only the video on screen');
  assert.match(java, /LayoutParams\.MATCH_PARENT, ViewGroup\.LayoutParams\.MATCH_PARENT/, 'the video fills the whole display');
  assert.match(java, /webView\.setVisibility\(View\.INVISIBLE\)/, 'the page behind it is hidden');
  assert.match(java, /FLAG_KEEP_SCREEN_ON/);
  assert.match(java, /SCREEN_ORIENTATION_SENSOR/, 'the screen may turn - but only here');

  assert.match(java, /public void onHideCustomView\(\)/);
  assert.match(java, /decor\.removeView\(fullscreenView\)/, 'the fullscreen view is taken down again');
  assert.match(java, /bars\.show\(WindowInsetsCompat\.Type\.systemBars\(\)\)/, 'the bars come back');
  assert.match(java, /webView\.setVisibility\(View\.VISIBLE\)/);
  assert.match(java, /SCREEN_ORIENTATION_PORTRAIT/, 'outside full screen the app is portrait-only again');
  assert.match(java, new RegExp(PAGE_EVENT), 'the page is told when full screen starts and ends');
  assert.match(java, /notifyPage\(true\)/); assert.match(java, /notifyPage\(false\)/);
  assert.match(java, /public boolean exitFullscreen\(\)/);
  assert.match(java, /CustomViewCallback callback = fullscreenCallback;/, 'exitFullscreen goes through the stored callback');
  assert.match(java, /callback\.onCustomViewHidden\(\);   \/\/ the WebView then calls onHideCustomView/, 'the WebView restores everything on the way out');
  assert.match(java, /if \(fullscreenView == null \|\| fullscreenCallback == null\) \{\n            return false;/, 'nothing to exit outside full screen');
});

test('androidx.core is on the app classpath for the fullscreen insets, exactly once', () => {
  const gradle = 'android {\n    namespace "in.addabaaz.app"\n}\n\ndependencies {\n    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"\n}\n';
  const out = addCoreDependency(gradle);
  assert.ok(hasCoreDependency(out));
  assert.match(out, /implementation "androidx\.core:core:\$androidxCoreVersion"/);
  assert.match(out, /implementation "androidx\.activity:activity:\$androidxActivityVersion"/);
  assert.equal((out.match(/androidx\.core:core/g) || []).length, 1);
  assert.equal(addCoreDependency(out), out, 'idempotent');
  assert.equal(addCoreDependency('no dependencies block'), 'no dependencies block', 'unknown files pass through');
});

test('the client is written next to MainActivity, under the appId package path', () => {
  assert.equal(javaSourceDir('/x/android', 'in.addabaaz.app'), '/x/android/app/src/main/java/in/addabaaz/app');
});
