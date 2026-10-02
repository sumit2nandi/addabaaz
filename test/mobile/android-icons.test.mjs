// The APK must install with the website logo as its launcher icon: patch-android stamps the
// pre-rendered logo PNGs (mobile/android-icons/) over the stock Capacitor ones in every generated
// project. Run: node --test test/mobile/android-icons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stampLauncherIcons, ICON_SOURCE } from '../../mobile/scripts/android-icons.mjs';

const DENSITIES = ['mdpi', 'hdpi', 'xxhdpi', 'xxxhdpi', 'xhdpi'];

test('the repo ships a full logo icon set (all densities + playstore)', () => {
  for (const d of DENSITIES) {
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png']) {
      assert.ok(fs.existsSync(path.join(ICON_SOURCE, d, f)), `${d}/${f} exists`);
    }
  }
  assert.ok(fs.existsSync(path.join(ICON_SOURCE, 'ic_launcher_playstore.png')), 'playstore icon exists');
});

test('stampLauncherIcons replaces the stock icons and drops the adaptive XML', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-icons-'));
  const res = path.join(tmp, 'app', 'src', 'main', 'res');
  fs.mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true });
  fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), '<adaptive-icon/>');
  fs.mkdirSync(path.join(res, 'mipmap-mdpi'), { recursive: true });
  fs.writeFileSync(path.join(res, 'mipmap-mdpi', 'ic_launcher.png'), 'stock capacitor bot');

  const done = stampLauncherIcons(tmp);

  assert.equal(fs.existsSync(path.join(res, 'mipmap-anydpi-v26')), false, 'adaptive XML removed so the logo PNGs win');
  for (const d of DENSITIES) {
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const target = path.join(res, `mipmap-${d}`, f);
      assert.ok(fs.existsSync(target), `${d}/${f} stamped`);
      assert.ok(fs.readFileSync(target).equals(fs.readFileSync(path.join(ICON_SOURCE, d, f))), `${d}/${f} is the logo asset`);
    }
  }
  assert.ok(fs.existsSync(path.join(res, 'drawable', 'ic_launcher_playstore.png')), 'playstore icon stamped');
  assert.ok(!fs.readFileSync(path.join(res, 'mipmap-mdpi', 'ic_launcher.png')).equals(Buffer.from('stock capacitor bot')), 'stock icon replaced');
  assert.ok(done.length >= 11);

  assert.doesNotThrow(() => stampLauncherIcons(tmp), 'running it twice (every sync) is fine');
  fs.rmSync(tmp, { recursive: true, force: true });
});
