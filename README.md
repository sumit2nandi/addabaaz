# ADDABAAZ — OTT platform

Bengali originals, stand-up comedy, web series and reels from ADDABAAZ (Kolkata) — as a **streaming website (PWA)** that ships unchanged as **Android and iOS apps**.

| | |
|---|---|
| **Web app** | Installable PWA, offline app-shell, no build step (vanilla ES modules) |
| **Accounts & sync** | Optional REST API (Node/Express + **MySQL**) — email, **Google** and **Facebook** sign-in, profiles, My List, Continue Watching, reminders |
| **Premium video** | Files in a private **Cloudflare R2** bucket, served by signed URLs to signed-in viewers **with an active paid plan** (Razorpay, prepaid); everything else stays open |
| **Works without a backend** | Falls back to on-device "local mode", so static hosting (GitHub Pages, Netlify…) still works |
| **Android / iOS** | [Capacitor](https://capacitorjs.com) wrapper in [`mobile/`](mobile) around the same web bundle |

## What's in the app

Home hero carousel · Continue Watching · Top 10 · per-show rails · **show pages** with episode lists, resume and "next unwatched" · **watch page** with resume, progress tracking and autoplay-next · **Reels** (vertical swipe feed) · search (Bengali + English, recent/popular) · My List · Coming Soon with reminders · Behind-the-Scenes gallery with lightbox · multi-profile ("Who's watching?") · sign-up / sign-in (email, Google, Facebook) · account, settings, delete-account · **premium titles that require sign-in** (free titles never do) · optional ADDABAAZ Plus paywall (feature-flagged) · About / Services / Contact (existing studio pages, kept).

## Run it

```bash
npm install
# Site + API with accounts (needs a MySQL 5.7+/8.x server):
cp .env.example .env     # set DATABASE_URL (and JWT_SECRET for production)
DB_CREATE=true npm start # creates the database if needed, applies migrations, serves http://localhost:3000
# or everything in containers (app + MySQL):
docker compose up --build
# or, no backend at all:
python3 -m http.server 8080   # local mode: list/progress stored on the device
```

The server does not read `.env` by itself — export the variables or use `node --env-file=.env server/src/index.js` (Node 20.6+) / `docker compose`.

```bash
npm test                 # API tests (real MySQL: set TEST_DATABASE_URL, default mysql://root@127.0.0.1:3306)
npm run db:migrate       # apply pending SQL migrations (also runs automatically on start)
npm run validate:catalog # checks data/catalog.json + every referenced image
npm run build:www        # static bundle in ./www  (what the mobile apps package)
```

## Repository map

```
index.html, manifest.webmanifest, sw.js   app shell, PWA manifest, service worker
app/                 web app (css/, js/{views,ui,data,players}, env.js = deploy-time settings)
admin/               the admin console (served at /admin) — manage content, users, payments, coupons
data/catalog.json    content SEED + static/mobile bundle (live catalog is in MySQL; `npm run catalog:export` syncs it back)
data/studio.json     About / team / services / contact details (same role)
media/               optimised WebP artwork + app icons (generated)
server/              REST API + static file server (Express), MySQL layer, SQL migrations, tests
mobile/              Capacitor config for Android & iOS
scripts/             optimize-images.sh, validate-catalog.mjs, build-www.mjs
docs/                ARCHITECTURE.md · SEO.md · ADMIN.md · AUTH.md · PREMIUM.md · DATABASE.md · MOBILE.md · CONTENT.md · openapi.yaml
BTS/, UpcomingReleases/, images/, resources/   original artwork (untouched) & native icon/splash masters
```

## Documentation

- [Architecture & roadmap](docs/ARCHITECTURE.md) — how the pieces fit, how to go to production, what to add next
- [Sign-in: email, Google, Facebook](docs/AUTH.md) — who must log in, provider setup, native apps
- [Viewing & engagement](docs/ENGAGEMENT.md) — password reset, kids profiles & PIN, subtitles, ratings, comments, push, analytics, scheduled publishing, backup/restore, load test, HLS encoder
- [Compliance notes (India)](docs/COMPLIANCE.md) — privacy/terms are templates; GST, DPDP, app-store rules
- [Google search (SEO)](docs/SEO.md) — crawlable URLs, sitemap, structured data, go-live checklist
- [Admin console](docs/ADMIN.md) — `/admin`: content, users, payments, refunds, coupons, audit log
- [Billing: GST invoices, coupons, refunds, emails](docs/BILLING.md) — setup, admin API, sales register
- [Premium video on Cloudflare R2](docs/PREMIUM.md) — bucket, upload, catalog entry, access rules, Razorpay payments, security
- [Database (MySQL)](docs/DATABASE.md) — schema, migrations, configuration, backups
- [Android & iOS](docs/MOBILE.md) — build, sign and publish the apps
- [Managing content](docs/CONTENT.md) — add episodes, shows, posters, your own hosted video
- [API reference](docs/openapi.yaml) — OpenAPI 3 spec for the REST API
