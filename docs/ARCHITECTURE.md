# Architecture

```
┌────────────────────────────── one web bundle ──────────────────────────────┐
│  index.html + app/  (vanilla ES modules, hash router, no build step)        │
│                                                                             │
│  views/*  ──►  User service ──► LocalAdapter   (localStorage, guest/offline)│
│     │            (profiles, list,  RemoteAdapter  (REST API, signed in)     │
│     │             progress, prefs)                                          │
│     ├────────►  Catalog service ──► data/catalog.json  |  GET /api/v1/catalog│
│     └────────►  Player adapter  ──► YouTube IFrame API | HTML5 mp4 | HLS    │
└───────┬───────────────────────────────┬─────────────────────────────┬───────┘
        │ static host / CDN             │ PWA (sw.js, manifest)       │ Capacitor
        ▼                               ▼                             ▼
  GitHub Pages, Netlify …        installable on desktop/Android    Android APK/AAB
                                                                   iOS IPA
        └──────────── optional ────────────┐
                                           ▼
                          server/ (Express)  /api/v1/*  + serves the site
                          MySQL 5.7+/8.x (mysql2 pool, SQL migrations)
```

## Key decisions

- **Progressive enhancement of the backend.** On boot the app probes `GET {API_BASE}/api/v1/health`. If a compatible API answers, sign-in and cloud sync are enabled; otherwise it silently runs in *local mode* (profiles/list/progress on the device). The same code therefore runs on a free static host, on the Node server, and inside the mobile apps.
- **Adapters, not conditionals.** `User` never knows where data lives; `LocalAdapter`/`RemoteAdapter` implement one interface (`data/adapters.js`). Adding Supabase/Firebase = one more adapter. While signed out the app keeps using the local adapter, and sign-up migrates the guest's list/progress into the new account.
- **Optimistic writes.** UI state changes instantly; the adapter call follows (playback progress is sampled about every 5 s, debounced ~4 s before it is sent to the API, and flushed immediately on pause/end/leave).
- **Player abstraction.** `players/index.js` exposes `createPlayer(container, video, opts)`; the engine is chosen from `video.source.type` (`youtube | mp4 | hls`). Moving titles to your own CDN is a data change, not a code change.
- **Hash routing** (`#/show/shahid`). Works on any static host and inside WebViews with zero server config, and deep links map 1:1 to app routes. Trade-off: weaker SEO for inner pages — see roadmap.
- **No framework/build step.** Small (~200 KB of unminified JS, views loaded on demand), trivially deployable, easy for the studio team to edit. `html` tagged templates escape all interpolations by default.
- **MySQL for user data, JSON for content.** Accounts, profiles, My List, progress, reminders, subscriptions and contact messages live in MySQL (`server/migrations/*.sql`, accessed only through `server/src/db.js`). The catalog stays in `data/catalog.json` so editors need no database access and static hosting keeps working; tables reference catalog ids by value.
- **Content as data.** `data/catalog.json` is the single source of truth, served both as a static file and by the API; a validator guards it.

## Sign-in and premium content

Free content never needs an account. Titles marked `access: "premium"` require one: the UI shows a sign-in wall, and — the real gate — `POST /api/v1/videos/:id/stream` refuses without a session. Sign-in is email/password, Google or Facebook (credentials verified server-side, see [AUTH.md](AUTH.md)). Premium video files live in a private **Cloudflare R2** bucket and are delivered through signed, expiring URLs (MP4) or a token gateway (HLS) — see [PREMIUM.md](PREMIUM.md).

## Security notes

- Passwords: `scrypt` with per-user salt; login runs a hash even for unknown emails (timing); JWT (HS256, 30 days) verified with constant-time compare. **Set `JWT_SECRET`** in production (the server refuses to start without it when `NODE_ENV=production`).
- Per-IP rate limits on auth (20/min) and contact (5/10 min) — in-memory; use your proxy/CDN or Redis when running >1 instance. Set `TRUST_PROXY` behind a reverse proxy so IPs are real.
- Input validation on every write; list and reminder IDs are checked against the catalog; profiles are checked for ownership; request bodies capped at 50 KB; server code and `package.json` are never served.
- Tokens live in `localStorage` (bearer, no cookies ⇒ no CSRF). In the native apps store them with `@capacitor/preferences`/secure storage if you need hardware-backed protection.
- Contact form: client canvas CAPTCHA + honeypot + server rate limit. Replace with hCaptcha/Turnstile if spam appears.

## Deploying

| Target | How |
|---|---|
| Static site only | Publish the repo root (or `npm run build:www` → `www/`). Contact form uses the existing Google Form. |
| Site + API + MySQL | `cp .env.example .env` (set secrets) → `docker compose up --build` (app + MySQL 8, migrations run on start). Or run the `Dockerfile` image against any managed MySQL with `DATABASE_URL` (see `.env.example`, `docs/DATABASE.md`). Put behind HTTPS (Caddy/nginx/Cloud Run). |
| Split | Static bundle on a CDN with `API_BASE=https://api…`, API elsewhere with `CORS_ORIGINS=https://addabaaz.in`. |

## Roadmap — what a v3 would add

1. **Real payments:** Razorpay (web) + StoreKit/Play Billing via RevenueCat (apps); webhook → `subscriptions`. Hook point: `POST /subscription` in `server/src/app.js`.
2. **Own video pipeline:** upload → transcode to HLS (Mux, Cloudflare Stream, AWS MediaConvert) → signed URLs → DRM (Widevine/FairPlay) for premium; enables downloads and Chromecast/AirPlay.
3. **Social login** (Google/Apple; Apple is mandatory in iOS apps that offer other social logins) and email verification / password reset (needs an email provider).
4. **Push notifications** for reminders and new episodes (FCM/APNs).
5. **Admin CMS** (or headless CMS: Sanity/Strapi/Directus) generating `catalog.json`, plus a YouTube Data API sync job to import new uploads automatically.
6. **SEO:** prerender `/show/:id` & `/watch/:id` pages (static generation from the catalog) with `VideoObject`/`TVSeries` JSON-LD and clean URLs.
7. **Analytics & recommendations** (watch-time events → "Because you watched…"), A/B tests on the hero.
8. **i18n:** Bengali/English UI toggle (strings are already isolated in views).
9. **Scale-out:** move rate limiting to Redis/edge, add read replicas / a managed MySQL with automated backups, and a `devices` table for push tokens.
