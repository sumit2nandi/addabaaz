import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const assets = path.join(root, 'native/App/App/Assets.xcassets');
const source = path.resolve(root, '../images/addabaaz-logo.png');
// App Store icons must be opaque. iOS supplies the rounded icon mask itself.
await sharp(source).resize(1024, 1024, { fit: 'contain', background: '#050505' })
  .flatten({ background: '#050505' }).removeAlpha().png()
  .toFile(path.join(assets, 'AppIcon.appiconset/AppIcon-512@2x.png'));
const folder = path.join(assets, 'BrandLogo.imageset');
await fs.mkdir(folder, { recursive: true });
const images = [];
for (const scale of [1, 2, 3]) {
  const filename = `logo-${scale}x.png`;
  await sharp(source).resize(180 * scale, 180 * scale).flatten({ background: '#050505' })
    .removeAlpha().png().toFile(path.join(folder, filename));
  images.push({ idiom: 'universal', filename, scale: `${scale}x` });
}
await fs.writeFile(path.join(folder, 'Contents.json'), JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
console.log('iOS app icon and launch artwork updated.');
