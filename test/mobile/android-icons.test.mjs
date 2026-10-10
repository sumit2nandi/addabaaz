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

// Read the top-left pixel from the first PNG scanline. Its filter predictor is zero for the first
// pixel, so the stored RGBA bytes are also the decoded color for that corner.
function topLeftRgba(file) {
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
  const row = inflateSync(Buffer.concat(idat));
  return { r: row[1], g: row[2], b: row[3], a: row[4] };
}

test('the repo ships a full logo icon set (all densities + playstore)', () => {
  for (const d of DENSITIES) {
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      assert.ok(fs.existsSync(path.join(ICON_SOURCE, d, f)), `${d}/${f} exists`);
    }
  }
  assert.ok(fs.existsSync(path.join(ICON_SOURCE, 'ic_launcher_playstore.png')), 'playstore icon exists');
});

test('Android launcher keeps the white tile with a large transparent round foreground', () => {
  const tileFiles = [
    ...DENSITIES.flatMap((d) => ['ic_launcher.png', 'ic_launcher_round.png'].map((f) => path.join(ICON_SOURCE, d, f))),
    path.join(ICON_SOURCE, 'ic_launcher_playstore.png'),
  ];
  const roundForegrounds = DENSITIES.map((d) => path.join(ICON_SOURCE, d, 'ic_launcher_foreground.png'));
  for (const file of tileFiles) assert.deepEqual(topLeftRgba(file), { r: 255, g: 255, b: 255, a: 255 }, `${file} keeps the earlier white tile`);
  for (const file of roundForegrounds) assert.equal(topLeftRgba(file).a, 0, `${file} preserves the circular foreground`);
  assert.equal(topLeftRgba(new URL('../../resources/icon-only.png', import.meta.url)).a, 0, 'OAuth logo has transparent corners to show its round shape');
});

test('stampLauncherIcons replaces stock icons with the branded adaptive foreground/background', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-icons-'));
  const res = path.join(tmp, 'app', 'src', 'main', 'res');
  fs.mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true });
  fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), '<adaptive-icon/>');
  fs.mkdirSync(path.join(res, 'mipmap-mdpi'), { recursive: true });
  fs.writeFileSync(path.join(res, 'mipmap-mdpi', 'ic_launcher.png'), 'stock capacitor bot');

  const done = stampLauncherIcons(tmp);
  const adaptiveDir = path.join(res, 'mipmap-anydpi-v26');
  for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const xml = fs.readFileSync(path.join(adaptiveDir, f), 'utf8');
    assert.match(xml, /<background android:drawable="@color\/addabaaz_icon_background" \/>/, `${f} uses the earlier white tile background`);
    assert.match(xml, /<foreground android:drawable="@mipmap\/ic_launcher_foreground" \/>/, `${f} uses the large circular logo`);
  }
  assert.match(fs.readFileSync(path.join(res, 'values', 'addabaaz_icon_colors.xml'), 'utf8'), /#FFFFFF/, 'adaptive background is white');
  for (const d of DENSITIES) {
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const target = path.join(res, `mipmap-${d}`, f);
      assert.ok(fs.existsSync(target), `${d}/${f} stamped`);
      assert.ok(fs.readFileSync(target).equals(fs.readFileSync(path.join(ICON_SOURCE, d, f))), `${d}/${f} is the logo asset`);
    }
  }
  assert.ok(fs.existsSync(path.join(res, 'drawable', 'ic_launcher_playstore.png')), 'playstore icon stamped');
  assert.ok(!fs.readFileSync(path.join(res, 'mipmap-mdpi', 'ic_launcher.png')).equals(Buffer.from('stock capacitor bot')), 'stock icon replaced');
  assert.ok(done.length >= 20);

  assert.doesNotThrow(() => stampLauncherIcons(tmp), 'running it twice (every sync) is fine');
  fs.rmSync(tmp, { recursive: true, force: true });
});
