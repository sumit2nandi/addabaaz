# Managing content

> **The easy way: use the admin console** (`/admin`, see [ADMIN.md](ADMIN.md)). The live catalog is stored in MySQL and edited there. `data/catalog.json` is the *seed* (imported once, on first start) and the bundle for static hosting and the mobile apps — after that, editing the file does not change a running site; use `npm run catalog:import -- --force` to load it, and `npm run catalog:export` to write the database back to the file.

The rest of this page describes the file format (used by the console, the seed and the import). Everything shown in the app comes from **`data/catalog.json`**. Validate after every edit:

```bash
npm run validate:catalog
```

## Add an episode (YouTube)

Append to `videos`:

```json
{
  "id": "dQw4w9WgXcQ",              // unique — the YouTube id is convenient
  "showId": "shahid",               // must exist in `shows` or `upcoming` (null for standalone promos)
  "kind": "episode",                // episode | trailer | reel | clip
  "episode": 6,                     // episodes only — drives ordering, "Next: EP 07", autoplay
  "title": "Full YouTube title…",   // the UI derives a short display title; add "shortTitle" to override
  "description": "…",              // optional, 1–2 sentences for Google (reels stay out of search results without one)
  "source": { "type": "youtube", "id": "dQw4w9WgXcQ" },
  "duration": 905,                  // seconds
  "publishedAt": "2026-10-04T13:30:00Z",
  "views": 0,
  "access": "free"                  // free | premium (premium = signed in AND an active paid plan; see docs/PREMIUM.md)
}
```

`reel` items appear in the **Reels** feed (best for vertical Shorts), `trailer`/`clip` on the show page.

## Premium / private videos (Cloudflare R2)

Set `"access": "premium"` on any show or video; the access flag is independent of its source (YouTube, MP4, HLS or R2). Premium titles are gated in the app for signed-out and unpaid viewers. Public sources such as YouTube or a public URL can still be accessed outside ADDABAAZ; use a private R2 source when the media itself must be protected. R2 sources require a public `"thumbnail"`. Full private-R2 walkthrough: [PREMIUM.md](PREMIUM.md).

## Host video yourself (no YouTube)

Change only `source`:

```json
"source": { "type": "hls", "url": "https://cdn.example.com/shahid/ep6/master.m3u8" }
"source": { "type": "mp4", "url": "https://cdn.example.com/shahid/ep6.mp4" }
```

Add `"thumbnail": "https://…/ep6.jpg"` (YouTube thumbnails are derived automatically; self-hosted videos need one). Progress tracking, resume, autoplay-next and premium gating work identically for every source type. For paid content use signed/expiring URLs from your CDN (see ARCHITECTURE.md → DRM).

## Add a show

Copy an existing entry in `shows` (fields: `id`, `title`, `titleEn`, `type`, `genres`, `tagline`, `description`, `cast`, `language`, `year`, `status`, `poster`, `posterLg`, `access`, and `featured: true` to put it in the home carousel). Poster: put the original in `images/`, add a line to `scripts/optimize-images.sh`, run `npm run images`.

## Coming-soon posters & Behind-the-scenes photos

Drop originals in `UpcomingReleases/` or `BTS/`, run `npm run images` (needs ImageMagick), then add an entry to `upcoming` / `gallery` in the catalog. When a title launches, move it from `upcoming` to `shows` and re-point its teasers (`showId`).

## Go live

Static hosting: commit and deploy — the service worker picks up new content on the next visit. With the API running, `/api/v1/catalog` reloads automatically when the file changes. In the native apps, `data/catalog.json` is bundled at build time and, when an API is configured, refreshed from `/api/v1/catalog` on launch (with the bundled copy as fallback).
