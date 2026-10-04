// The APK must install with the website logo as its launcher icon: patch-android stamps the
// pre-rendered logo PNGs (mobile/android-icons/) over the stock Capacitor ones in every generated
// project. Run: node --test test/mobile/android-icons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { stampLauncherIcons, ICON_SOURCE } from '../../mobile/scripts/android-icons.mjs';

const DENSITIES = ['mdpi', 'hdpi', 'xxhdpi', 'xxxhdpi', 'xhdpi'];

// Read the top-left pixel's alpha from the first PNG scanline. Its filter predictor is zero for
// the first pixel, so the stored alpha byte is also the decoded alpha for that corner.
function topLeftAlpha(file) {
  const png = fs.readFileSync(file);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${file} is PNG`);
  let offset = 8, bitDepth, colorType, interlace;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    if (type === 'IDAT') idat.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  assert.equal(bitDepth, 8, `${file} uses 8-bit channels`);
  assert.equal(colorType, 6, `${file} has an RGBA alpha channel`);
  assert.equal(interlace, 0, `${file} is non-interlaced`);
  return inflateSync(Buffer.concat(idat))[4];
}

test('the repo ships a full logo icon set (all densities + playstore)', () => {
  for (const d of DENSITIES) {
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png']) {
      assert.ok(fs.existsSync(path.join(ICON_SOURCE, d, f)), `${d}/${f} exists`);
    }
  }
  assert.ok(fs.existsSync(path.join(ICON_SOURCE, 'ic_launcher_playstore.png')), 'playstore icon exists');
});

test('Android and OAuth logo assets have transparent corners around the round mark', () => {
  const files = [
    ...DENSITIES.flatMap((d) => ['ic_launcher.png', 'ic_launcher_round.png'].map((f) => path.join(ICON_SOURCE, d, f))),
    path.join(ICON_SOURCE, 'ic_launcher_playstore.png'),
    new URL('../../resources/icon-only.png', import.meta.url),
  ];
  for (const file of files) assert.equal(topLeftAlpha(file), 0, `${file} has no opaque square corner`);
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
