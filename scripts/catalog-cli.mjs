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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...flags] = process.argv.slice(2);
const cat = path.join(root, 'data/catalog.json'), stu = path.join(root, 'data/studio.json');
if (!['export', 'import'].includes(cmd)) { console.error('Usage: catalog-cli.mjs export | import --force'); process.exit(2); }
const db = await createDb();
try {
  await migrate(db);
  if (cmd === 'export') {
    const { catalog, studio } = await db.catalog.snapshot();
    if (!catalog.shows.length && !catalog.videos.length) { console.error('The database catalog is empty — nothing exported.'); process.exit(1); }
    fs.writeFileSync(cat, JSON.stringify(catalog, null, 1) + '\n'); if (studio) fs.writeFileSync(stu, JSON.stringify(studio, null, 1) + '\n');
    console.log(`✔ wrote data/catalog.json (${catalog.shows.length} shows, ${catalog.videos.length} videos, ${catalog.upcoming.length} upcoming, ${catalog.gallery.length} photos) and data/studio.json`);
  } else {
    if (!flags.includes('--force')) { console.error('This REPLACES the catalog in MySQL with the JSON files. Re-run with --force.'); process.exit(1); }
    const data = JSON.parse(fs.readFileSync(cat, 'utf8')), studio = JSON.parse(fs.readFileSync(stu, 'utf8'));
    const problems = checkCatalog(data, studio, { fileExists: (rel) => fs.existsSync(path.join(root, rel)) });
    if (problems.length) { console.error('Refusing to import an invalid catalog:\n - ' + problems.join('\n - ')); process.exit(1); }
    await db.pool.query("DELETE FROM catalog_items");
    await db.pool.query("DELETE FROM catalog_meta WHERE k = 'seeded'");
    await db.catalog.seed(data, studio);
    console.log(`✔ imported ${data.shows.length} shows, ${data.videos.length} videos, ${data.upcoming.length} upcoming, ${data.gallery.length} photos`);
  }
} finally { await db.close(); }
