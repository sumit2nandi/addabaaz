import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stampNativeLaunchHtml, hasNativeLaunchMarker } from '../../mobile/scripts/stamp-native-launch.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../../index.html');
const css = read('../../app/css/styles.css');
const platform = read('../../app/js/platform.js');
const main = read('../../app/js/main.js');
const config = JSON.parse(read('../../mobile/capacitor.config.json'));
const mobilePackage = JSON.parse(read('../../mobile/package.json'));

test('the Capacitor boot screen is a branded, accessible, indeterminate loader', () => {
  assert.match(html, /class="boot-native" role="status" aria-live="polite" aria-busy="true"/);
  assert.match(html, /<img class="boot-native-logo" src="media\/icons\/icon-512\.png"[^>]*alt="ADDABAAZ"/,
    'the highlighted area shows only the brand logo');
  assert.doesNotMatch(html, /boot-native-title|boot-native-tagline/, 'no separate wordmark or tagline around the logo');
  assert.match(html, /class="boot-native-progress" role="progressbar" aria-label="Loading ADDABAAZ"/);
  const progress = html.match(/<div class="boot-native-progress"[^>]*>/)?.[0] || '';
  assert.ok(progress, 'the native loader has a progress indicator');
  assert.doesNotMatch(progress, /aria-valuenow/, 'the moving bar does not claim a measured percentage');
  assert.match(html, /class="boot-web" aria-hidden="true"/, 'the existing compact web loader remains separate');
});

test('only Android and iOS turn the boot screen into the full-viewport brand-red launch canvas (the logo colour)', () => {
  assert.match(css, /html\[data-platform="android"\] #boot, html\[data-platform="ios"\] #boot, html\[data-app="native"\] #boot \{[^}]*position: fixed;[^}]*inset: 0;[^}]*background: #b80000;/);
  assert.match(css, /html\[data-platform="android"\] #boot \.boot-web, html\[data-platform="ios"\] #boot \.boot-web, html\[data-app="native"\] #boot \.boot-web \{ display: none; \}/);
  assert.match(css, /html\[data-platform="android"\] #boot \.boot-native, html\[data-platform="ios"\] #boot \.boot-native, html\[data-app="native"\] #boot \.boot-native \{ display: flex;/);
  assert.match(css, /@keyframes native-boot-progress/);
});

test('native launch hands off to HTML quickly and keeps it up through first-route readiness', () => {
  assert.match(platform, /document\.documentElement\.dataset\.platform = platform;/);
  assert.match(platform, /const afterPaint = window\.requestAnimationFrame\?\.bind\(window\)/,
    'native WebViews use animation frames to avoid flashing between splashes');
  assert.match(platform, /afterPaint\(\(\) => afterPaint\(hideNativeSplash\)\)/,
    'the OS splash is hidden after the HTML loader can paint, without waiting for API startup');
  assert.match(platform, /window\.addEventListener\('ab:ready',[\s\S]*?setBackgroundColor\?\.\(\{ color: '#050505' \}\)/,
    'the regular dark status bar is restored after the first route');
  assert.match(main, /ab:ready/, 'the router signals when its first route is ready');
});

test('native splash assets and system bars use the same launch color (logo red)', () => {
  assert.equal(config.backgroundColor, '#b80000');
  assert.equal(config.android.backgroundColor, '#b80000');
  assert.equal(config.plugins.SplashScreen.backgroundColor, '#b80000');
  assert.equal(config.plugins.SplashScreen.launchAutoHide, false);
  assert.equal(config.plugins.StatusBar.style, 'LIGHT');
  assert.equal(config.plugins.StatusBar.backgroundColor, '#b80000');
  assert.match(mobilePackage.scripts.assets, /--splashBackgroundColor "#b80000"/);
  assert.match(mobilePackage.scripts.assets, /--splashBackgroundColorDark "#b80000"/);
});

test('the platform is marked before the first paint, so the web loader never flashes on a native launch', () => {
  assert.match(html, /<script src="app\/launch-platform\.js"><\/script>/,
    'the early platform marker loads from <head>');
  const early = read('../../app/launch-platform.js');
  assert.match(early, /window\.Capacitor && window\.Capacitor\.isNativePlatform/, 'it makes the same native check platform.js makes');
  assert.match(early, /dataset\.app = 'native'/, 'it marks the shell, not the platform');
  assert.match(early, /dataset\.platform = early/, 'it claims the exact platform only when it is already known');
  assert.doesNotMatch(early, /dataset\.platform = window\.Capacitor\.getPlatform\(\)/,
    'never stamp getPlatform() blindly: it still reports "web" before the native bridge object exists');
  assert.match(platform, /document\.documentElement\.dataset\.platform = platform;/, 'platform.js still sets it for the rest of the boot');

  // Run the head script the way a browser would: Capacitor's runtime is injected right after <head>,
  // so it is already defined when this executes.
  const run = (capacitor) => {
    const el = { dataset: {} };
    new Function('window', 'document', early)({ Capacitor: capacitor }, { documentElement: el });
    return el.dataset;
  };
  assert.deepEqual(run({ isNativePlatform: () => true, getPlatform: () => 'android' }), { app: 'native', platform: 'android' },
    'a native launch is marked, so the native launch screen is the very first frame');
  assert.deepEqual(run({ isNativePlatform: () => true, getPlatform: () => 'ios' }), { app: 'native', platform: 'ios' }, 'iOS as well');
  // The regression that kept the flash alive: Capacitor's bridge object (window.androidBridge) is not
  // injected yet at this point, so getPlatform() lies and answers "web".
  assert.deepEqual(run({ isNativePlatform: () => true, getPlatform: () => 'web' }), { app: 'native' },
    'an unknown platform still marks the shell, and never claims "web"');
  assert.deepEqual(run(undefined), {}, 'a browser launch is left unmarked for platform.js');

  // It has to survive an offline launch too, or the first frame after a cold start would be the web loader.
  const sw = read('../../sw.js');
  assert.match(sw, /'app\/launch-platform\.js'/, 'the head script is precached for offline launches');
});

test('the packaged native index.html is stamped, so the first frame needs no JavaScript at all', () => {
  // JavaScript cannot be trusted for the first frame: it depends on when Capacitor injects its
  // runtime and on when the native bridge object appears. So the generated copy of index.html - the
  // one the WebView actually serves - carries the marker itself.
  const marked = stampNativeLaunchHtml(html);
  assert.equal(hasNativeLaunchMarker(marked), true, 'the stamp adds the marker');
  assert.match(marked, /<html lang="en" data-app="native">/, 'it rides on the <html> tag');
  assert.equal(marked.replace(' data-app="native"', ''), html, 'and changes nothing else');
  assert.equal(stampNativeLaunchHtml(marked), marked, 'idempotent: every `cap sync` can re-stamp safely');
  assert.equal(hasNativeLaunchMarker(html), false,
    'the repository copy - which is also the website bundle - stays unmarked, or addabaaz.in would show the launch screen');

  // Both platform patches apply it to their generated copy of index.html.
  const android = read('../../mobile/scripts/patch-android.mjs');
  assert.match(android, /stampNativeLaunchHtml\(t\)/, 'patch-android.mjs stamps the packaged HTML');
  assert.match(android, /app\/src\/main\/assets\/public\/index\.html/, 'on the file `cap sync` generates');
  const ios = read('../../mobile/scripts/patch-ios.mjs');
  assert.match(ios, /stampNativeLaunchFile\(PUBLIC_INDEX\)/, 'patch-ios.mjs does the same for iOS');
});
