import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { lockPortrait, isPortraitLocked } from '../../mobile/scripts/android-manifest.mjs';

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

test('npm run android:patch locks the generated project, is idempotent, and fails loudly on an unknown manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-android-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    for (const f of ['patch-android.mjs', 'android-manifest.mjs']) fs.copyFileSync(new URL(f, SCRIPTS), path.join(dir, 'scripts', f));
    const manifest = path.join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, generated);
    const run = () => execFileSync(process.execPath, [path.join(dir, 'scripts', 'patch-android.mjs')], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

    const first = run();
    assert.match(first, /AndroidManifest\.xml: main activity locked to portrait/);
    const patched = fs.readFileSync(manifest, 'utf8');
    assert.equal(isPortraitLocked(patched), true);
    assert.equal(patched, lockPortrait(generated));

    const second = run();
    assert.equal(/locked to portrait/.test(second), false, 'a second run has nothing to change');
    assert.equal(fs.readFileSync(manifest, 'utf8'), patched);

    fs.writeFileSync(manifest, '<manifest><application><activity android:name=".SomethingElse"/></application></manifest>');
    assert.throws(run, (e) => /could not lock MainActivity to portrait/.test(String(e.stderr)), 'an unrecognised manifest stops the build instead of shipping a rotating app');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
