import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const resources = path.join(appRoot, 'native/app/src/main/res');
const source = path.resolve(appRoot, '../images/addabaaz-logo.png');
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
async function branded(width, height, size, output, transparent = false) {
  const logo = await sharp(source).resize(size, size, { fit: 'contain', background: '#050505' }).png().toBuffer();
  await sharp({ create: { width, height, channels: 4, background: transparent ? '#00000000' : '#050505' } })
    .composite([{ input: logo, gravity: 'centre' }]).png().toFile(output);
}
for (const [name, scale] of Object.entries(densities)) {
  const folder = path.join(resources, `mipmap-${name}`);
  for (const filename of ['ic_launcher.png', 'ic_launcher_round.png']) {
    await branded(48 * scale, 48 * scale, Math.round(42 * scale), path.join(folder, filename));
  }
  await branded(108 * scale, 108 * scale, Math.round(64 * scale), path.join(folder, 'ic_launcher_foreground.png'), true);
}
for (const directory of await fs.readdir(resources)) {
  if (!directory.startsWith('drawable')) continue;
  const splash = path.join(resources, directory, 'splash.png');
  try {
    const { width, height } = await sharp(splash).metadata();
    await branded(width, height, Math.round(Math.min(width, height) * 0.35), splash);
  } catch (error) { if (!error.message.includes('Input file is missing')) throw error; }
}
await branded(288, 288, 176, path.join(resources, 'drawable/splash_logo.png'), true);
console.log('Android launcher and splash artwork updated.');
