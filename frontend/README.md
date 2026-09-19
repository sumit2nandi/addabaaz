# ADDABAAZ — Angular frontend

Angular port of the single-file `index.html` site at the repository root.
Same design, same catalogue, same behaviour — now a component-based app with
real routes, typed content, and a live catalogue served by the Spring Boot API
in `backend/`.

- **Framework:** Angular 21 (standalone components, signals, zoneless change detection)
- **Stack:** TypeScript (strict), SCSS, Angular Router, Reactive Forms, HttpClient
- **Rendering:** server-side rendered on request (SSR) with client hydration; the
  SSR process calls the API at `http://localhost:8080` (configurable via
  `src/environments/environment.ts`), the browser calls the same-origin `/api`
  path which `ng serve` proxies to the API (`proxy.conf.json`)
- **Auth:** JWT access + rotating refresh tokens; Google sign-in through Spring
  Security's OAuth2 client

> **The site has no built-in content any more.** Shows, episodes, promos, posters,
> team, services and contact details all come from the database. Start the API
> before the site, or pages render empty and show a "service is not responding"
> banner.

## Getting started

```bash
# API first (Java 21 + Maven + PostgreSQL — see ../backend/README.md and ../db/README.md)
cd ../backend && mvn spring-boot:run

# then the site
cd frontend
npm install
npm start          # syncs media folders, then serves on http://localhost:4200
```

`npm start` runs `npm run sync:assets` first (see below), then `ng serve`, which
proxies `/api`, `/oauth2/authorization` and `/login` to `http://localhost:8080`.

| Script | What it does |
| --- | --- |
| `npm start` | Sync assets + dev server with live reload on port 4200 |
| `npm run build` | Sync assets + production build into `dist/frontend/` (browser + server bundles) |
| `npm run serve:ssr:frontend` | Run the production SSR server (`node dist/frontend/server/server.mjs`) |
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
| `/` | Home — hero carousel, Continue Watching (signed in), All Shows, Coming Soon, Behind the Scenes, promo rows |
| `/about` | About + team (from `site_setting` / `team_member`) |
| `/services` | Capabilities (from `service`) |
| `/contact` | Inquiry form with server-rendered image CAPTCHA |
| `/upcoming` | All upcoming-release posters |
| `/bts` | All behind-the-scenes photos |
| `/watch/:showKey` | Player — first episode of a show |
| `/watch/:showKey/:episodeId` | Player — a specific episode |
| `/watch/promo/:promoId` | Player — a promo / reel |
| `/oauth2/callback` | Landing page for Google sign-in (stores the tokens Spring Security returns) |

Unknown links fall back to the homepage once the catalogue has loaded.

## Project layout

```
src/app/
├─ core/
│  ├─ models/          UI models (content.ts) + API payload types (api.ts)
│  ├─ interceptors/    auth interceptor (bearer token + silent refresh)
│  ├─ services/        ApiService, ContentService, AuthService, BillingService,
│  │                   PlaybackService, InquiryService, ModalService,
│  │                   HoverPreviewService, TokenStore, ApiConfig
│  └─ utils/media.ts   thumbnail / label / URL helpers
├─ shared/             hero carousel, media rail, cards, previews, modal host,
│                      captcha, continue-card
├─ pages/              one component per route (incl. oauth-callback)
└─ app.ts              shell: topbar (sign-in/subscribe), router outlet, footer
```

All visuals stay in `src/styles.scss`; component `.scss` files stay (almost) empty by design.

### Where content comes from

| Page data | API | Database tables |
| --- | --- | --- |
| Home rails, hero | `GET /api/home` | `banner`, `show`, `episode`, `promo_video`, `poster` |
| About | `GET /api/team`, `/api/settings` | `team_member`, `site_setting` |
| Services | `GET /api/services` | `service` |
| Contact details | `GET /api/settings` | `site_setting` |
| Upcoming / BTS | `GET /api/posters?kind=…` | `poster` |
| Plans | `GET /api/plans` | `plan` |

### Adding content

Content is edited in the database (or via the `/api/admin/**` endpoints), not in
TypeScript:

- **New episode / promo** → `POST /api/admin/shows/{key}/episodes` / `/api/admin/promos`,
  or insert into `episode` / `promo_video`
- **New poster** → drop the file in `UpcomingReleases/` or `BTS/`, then add a `poster` row
- **Team / services / contact details / homepage limits** → `team_member`, `service`,
  `site_setting` rows (the settings are JSONB, editable without a deploy)

The frontend caches nothing between requests, so new content appears on the next
page load — no rebuild needed.

## Environment knobs

`src/environments/environment.ts`:

- `apiBaseUrl` — browser-side API prefix (default `/api`, proxied)
- `apiOrigin` — absolute API origin used by the SSR process (default `http://localhost:8080`)
- `oauth2AuthorizeUrl` — Google sign-in entry point (default `/oauth2/authorization/google`, proxied)
