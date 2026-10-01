# Architecture

```
┌────────────────────────────── one web bundle ──────────────────────────────┐
│  index.html + app/  (vanilla ES modules, History/hash router, no build step)        │
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

- **Progressive enhancement of the backend.** On boot the app probes `GET {API_BASE}/api/v1/health`. If a compatible API answers, sign-in and cloud sync are enabled; otherwise it silently runs in *local mode* (profiles/list on the device — watch history is maintained only for signed-in accounts). The same code therefore runs on a free static host, on the Node server, and inside the mobile apps.
- **Adapters, not conditionals.** `User` never knows where data lives; `LocalAdapter`/`RemoteAdapter` implement one interface (`data/adapters.js`). Adding Supabase/Firebase = one more adapter. While signed out the app keeps using the local adapter, and sign-up migrates the guest's list/progress into the new account.
- **Optimistic writes.** UI state changes instantly; the adapter call follows (playback progress is sampled about every 5 s, debounced ~4 s before it is sent to the API, and flushed immediately on pause/end/leave).
- **Player abstraction.** `players/index.js` exposes `createPlayer(container, video, opts)`; the engine is chosen from `video.source.type` (`youtube | mp4 | hls`). Moving titles to your own CDN is a data change, not a code change.
- **Two URL styles, one router.** On the website served by the Node server, pages have real URLs (`/show/shahid`, History API) and the server answers each with the app shell plus that page's metadata and content, so Google can index it ([SEO.md](SEO.md)). Static hosting and the Capacitor apps have no such server and keep hash URLs (`#/show/shahid`); the server tells the app which mode to use with `<meta name="ab:routing">`. Old `/#/…` links are converted automatically.
- **No framework/build step.** Small (~200 KB of unminified JS, views loaded on demand), trivially deployable, easy for the studio team to edit. `html` tagged templates escape all interpolations by default.
- **MySQL for user data and the live catalogue.** Accounts, profiles, My List, progress, reminders, subscriptions, contact messages and the current curated catalogue live in MySQL (`server/migrations/*.sql`, accessed only through `server/src/db.js`). `data/catalog.json` is the one-time seed and static-mode fallback; tables reference catalogue ids by value.
- **Content as data.** Curated shows and catalogue videos are database-backed. After an authenticated admin explicitly previews, the YouTube Data API paginates the channel's complete public uploads playlist and checks every ID against the catalog. A short-lived signed preview snapshot is stored in MySQL so selected/all-missing imports do not fetch YouTube again and work across instances. Shorts appear in Reels; landscape uploads join the home page's latest episodes/videos. A tracked import history supports undoing the last batch or removing imports from today. Admins can filter videos by attributes and bulk hide, restore, or delete selected rows; hidden videos remain admin-visible but are excluded from public catalog reads. Public pages never fetch the YouTube API. Static-only builds continue to use their bundled catalog snapshot.

## Sign-in and premium content

Free content never needs an account. Titles marked `access: "premium"` are gated in the app for signed-out viewers and viewers without an active plan; shows and videos may use any supported source. The `/api/v1/videos/:id/stream` endpoint also enforces access before signing URLs for R2-hosted media. YouTube or public MP4/HLS sources may still be reachable outside ADDABAAZ, so use a private **Cloudflare R2** source when the media itself needs server-enforced protection (see [PREMIUM.md](PREMIUM.md)). Sign-in is email/password, Google or Facebook (credentials verified server-side, see [AUTH.md](AUTH.md)).

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

1. **Payments:** Razorpay prepaid passes on the web are built (`server/src/payments.js`, `docs/PREMIUM.md`). GST invoices, coupons, refunds and emails are built too (`docs/BILLING.md`). Still to do: StoreKit/Play Billing via RevenueCat for in-app purchase in the store apps, an admin web UI, e-invoicing/IRN if your turnover requires it.
2. **Own video pipeline:** upload → transcode to HLS (Mux, Cloudflare Stream, AWS MediaConvert) → signed URLs → DRM (Widevine/FairPlay) for premium; enables downloads and Chromecast/AirPlay.
3. **Social login** (Google/Apple; Apple is mandatory in iOS apps that offer other social logins) and email verification / password reset (needs an email provider).
4. **Push notifications** for reminders and new episodes (FCM/APNs).
5. **External CMS integration** (or headless CMS: Sanity/Strapi/Directus) generating catalog data. The current admin console includes a manual YouTube preview/selection/import flow with batch undo; public pages never contact YouTube for its feed.
6. ~~**SEO**~~ done — see [SEO.md](SEO.md).
7. **Analytics & recommendations** (watch-time events → "Because you watched…"), A/B tests on the hero.
8. **i18n:** Bengali/English UI toggle (strings are already isolated in views).
9. **Scale-out:** move rate limiting to Redis/edge, add read replicas / a managed MySQL with automated backups, and a `devices` table for push tokens.
