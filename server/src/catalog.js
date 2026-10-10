import fs from 'node:fs';

/**
 * The catalog as the API sees it: stored in MySQL (edited from the admin console), cached in memory.
 * - First start: the database is seeded ONCE from data/catalog.json + data/studio.json (later edits live in MySQL).
 * - Several servers stay in sync through the `version` counter that every write bumps (checked at most every `ttl` ms).
 */
// `ttl` is how long (ms) a loaded snapshot is trusted before the version counter is checked again.
export function createCatalogStore({ db, catalogPath, studioPath = null, ttl = 3000, log = console }) {
  // `snap` = everything (admin view), `pub` = what visitors may see; `version` detects changes made by other servers.
  let snap = null, pub = null, version = -1, checked = 0, seeding = null;

  // Seed files are optional; a missing or broken file is treated as empty.
  const readJson = (p) => { try { return p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch (e) { log.error?.(`[catalog] cannot read ${p}:`, e); return null; } };
  const seedHomePosters = readJson(studioPath)?.homePosters || readJson(catalogPath)?.homePosters || {};
  // Import data/catalog.json into MySQL once (only the first server to try wins; the rest skip).
  const ensureSeeded = () => seeding ||= (async () => {
    const data = readJson(catalogPath);
    if (data && await db.catalog.seed(data, readJson(studioPath))) console.log(`[catalog] imported ${data.shows?.length || 0} shows and ${data.videos?.length || 0} videos from ${catalogPath} into MySQL`);
  })().catch((e) => { seeding = null; throw e; });

  // Adds fast lookup tables and exposes the editable homepage banner artwork in the public catalog.
  const index = (catalog, studio, v) => ({
    catalog: { ...catalog, homePosters: { ...seedHomePosters, ...(catalog.homePosters || {}), ...(studio?.homePosters || {}) } },
    studio, version: v,
    showIds: new Set(catalog.shows.map((s) => s.id)), upcomingIds: new Set(catalog.upcoming.map((u) => u.id)),
    videoById: new Map(catalog.videos.map((x) => [x.id, x])),
  });
  /** The visitor's view: videos with a future `publishAt` are hidden; once due they appear with publishedAt = publishAt (so they sort and announce as new). */
  const publicView = (full, now) => {
    let dueAt = Infinity;
    const videos = [];
    for (const v of full.catalog.videos) {
      if (v.hidden) continue;
      if (!v.publishAt) { videos.push(v); continue; }
      const t = Date.parse(v.publishAt);
      if (t > now) { dueAt = Math.min(dueAt, t); continue; }
      const { publishAt, ...rest } = v; videos.push({ ...rest, publishedAt: publishAt });
    }
    if (videos.length === full.catalog.videos.length && !full.catalog.videos.some((v) => v.publishAt || v.hidden)) return { ...full, dueAt };
    return { ...index({ ...full.catalog, videos }, full.studio, full.version), dueAt };
  };

  // Public API of the store.
  const store = {
    /** Current snapshot: { catalog, studio, showIds, upcomingIds, videoById }. */
    async get({ all = false, fresh = false } = {}) {
      const now = Date.now();
      if (fresh || !(snap && now - checked < ttl)) {
        await ensureSeeded();
        const v = await db.catalog.version();
        if (!snap || v !== version) { const { catalog, studio } = await db.catalog.snapshot(); snap = index(catalog, studio, v); version = v; pub = null; }
        checked = now;
      }
      if (all) return snap;                                   // the admin console: everything, including scheduled items
      if (!pub || now >= pub.dueAt) pub = publicView(snap, now);
      return pub;
    },
    /** Call after every catalog write on this server so the very next read sees it. */
    invalidate() { snap = null; pub = null; version = -1; checked = 0; },
    async video(id) { return (await store.get()).videoById.get(id) || null; },
    async exists(type, id) {
      const s = await store.get();
      return type === 'show' ? s.showIds.has(id) : type === 'video' ? s.videoById.has(id) : type === 'upcoming' ? s.upcomingIds.has(id) : false;
    },
  };
  return store;
}
