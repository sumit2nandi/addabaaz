# ADDABAAZ — Angular frontend

Angular port of the single-file `index.html` site at the repository root.
Same design, same catalogue, same behaviour — now a component-based SPA with
real routes, typed content and prerendered pages.

- **Framework:** Angular 21 (standalone components, signals, zoneless change detection)
- **Stack:** TypeScript (strict), SCSS, Angular Router, Reactive Forms
- **Rendering:** prerendered static HTML for the main pages (SEO), client-side rendering for episode/promo pages

## Getting started

```bash
cd frontend
npm install
npm start          # syncs media folders, then serves on http://localhost:4200
```

`npm start` runs `npm run sync:assets` first (see below), then `ng serve`.

| Script | What it does |
| --- | --- |
| `npm start` | Sync assets + dev server with live reload on port 4200 |
| `npm run build` | Sync assets + production build (prerendered output in `dist/frontend/browser`) |
| `npm run watch` | Sync assets + rebuild on change (development configuration) |
| `npm run sync:assets` | Mirror `images/`, `BTS/` and `UpcomingReleases/` from the repo root into `public/` |
| `npm test` | Unit tests (Vitest) |

### Media folders

The images live at the **repository root** (`/images`, `/BTS`, `/UpcomingReleases`) so they stay
shared with the legacy static site. Angular can only copy assets from inside its own project
folder, so `scripts/sync-assets.mjs` mirrors them into `frontend/public/` using hard links
(no extra disk space). The mirrored folders are git-ignored — the root folders remain the
single source of truth. The sync runs automatically before `start`, `build` and `watch`.

## Routes

| Path | Page |
| --- | --- |
| `/` | Home — hero carousel, All Shows, Coming Soon, Behind the Scenes, promo rows |
| `/about` | About + team |
| `/services` | Capabilities |
| `/contact` | Inquiry form with canvas CAPTCHA |
| `/upcoming` | All upcoming-release posters |
| `/bts` | All behind-the-scenes photos |
| `/watch/:showKey` | Player — first episode of a show (prerendered) |
| `/watch/:showKey/:episodeId` | Player — a specific episode |
| `/watch/promo/:promoId` | Player — a promo / reel |

Unknown links fall back to the homepage. `src/app/app.routes.server.ts` controls which
routes are prerendered at build time.

## Project layout

```
src/app/
├─ core/
│  ├─ data/            content extracted from the old index.html
│  │  ├─ shows.data.ts        web series + episodes
│  │  ├─ promos.data.ts       promos, reels, specials
│  │  ├─ gallery.data.ts      Upcoming Releases + Behind the Scenes posters
│  │  └─ site.data.ts         contact details, team, services, form config
│  ├─ models/          TypeScript types for all of the above
│  ├─ services/        ContentService, ModalService, HoverPreviewService, InquiryService
│  └─ utils/media.ts   thumbnail / label / URL helpers
├─ shared/             hero carousel, media rail, cards, previews, modal host, captcha
├─ pages/              one component per route
└─ app.ts              shell: topbar, router outlet, footer, global overlays
```

### Adding content

Everything is data-driven — no template edits needed:

- **New episode** → append to `shows.data.ts`
- **New promo / reel** → append to `promos.data.ts`
- **New poster** → drop the file in `UpcomingReleases/` or `BTS/` and list it in `gallery.data.ts`
- **Team / services / contact details** → `site.data.ts`

The homepage hero automatically features the three most-watched shows, and promos are split
into rails of ten.

## Notes on the migration

- The original stylesheet was moved verbatim into `src/styles.scss` so every page looks
  identical to the old site; component styles only cover new markup.
- The old JS "tabs" (`openTab`, `scrollMemory`, `popstate` handling) are replaced by Angular
  Router routes with `withInMemoryScrolling` — back/forward restores scroll position.
- `openModal` / `openPosterModal` / `openAuthModal` became `ModalService` + one `ModalHost`.
- The two desktop hover popups (video preview, poster preview) are now `CardPreview` and
  `PosterPreview`, driven by `HoverPreviewService`.
- The canvas CAPTCHA is the `Captcha` component; form submission lives in `InquiryService`
  and posts to the Apps Script / Google Form configured in `site.data.ts`.
- Inline `onclick` handlers became typed event bindings; keyboard activation (Enter / Space)
  is wired up on every card for accessibility.
