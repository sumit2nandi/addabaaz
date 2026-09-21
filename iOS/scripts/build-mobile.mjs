// A separate, allowlisted iOS payload. Never copy the repository into the app.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { build } from 'esbuild';
import { readWorkbook } from '../../assets/js/workbook.js';
import { pairs } from '../../assets/js/workbook.js';
import { runtimeData } from '../../assets/js/site-content.js';

globalThis.ExcelJS = ExcelJS;
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(appRoot, '..');
const output = path.join(appRoot, 'www');
const tables = await readWorkbook(await fs.readFile(path.join(root, 'data/website.xlsx')));
const { FORM_CONFIG, ...runtime } = runtimeData(tables);
const components = ['home', 'player', 'upcoming', 'bts', 'video-preview', 'poster-preview', 'modal'];
const scripts = ['helpers', 'hero', 'video-preview', 'galleries', 'featured-upcoming', 'poster-preview', 'navigation', 'catalog', 'app'];
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, 'assets'), { recursive: true });
await fs.mkdir(path.join(output, 'media'), { recursive: true });

const media = new Map();
async function bundleImage(source) {
  if (!source || /^https:\/\//i.test(source)) return source;
  if (/^http:\/\//i.test(source)) throw new Error(`iOS requires HTTPS for external images: ${source}`);
  if (media.has(source)) return media.get(source);
  const input = await fs.realpath(path.resolve(root, source));
  if (!input.startsWith(root + path.sep)) throw new Error(`Image must be inside the repository: ${source}`);
  const bytes = await fs.readFile(input);
  const name = createHash('sha256').update(bytes).digest('hex').slice(0, 16) + '.webp';
  const destination = `media/${name}`;
  await sharp(bytes).rotate().resize(1440, 1440, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(output, destination));
  media.set(source, destination);
  return destination;
}
for (const show of Object.values(runtime.projectDetails)) {
  show.image = await bundleImage(show.image);
  for (const episode of show.episodes) episode.thumbnail = await bundleImage(episode.thumbnail);
}
for (const promo of runtime.promoVideos) promo.thumbnail = await bundleImage(promo.thumbnail);
for (const [rows, folderKey] of [[runtime.upcomingReleases, 'UPCOMING_FOLDER'], [runtime.behindTheScenes, 'BTS_FOLDER']]) {
  for (const row of rows) {
    const source = runtime[folderKey] + row.file;
    // Gallery filenames are deliberately relative to the packaged media folder.
    if (/^https?:/i.test(source)) throw new Error('Bundle gallery images locally before building the app.');
    row.file = (await bundleImage(source)).replace(/^media\//, '');
  }
  runtime[folderKey] = 'media/';
}
const prefixes = components.map(name => `${name}.`);
const copy = Object.fromEntries(Object.entries(pairs(tables.Copy)).filter(([key]) => prefixes.some(prefix => key.startsWith(prefix))));
await fs.writeFile(path.join(output, 'content.json'), JSON.stringify({ schemaVersion: 1, copy, runtime }));
await fs.copyFile(path.join(root, 'images/addabaaz-logo-small.webp'), path.join(output, 'assets/logo.webp'));
for (const name of ['site', 'splash']) await fs.copyFile(path.join(root, `assets/css/${name}.css`), path.join(output, `assets/${name}.css`));
await fs.copyFile(path.join(appRoot, 'web/mobile.css'), path.join(output, 'assets/mobile.css'));
const templates = await Promise.all(components.map(name => fs.readFile(path.join(root, `components/${name}.html`), 'utf8')));
const shell = await fs.readFile(path.join(appRoot, 'web/index.html'), 'utf8');
await fs.writeFile(path.join(output, 'index.html'), shell.replace('<!-- APP_COMPONENTS -->', templates.join('\n')));
// Concatenation preserves the legacy scripts' shared scope and ordering. The app
// entry + Capacitor plugin are bundled alongside them; no Excel parser is shipped.
const legacy = (await Promise.all(scripts.map(name => fs.readFile(path.join(root, `assets/js/site/${name}.js`), 'utf8')))).join('\n');
const entry = await fs.readFile(path.join(appRoot, 'web/app.js'), 'utf8');
await build({ stdin: { contents: legacy + '\n' + entry, resolveDir: appRoot, sourcefile: 'mobile-entry.js' },
  bundle: true, format: 'iife', target: 'safari15', minify: true,
  outfile: path.join(output, 'assets/app.js'), legalComments: 'eof' });
console.log(`iOS web bundle built: ${media.size} optimized images; no workbook, ExcelJS, admin or non-home sections.`);
