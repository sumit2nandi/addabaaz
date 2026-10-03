# ADDABAAZ — OTT platform

Bengali originals, stand-up comedy, web series and reels from ADDABAAZ (Kolkata) — as a **streaming website (PWA)** that ships unchanged as **Android and iOS apps**.

| | |
|---|---|
| **Web app** | Installable PWA, offline app-shell, no build step (vanilla ES modules) |
| **Accounts & sync** | Optional REST API (Node/Express + **MySQL**) — **mobile-number sign-in with an SMS code (MSG91)**, email + password, **Google** and **Facebook**, profiles, My List, Continue Watching, reminders |
| **Offers** | New accounts get **₹100 of ADDABAAZ credit**; inviting a friend pays **₹100 to each side**. Credit comes off any plan at checkout, the amounts/timing/caps are configurable in `.env` or live in **Admin → Promotions**, and switching the offer off changes nothing else ([docs/PROMOS.md](docs/PROMOS.md)) |
| **Premium access** | Any show or video can be gated to signed-in viewers with an active paid plan (Razorpay, prepaid, **website only** — the apps deliberately sell nothing, for store-policy reasons: [docs/PAYMENTS.md](docs/PAYMENTS.md)). Private **Cloudflare R2** is optional and protects the media file itself with signed URLs; public/external sources may remain reachable outside the app |
| **Works without a backend** | Falls back to on-device "local mode", so static hosting (GitHub Pages, Netlify…) still works |
| **Android / iOS** | [Capacitor](https://capacitorjs.com) wrapper in [`mobile/`](mobile) around the same web bundle |

> **New here? Start with [SETUP.md](SETUP.md)** — install, configure, deploy and operate everything, in one file, including step-by-step **deployment on Hostinger Business web hosting**.

## What's in the app

Home hero carousel · Continue Watching · Top 10 · per-show rails · **show pages** with episode lists, resume and "next unwatched" · **watch page** with resume, progress tracking and autoplay-next · **Reels** (vertical swipe feed) · search (Bengali + English, recent/popular) · My List · Coming Soon with reminders · tap a details-page poster to see the whole artwork · multi-profile ("Who's watching?") · sign-up / sign-in (email, Google, Facebook) · account, settings, delete-account (signing out asks first, in a confirmation popup) · **Support page** to raise and follow tickets (sign-in, registration, payments, playback…) answered from the Admin console · **pull to refresh** any screen in place (soft refresh — no reload, no boot logo; never restarts a playing video) · **premium titles that require sign-in** (free titles never do) · optional ADDABAAZ Plus paywall (feature-flagged) · About / Services / Contact (existing studio pages, kept).

## Run it

```bash
npm install
# Site + API with accounts (needs a MySQL 5.7+/8.x server):
cp .env.example .env     # set DATABASE_URL (and JWT_SECRET for production)
DB_CREATE=true npm start # creates the database if needed, applies migrations, serves http://localhost:3000
# or everything in containers (app + MySQL):
docker compose up --build
# or, no backend at all:
python3 -m http.server 8080   # local mode: list/profiles on the device; watch history needs an account
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
admin/               the Admin console (served at /admin) — users, payments, support tickets, broadcasts, system
content/             the Content studio (served at /content) — shows, videos & reels, coming soon, Top 10
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
- [Viewing & engagement](docs/ENGAGEMENT.md) — password reset, kids profiles & PIN, subtitles, ratings, comments, app-push/e-mail broadcasts, analytics, scheduled publishing, backup/restore, load test, HLS encoder
- [Compliance notes (India)](docs/COMPLIANCE.md) — privacy/terms are templates; GST, DPDP, app-store rules
- [Google search (SEO)](docs/SEO.md) — crawlable URLs, sitemap, structured data, go-live checklist
- [The management consoles](docs/ADMIN.md) — `/admin` (business) and `/content` (content/CMS): what each page does, mobile behaviour, API
- [Phone sign-in with MSG91](docs/MSG91.md) — SMS OTP sign-up/sign-in: DLT, template, env vars, limits, troubleshooting
- [Payments on the website](docs/PAYMENTS.md) — Razorpay keys, webhook, test flow, and the store-policy rules the apps follow
- [Promotional credit & referrals](docs/PROMOS.md) — the ₹100 welcome bonus, the ₹100-for-both referral offer, the Admin → Promotions controls and how credit is spent at checkout
- [Maintenance mode](docs/MAINTENANCE.md) — take the viewer side offline from Admin → Maintenance, what still works, and how the site comes back (on its own or when you flip the switch)
- [Billing: GST invoices, coupons, refunds, emails](docs/BILLING.md) — setup, admin API, sales register
- [Premium video on Cloudflare R2](docs/PREMIUM.md) — bucket, upload, catalog entry, access rules, Razorpay payments, security
- [Database (MySQL)](docs/DATABASE.md) — schema, migrations, configuration, backups
- [Android & iOS](docs/MOBILE.md) — build, sign and publish the apps
- [Managing content](docs/CONTENT.md) — add episodes, shows, posters, your own hosted video
- [API reference](docs/openapi.yaml) — OpenAPI 3 spec for the REST API
