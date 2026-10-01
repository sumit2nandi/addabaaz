/* Builds minified copies of the site's front-end under .build/ so production never serves readable
 * source code (comments, formatting): the browser gets the same URLs (/app/…, /sw.js) with minified
 * bodies. index.js runs this once at boot; if it ever fails, the server simply serves the original
 * files (nothing breaks, only the minification guarantee is lost). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minifyTree, minifyFile } from '../../scripts/lib/minify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUILD_DIR = path.join(ROOT, '.build');

/** True when a complete minified mirror exists (app tree + service worker). */
export const webAssetsReady = () => fs.existsSync(path.join(BUILD_DIR, 'app', 'js', 'main.js')) && fs.existsSync(path.join(BUILD_DIR, 'sw.js'));

/** Rebuilds .build/app and .build/sw.js from the sources. Returns sizes for the boot log. */
export async function prepareWebAssets() {
  fs.rmSync(path.join(BUILD_DIR, 'app'), { recursive: true, force: true });
  const min = await minifyTree(path.join(ROOT, 'app'), path.join(BUILD_DIR, 'app'));
  await minifyFile(path.join(ROOT, 'sw.js'), path.join(BUILD_DIR, 'sw.js'));
  return min;
}
