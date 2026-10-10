# Managing content

> **The easy way: use Admin → Content** or the focused Content studio (`/content`; see [ADMIN.md](ADMIN.md)). The live catalog is stored in MySQL and edited there. `data/catalog.json` is the *seed* (imported once, on first start) and the bundle for static hosting and the mobile apps — after that, editing the file does not change a running site; use `npm run catalog:import -- --force` to load it, and `npm run catalog:export` to write the database back to the file.

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

Drop originals in `UpcomingReleases/`, run `npm run images` (needs ImageMagick), then add an entry to `upcoming` in the catalog. When a title launches, move it from `upcoming` to `shows` and re-point its teasers (`showId`).

## Go live

Static hosting: commit and deploy — the service worker picks up new content on the next visit. With the API running, `/api/v1/catalog` reloads automatically when the file changes. In the native apps, `data/catalog.json` is bundled at build time and, when an API is configured, refreshed from `/api/v1/catalog` on launch (with the bundled copy as fallback).

## Top 10 episodes

The homepage rail **Top 10 Episodes** is normally the ten most-watched episodes. To control it, open
**Content studio → Top 10**: pick episodes, move them up or down, take them out, or press **Rank by views**
to go back to the automatic list. Slots you leave empty are still filled by most-watched, so the rail is
never short. An episode can also be pinned while editing it, in the **Top 10 position** field (1–10).

A picked episode always appears — even a mature one — because it is an editorial choice rather than a
recommendation; the mature-content cap (docs/ENGAGEMENT.md) still demotes the auto-filled rest for guests.

## The photo gallery

The Behind-the-scenes gallery is **hidden**: it has no entry point for viewers (top bar, footer, home rail,
Account shortcuts), nothing in the Content studio, and it is out of the sitemap. `/gallery` redirects to the
home page for old links. The photos themselves are untouched in the catalog (`gallery` in
`data/catalog.json`, or the `gallery` items in MySQL) and the photo lightbox is still part of the app — it
now powers the poster popup on show and coming-soon pages.
