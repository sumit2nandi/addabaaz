# ADDABAAZ — OTT platform

Bengali originals, stand-up comedy, web series and reels from ADDABAAZ (Kolkata) — as a **streaming website (PWA)** that ships unchanged as **Android and iOS apps**.

| | |
|---|---|
| **Web app** | Installable PWA, offline app-shell, no build step (vanilla ES modules) |
| **Accounts & sync** | Optional REST API (Node/Express) — profiles, My List, Continue Watching, reminders, subscriptions |
| **Works without a backend** | Falls back to on-device "local mode", so static hosting (GitHub Pages, Netlify…) still works |
| **Android / iOS** | [Capacitor](https://capacitorjs.com) wrapper in [`mobile/`](mobile) around the same web bundle |

## What's in the app

Home hero carousel · Continue Watching · Top 10 · per-show rails · **show pages** with episode lists, resume and "next unwatched" · **watch page** with resume, progress tracking and autoplay-next · **Reels** (vertical swipe feed) · search (Bengali + English, recent/popular) · My List · Coming Soon with reminders · Behind-the-Scenes gallery with lightbox · multi-profile ("Who's watching?") · sign-up / sign-in · account, settings, delete-account · optional ADDABAAZ Plus paywall (feature-flagged) · About / Services / Contact (existing studio pages, kept).

## Run it

```bash
npm install
npm start                # http://localhost:3000 — site + API together (accounts enabled)
# or, no backend at all:
python3 -m http.server 8080   # local mode: list/progress stored on the device
```

```bash
npm test                 # API tests
npm run validate:catalog # checks data/catalog.json + every referenced image
npm run build:www        # static bundle in ./www  (what the mobile apps package)
```

## Repository map

```
index.html, manifest.webmanifest, sw.js   app shell, PWA manifest, service worker
app/                 web app (css/, js/{views,ui,data,players}, env.js = deploy-time settings)
data/catalog.json    ALL content: shows, videos, upcoming, gallery   ← edit this to publish
data/studio.json     About / team / services / contact details
media/               optimised WebP artwork + app icons (generated)
server/              REST API + static file server (Express, JSON-file DB, tests)
mobile/              Capacitor config for Android & iOS
scripts/             optimize-images.sh, validate-catalog.mjs, build-www.mjs
docs/                ARCHITECTURE.md · MOBILE.md · CONTENT.md · openapi.yaml
BTS/, UpcomingReleases/, images/, resources/   original artwork (untouched) & native icon/splash masters
```

## Documentation

- [Architecture & roadmap](docs/ARCHITECTURE.md) — how the pieces fit, how to go to production, what to add next
- [Android & iOS](docs/MOBILE.md) — build, sign and publish the apps
- [Managing content](docs/CONTENT.md) — add episodes, shows, posters, your own hosted video
- [API reference](docs/openapi.yaml) — OpenAPI 3 spec for the REST API
