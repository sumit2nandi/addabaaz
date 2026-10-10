#!/usr/bin/env node
/* Move the catalog between MySQL (edited in /admin) and the JSON files.
 *   npm run catalog:export           MySQL → data/catalog.json + data/studio.json   (static hosting, mobile bundle, backups, git)
 *   npm run catalog:import -- --force  JSON files → MySQL, REPLACING what is in the database (the first start seeds automatically) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../server/src/db.js';
import { migrate } from '../server/src/migrate.js';
import { checkCatalog } from '../server/src/catalog-schema.js';
import { createR2 } from '../server/src/r2.js';

// Locations of the JSON files the catalog is exported to / imported from.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...flags] = process.argv.slice(2);
const cat = path.join(root, 'data/catalog.json'), stu = path.join(root, 'data/studio.json');
const r2PhotoPathsIn = (value, found = new Set()) => {
  if (typeof value === 'string' && value.startsWith('r2-assets/catalog/')) found.add(value);
  else if (Array.isArray(value)) value.forEach((item) => r2PhotoPathsIn(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => r2PhotoPathsIn(item, found));
  return found;
};
async function verifyR2Photos(data, studio) {
  const paths = [...new Set([...r2PhotoPathsIn(data), ...r2PhotoPathsIn(studio)])];
  if (!paths.length) return new Set();
  const r2 = createR2();
  if (!r2.configured) throw new Error('The catalog contains R2 photo paths; configure R2 credentials and bucket access before importing.');
  const verified = new Set();
  for (let i = 0; i < paths.length; i += 20) {
    await Promise.all(paths.slice(i, i + 20).map(async (photoPath) => {
      const name = photoPath.slice('r2-assets/catalog/'.length);
      let head;
      try { head = await r2.head(`catalog/${name}`); }
      catch (e) { throw new Error(`Could not verify R2 photo “${photoPath}”: ${e?.message || 'R2 is unreachable'}`); }
      if (head.status !== 200) throw new Error(`R2 photo “${photoPath}” was not found in the configured bucket (HTTP ${head.status}).`);
      verified.add(photoPath);
    }));
  }
  return verified;
}
// Only two commands exist: export and import.
if (!['export', 'import'].includes(cmd)) { console.error('Usage: catalog-cli.mjs export | import --force'); process.exit(2); }
const db = await createDb();
try {
  await migrate(db);
  // EXPORT: write the catalog stored in MySQL out as JSON (for static hosting, the mobile bundle or version control).
  if (cmd === 'export') {
    const { catalog, studio } = await db.catalog.snapshot();
    if (!catalog.shows.length && !catalog.videos.length) { console.error('The database catalog is empty — nothing exported.'); process.exit(1); }
    const out = { ...catalog, homePosters: studio?.homePosters || catalog.homePosters || {} };
    fs.writeFileSync(cat, JSON.stringify(out, null, 1) + '\n'); if (studio) fs.writeFileSync(stu, JSON.stringify(studio, null, 1) + '\n');
    console.log(`✔ wrote data/catalog.json (${catalog.shows.length} shows, ${catalog.videos.length} videos, ${catalog.upcoming.length} upcoming, ${catalog.gallery.length} photos) and data/studio.json`);
  // IMPORT: replace the database catalog with the JSON files. Destructive, so it needs --force; local files and any referenced R2 photo objects are verified before MySQL is changed.
  } else {
    if (!flags.includes('--force')) { console.error('This REPLACES the catalog in MySQL with the JSON files. Re-run with --force.'); process.exit(1); }
    const data = JSON.parse(fs.readFileSync(cat, 'utf8')), studioFile = JSON.parse(fs.readFileSync(stu, 'utf8'));
    const studio = { ...studioFile, homePosters: data.homePosters || studioFile.homePosters || {} };
    const fileExists = (rel) => fs.existsSync(path.join(root, rel));
    const localProblems = checkCatalog(data, studio, { fileExists });
    if (localProblems.length) { console.error('Refusing to import an invalid catalog:\n - ' + localProblems.join('\n - ')); process.exit(1); }
    let verifiedR2Photos;
    try { verifiedR2Photos = await verifyR2Photos(data, studio); }
    catch (e) { console.error(`Refusing to import catalog: ${e.message}`); process.exit(1); }
    const problems = checkCatalog(data, studio, { fileExists, r2FileExists: (photoPath) => verifiedR2Photos.has(photoPath) });
    if (problems.length) { console.error('Refusing to import an invalid catalog:\n - ' + problems.join('\n - ')); process.exit(1); }
    await db.pool.query("DELETE FROM catalog_items");
    await db.pool.query("DELETE FROM catalog_meta WHERE k = 'seeded'");
    await db.catalog.seed(data, studio);
    console.log(`✔ imported ${data.shows.length} shows, ${data.videos.length} videos, ${data.upcoming.length} upcoming, ${data.gallery.length} photos`);
  }
} finally { await db.close(); }
