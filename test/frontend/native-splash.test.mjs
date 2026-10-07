import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../../index.html');
const css = read('../../app/css/styles.css');
const platform = read('../../app/js/platform.js');
const main = read('../../app/js/main.js');
const config = JSON.parse(read('../../mobile/capacitor.config.json'));
const mobilePackage = JSON.parse(read('../../mobile/package.json'));

test('the Capacitor boot screen is a branded, accessible, indeterminate loader', () => {
  assert.match(html, /class="boot-native" role="status" aria-live="polite" aria-busy="true"/);
  assert.match(html, /<strong class="boot-native-title">ADDABAAZ<\/strong>/);
  assert.match(html, /class="boot-native-progress" role="progressbar" aria-label="Loading ADDABAAZ"/);
  const progress = html.match(/<div class="boot-native-progress"[^>]*>/)?.[0] || '';
  assert.ok(progress, 'the native loader has a progress indicator');
  assert.doesNotMatch(progress, /aria-valuenow/, 'the moving bar does not claim a measured percentage');
  assert.match(html, /class="boot-web" aria-hidden="true"/, 'the existing compact web loader remains separate');
});

test('only Android and iOS turn the boot screen into the full-viewport red launch overlay', () => {
  assert.match(css, /html\[data-platform="android"\] #boot, html\[data-platform="ios"\] #boot \{[^}]*position: fixed;[^}]*inset: 0;[^}]*background: #b80000;/);
  assert.match(css, /html\[data-platform="android"\] #boot \.boot-web, html\[data-platform="ios"\] #boot \.boot-web \{ display: none; \}/);
  assert.match(css, /html\[data-platform="android"\] #boot \.boot-native, html\[data-platform="ios"\] #boot \.boot-native \{ display: flex;/);
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

test('native splash assets and system bars use the same launch color', () => {
  assert.equal(config.backgroundColor, '#b80000');
  assert.equal(config.android.backgroundColor, '#b80000');
  assert.equal(config.plugins.SplashScreen.backgroundColor, '#b80000');
  assert.equal(config.plugins.SplashScreen.launchAutoHide, false);
  assert.equal(config.plugins.StatusBar.style, 'LIGHT');
  assert.equal(config.plugins.StatusBar.backgroundColor, '#b80000');
  assert.match(mobilePackage.scripts.assets, /--splashBackgroundColor "#b80000"/);
  assert.match(mobilePackage.scripts.assets, /--splashBackgroundColorDark "#b80000"/);
});
