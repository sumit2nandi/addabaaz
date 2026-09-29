#!/usr/bin/env node
/* Validates data/catalog.json + data/studio.json (the seed / static export) with the same rules the admin console enforces,
 * and that every referenced local image exists.   Run: npm run validate:catalog   — wired into CI. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCatalog } from '../server/src/catalog-schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cat = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8'));
const studio = JSON.parse(fs.readFileSync(path.join(root, 'data/studio.json'), 'utf8'));
const problems = checkCatalog(cat, studio, { fileExists: (rel) => fs.existsSync(path.join(root, rel)) });
if (problems.length) { console.error(`✖ catalog has ${problems.length} problem(s):\n - ` + problems.join('\n - ')); process.exit(1); }
const by = (k) => cat.videos.filter((v) => v.kind === k).length;
console.log(`✔ catalog OK — ${cat.shows.length} shows, ${by('episode')} episodes, ${by('reel')} reels, ${by('trailer') + by('clip')} trailers/clips, ${cat.upcoming.length} upcoming, ${cat.gallery.length} gallery photos`);
