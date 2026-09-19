#!/usr/bin/env node
/**
 * Mirrors the site's media folders (which live at the repository root and are
 * shared with the legacy static site) into `public/`, where Angular's build
 * picks them up.
 *
 * Files are hard-linked when possible, so syncing costs no extra disk space.
 * The synced folders are git-ignored: the root folders stay the single source
 * of truth.
 *
 * Run automatically before `npm start` / `npm run build`, or manually with:
 *   npm run sync:assets
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  linkSync,
  copyFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const repoRoot = resolve(projectRoot, '..');
const publicDir = join(projectRoot, 'public');

const folders = ['images', 'BTS', 'UpcomingReleases'];

function syncFile(source, target) {
  const sourceStat = statSync(source);
  if (existsSync(target)) {
    const targetStat = statSync(target);
    if (targetStat.size === sourceStat.size && targetStat.mtimeMs >= sourceStat.mtimeMs)
      return false;
    rmSync(target, { force: true });
  }
  mkdirSync(dirname(target), { recursive: true });
  try {
    linkSync(source, target);
  } catch {
    copyFileSync(source, target);
  }
  return true;
}

function syncFolder(source, target) {
  let changed = 0;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      changed += syncFolder(sourcePath, targetPath);
    } else if (entry.isFile()) {
      if (syncFile(sourcePath, targetPath)) changed++;
    }
  }
  return changed;
}

let total = 0;
for (const folder of folders) {
  const source = join(repoRoot, folder);
  const target = join(publicDir, folder);

  if (!existsSync(source)) {
    console.warn(`[sync:assets] ${folder}/ not found at the repository root — skipping.`);
    continue;
  }

  // A previous symlink (or a stale copy) must not linger.
  if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });

  const changed = syncFolder(source, target);
  total += changed;
  console.log(`[sync:assets] ${folder}/ → public/${folder}/ (${changed} file(s) updated)`);
}

console.log(`[sync:assets] done — ${total} file(s) synced.`);
