#!/usr/bin/env node
/* Validates data/catalog.json (and that every referenced image exists).
 * Run: npm run validate:catalog   — wire it into CI so a typo can never break the app. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cat = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8'));
const errors = [];
const err = (m) => errors.push(m);
const dupes = (arr, label) => { const seen = new Set(); arr.forEach((x) => { if (seen.has(x)) err(`duplicate ${label}: ${x}`); seen.add(x); }); };
const fileOk = (rel, ctx) => { if (rel && !fs.existsSync(path.join(root, rel))) err(`${ctx}: missing file ${rel}`); };

dupes(cat.shows.map((s) => s.id), 'show id');
dupes(cat.videos.map((v) => v.id), 'video id');
dupes(cat.upcoming.map((u) => u.id), 'upcoming id');
dupes(cat.gallery.map((g) => g.id), 'gallery id');

const showIds = new Set(cat.shows.map((s) => s.id)), soonIds = new Set(cat.upcoming.map((u) => u.id));
for (const s of cat.shows) {
  for (const k of ['id', 'title', 'description', 'poster']) if (!s[k]) err(`show ${s.id}: missing ${k}`);
  fileOk(s.poster, `show ${s.id}`); fileOk(s.posterLg, `show ${s.id}`);
}
for (const v of cat.videos) {
  const c = `video ${v.id}`;
  if (!v.title) err(`${c}: missing title`);
  if (!['episode', 'trailer', 'reel', 'clip'].includes(v.kind)) err(`${c}: bad kind "${v.kind}"`);
  if (v.showId && !showIds.has(v.showId) && !soonIds.has(v.showId)) err(`${c}: unknown showId "${v.showId}"`);
  if (!v.source || !['youtube', 'mp4', 'hls'].includes(v.source.type)) err(`${c}: bad source`);
  else if (v.source.type === 'youtube' && !/^[\w-]{11}$/.test(v.source.id || '')) err(`${c}: bad YouTube id`);
  else if (v.source.type !== 'youtube' && !/^https?:\/\//.test(v.source.url || '')) err(`${c}: ${v.source.type} needs an absolute url`);
  if (!(v.duration >= 0)) err(`${c}: duration must be seconds`);
  if (isNaN(Date.parse(v.publishedAt))) err(`${c}: bad publishedAt`);
  if (!['free', 'premium'].includes(v.access)) err(`${c}: access must be free|premium`);
}
for (const u of cat.upcoming) { fileOk(u.poster, `upcoming ${u.id}`); fileOk(u.posterLg, `upcoming ${u.id}`); fileOk(u.backdrop, `upcoming ${u.id}`); }
for (const g of cat.gallery) { fileOk(g.image, `gallery ${g.id}`); fileOk(g.imageLg, `gallery ${g.id}`); }
const studio = JSON.parse(fs.readFileSync(path.join(root, 'data/studio.json'), 'utf8'));
for (const t of studio.team) fileOk(t.photo, `team ${t.name}`);

if (errors.length) { console.error(`✖ catalog has ${errors.length} problem(s):\n - ` + errors.join('\n - ')); process.exit(1); }
const by = (k) => cat.videos.filter((v) => v.kind === k).length;
console.log(`✔ catalog OK — ${cat.shows.length} shows, ${by('episode')} episodes, ${by('reel')} reels, ${by('trailer') + by('clip')} trailers/clips, ${cat.upcoming.length} upcoming, ${cat.gallery.length} gallery photos`);
