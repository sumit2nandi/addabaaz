# ADDABAAZ — complete setup guide

Everything you need to install, configure, run, deploy and operate ADDABAAZ, in one file.
(The other files in `docs/` go deeper on individual topics; you should not need them to get running.)

**Contents**

1. [What you are setting up](#1-what-you-are-setting-up)
2. [Requirements](#2-requirements)
3. [Quick start — Docker (recommended)](#3-quick-start--docker-recommended)
4. [Local development without Docker](#4-local-development-without-docker)
5. [Static-only mode (no backend)](#5-static-only-mode-no-backend)
6. [Configuration reference (every environment variable)](#6-configuration-reference)
7. [Create your first administrator](#7-create-your-first-administrator)
8. [Turn on features, one at a time](#8-turn-on-features-one-at-a-time)
   Google · Facebook · Apple · premium video (R2) · payments (Razorpay) · GST invoices · email · push notifications · analytics · error alerts · legal pages
9. [Adding content](#9-adding-content)
10. [Deploying to production on Hostinger Business hosting](#10-deploying-to-production-hostinger-business-web-hosting)
    database · Web App · uploads · admin account · scheduled jobs · email
11. [After you deploy: Google search](#11-after-you-deploy-google-search)
12. [Android and iOS apps](#12-android-and-ios-apps)
13. [Running it: backups, updates, monitoring, load tests](#13-running-it)
14. [Go-live checklist](#14-go-live-checklist)
15. [Troubleshooting](#15-troubleshooting)
16. [Where things are in the code](#16-where-things-are-in-the-code)

---

## 1. What you are setting up

| Part | What it is | Needed for |
|---|---|---|
| **Website (PWA)** | Plain HTML + JavaScript modules in `index.html`, `app/`, `sw.js`. No build step. | Everything |
| **API + web server** | Node.js / Express in `server/src/`, storing data in **MySQL**. Also serves the website, the admin console and SEO pages. | Accounts, premium video, payments, admin, comments, notifications … |
| **Admin console** | `/admin` (files in `admin/`). Manage shows, videos, users, payments, coupons, comments, refunds, analytics. | Running the business |
| **Mobile apps** | A Capacitor wrapper in `mobile/` that packages the same website as Android / iOS apps. | Play Store / App Store |

Two ways to run it:

* **Full mode** — website + API + MySQL. All features work.
* **Static-only mode** — just the files on any static host. Browsing and free videos work, and My List / progress are kept on the device. No accounts, premium video or admin. See [section 5](#5-static-only-mode-no-backend).

---

## 2. Requirements

| | Needed for | Notes |
|---|---|---|
| **Node.js 20 or newer** (22 recommended) | everything | `node -v` |
| **MySQL 5.7+ or 8.x** | full mode | On Hostinger: the database you create in hPanel (see section 10; on shared plans it may be MariaDB). Or Docker / a managed MySQL. Character set `utf8mb4`. |
| **Hostinger Business Web Hosting** | production | Provides the Node.js Web App, MySQL database, phpMyAdmin and SSL. See section 10. |
| **Docker + Docker Compose** | quick start / production | Optional but the easiest way. |
| A domain with **HTTPS** | production | Required for sign-in providers, payments, push notifications and PWA install. |
| Accounts you may need later | | Google Cloud, Facebook developers, Apple Developer ($99/yr), Cloudflare (R2), Razorpay, an SMTP email provider, Google Search Console. Each is optional — see section 8. |
| `ffmpeg` (only on your own computer) | encoding premium video | Only for `npm run encode:hls`. |
| Android Studio / Xcode (macOS) | mobile apps only | See section 12. |

---

## 3. Quick start — Docker (recommended)

*Use this to try ADDABAAZ on your own computer (Docker isn't available on Hostinger Business hosting — for going live, go straight to [section 10](#10-deploying-to-production-hostinger-business-web-hosting)).*

This starts the app **and** a MySQL 8 database, with the database and uploaded images kept in Docker volumes.

```bash
git clone https://github.com/sumit2nandi/addabaaz.git
cd addabaaz
cp .env.example .env
```

Edit `.env` and set at least these three values (everything else is optional):

```ini
JWT_SECRET=<run:  openssl rand -hex 32>
MYSQL_ROOT_PASSWORD=<a long random password>
MYSQL_PASSWORD=<another long random password>
```

Start it:

```bash
docker compose up --build -d
docker compose logs -f app        # wait for: "ADDABAAZ running on http://localhost:3000"
```

Open <http://localhost:3000>. Database tables are created automatically on first start.

> **Note:** `.env.example` has `NODE_ENV=production`. In production mode there is **no demo checkout** and search engines are allowed to index the site. For a private trial on your own machine, add `NODE_ENV=development` under `environment:` for the `app` service in `docker-compose.yml`, or just follow [section 4](#4-local-development-without-docker).

Next: [create your admin account](#7-create-your-first-administrator).

Useful commands:

```bash
docker compose ps                          # is everything up?
docker compose logs -f app                 # live logs
docker compose exec app npm run admin -- grant you@example.com
docker compose exec app npm run backup     # write a backup (see section 13)
docker compose down                        # stop (data is kept)
docker compose down -v                     # stop AND DELETE the database + uploads
```

---

## 4. Local development without Docker

### 4.1 Install

```bash
git clone https://github.com/sumit2nandi/addabaaz.git
cd addabaaz
npm install
```

### 4.2 Get a MySQL server

Pick one:

* **Docker just for the database**
  ```bash
  docker run -d --name ab-mysql -p 3306:3306 \
    -e MYSQL_ALLOW_EMPTY_PASSWORD=yes mysql:8.0 \
    --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
  ```
* **Installed locally** — macOS `brew install mysql`, Ubuntu `sudo apt install mysql-server`, Windows: the MySQL installer.
* **A managed database** (AWS RDS, Google Cloud SQL, Azure, PlanetScale…) — put the details in `DATABASE_URL` and add `DB_SSL=true`.

You do not need to create tables by hand. With `DB_CREATE=true` the server also creates the empty database itself (the MySQL user then needs the `CREATE` privilege; otherwise create an empty database named `addabaaz` yourself).

### 4.3 Run

The server does **not** read `.env` on its own. Either export variables in your shell or use Node's `--env-file`:

```bash
# simplest: everything inline
DB_CREATE=true DATABASE_URL=mysql://root@127.0.0.1:3306/addabaaz npm start

# or with a .env file (Node 20.6+):
cp .env.example .env               # then edit it; for local work set NODE_ENV=development
node --env-file=.env server/src/index.js

# auto-restart on code changes:
npm run dev
```

Open <http://localhost:3000>. You should see `ADDABAAZ running on http://localhost:3000 (site + API at /api/v1, MySQL connected)` in the terminal.

What development mode (`NODE_ENV` not `production`) gives you:

* an instant, clearly labelled **demo checkout** when no Razorpay keys are set (production has none);
* emails are **printed to the terminal** as `[mail:dev] …` instead of being sent — password-reset and verification links appear there;
* the site says `noindex` so search engines ignore it;
* `JWT_SECRET` may be left unset (a fixed, **insecure** development secret is used and a warning is printed).

### 4.4 Check that it works

```bash
curl http://localhost:3000/api/v1/health        # {"ok":true,"service":"addabaaz","db":"up",...}
npm test                                        # 115 tests, needs a MySQL server (see below)
npm run validate:catalog                        # checks data/catalog.json and every image it references
```

`npm test` creates and drops its own throw-away databases. It connects to `mysql://root@127.0.0.1:3306` unless you set `TEST_DATABASE_URL`, for example `TEST_DATABASE_URL=mysql://root:secret@127.0.0.1:3306/x npm test`. If every test fails with `MySQL is not reachable (ECONNREFUSED)`, MySQL is simply not running.

### 4.5 Handy scripts

| Command | What it does |
|---|---|
| `npm start` / `npm run dev` | Run the server (`dev` restarts on file changes). |
| `npm test` | Run all automated tests. |
| `npm run db:migrate` | Apply pending SQL migrations (also happens automatically on start unless `DB_MIGRATE=false`). |
| `npm run admin -- grant\|revoke\|list [email]` | Manage administrator accounts. |
| `npm run validate:catalog` | Validate the JSON catalog and its images. |
| `npm run catalog:export` / `catalog:import -- --force` | Copy the catalog between MySQL and `data/*.json`. |
| `npm run build:www` | Build the static bundle in `www/` (used by mobile apps and static hosting). |
| `npm run images` | Re-generate optimised WebP artwork (needs ImageMagick). |
| `npm run backup` / `npm run restore -- <file>` | Backup and restore (section 13). |
| `npm run loadtest` | Load test a staging server (section 13). |
| `npm run encode:hls -- video.mov` | Convert a video for premium streaming (section 8.4). |
| `npm run r2:check` | Check that R2 credentials and a video key work. |
| `npm run mobile:android` / `mobile:ios` | Build the web bundle and open the native project (section 12). |

### 4.6 Windows (PowerShell) — the same steps

Commands elsewhere in this guide use Linux/macOS syntax. On a Windows laptop use **PowerShell** (Start → "PowerShell") and these equivalents. Install first: [Node.js 22 LTS](https://nodejs.org), [Git for Windows](https://git-scm.com/download/win) and either [MySQL Installer](https://dev.mysql.com/downloads/installer/) or [Docker Desktop](https://www.docker.com/products/docker-desktop/).

| Linux/macOS | Windows PowerShell |
|---|---|
| `DB_CREATE=true DATABASE_URL=… npm start` | `$env:DB_CREATE="true"; $env:DATABASE_URL="mysql://root:YOURPASSWORD@127.0.0.1:3306/addabaaz"; npm start` |
| `cp .env.example .env` | `Copy-Item .env.example .env` |
| `node --env-file=.env server/src/index.js` | same command (works as is) |
| `openssl rand -hex 32` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `curl http://localhost:3000/api/v1/health` | `Invoke-RestMethod http://localhost:3000/api/v1/health` |
| `python3 -m http.server 8080` | `npx serve -l 8080 .` |
| `API_BASE=off npm run build:www` | `$env:API_BASE="off"; npm run build:www` |
| `docker run … \` (multi-line) | put it on **one line** (PowerShell continues lines with a backtick `` ` ``, not `\`) |

Notes:

* **Setting variables in PowerShell** lasts only for that window (`$env:NAME="value"`). To clear one: `Remove-Item Env:NAME`. In the older `cmd.exe` it is `set NAME=value` (no quotes) and `&&` between commands.
* If MySQL Installer asked you for a root password, put it in the URL (`mysql://root:password@127.0.0.1:3306/addabaaz`). Special characters in a password must be URL-encoded (`@` → `%40`, `:` → `%3A`, `/` → `%2F`). Easier: use the separate variables, `$env:DB_HOST="127.0.0.1"; $env:DB_USER="root"; $env:DB_PASSWORD="…"; $env:DB_NAME="addabaaz"`.
* Docker Desktop: the MySQL command becomes `docker run -d --name ab-mysql -p 3306:3306 -e MYSQL_ALLOW_EMPTY_PASSWORD=yes mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci`.
* `npm test` on Windows: `$env:TEST_DATABASE_URL="mysql://root:PASSWORD@127.0.0.1:3306/x"; npm test`.
* Scripts that are shell files (`npm run images`, which needs ImageMagick) are for Linux/macOS/WSL; you don't need them to run or deploy the site.
* If `npm` fails with "running scripts is disabled on this system" (`npm.ps1 cannot be loaded`), run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` and answer `Y`, then open a new PowerShell window. Or type `npm.cmd` instead of `npm` (for example `npm.cmd install`).

**Making the ZIP for Hostinger on Windows** (section 10.2-B):

```powershell
cd C:\path\to\addabaaz
git fetch origin
git checkout arena/01a0ec36-addabaaz        # the branch that has the latest code (or your merged production branch)
git pull
git archive --format=zip -o addabaaz.zip HEAD
```

`git archive` only includes committed files, so `node_modules`, `.env` and local uploads are left out automatically, and the paths inside the ZIP are the ones Linux expects. Avoid *right-click → Send to → Compressed folder* on the project folder: it would include `node_modules` and your `.env`, and it wraps everything in an extra top-level folder, which breaks Hostinger's detection (`package.json` must be at the top of the ZIP). If you have to zip without git: `tar -a -c -f addabaaz.zip --exclude node_modules --exclude .git --exclude .env --exclude www --exclude mobile --exclude backups --exclude uploads *` (`tar` is built into Windows 10/11 and writes correct paths; `Compress-Archive` in Windows PowerShell 5.1 does not).

Check the result: `tar -tf addabaaz.zip | Select-String -Pattern "^(package.json|server.cjs)$"` should print both names.

---

## 5. Static-only mode (no backend)

Use this for a quick free host (GitHub Pages, Netlify, Cloudflare Pages) when you don't need accounts.

```bash
API_BASE=off npm run build:www       # writes ./www  — upload the contents of that folder
```

or, to just try it locally: `python3 -m http.server 8080` in the repo root (Windows: `npx serve -l 8080 .`) and open <http://localhost:8080>.

In this mode the website falls back to "local mode": My List and profiles live in the browser (watch history / Continue Watching is maintained only for signed-in accounts), and pages such as sign-in say accounts aren't enabled. To connect a static site to a separately hosted API instead, build with `API_BASE=https://api.example.com npm run build:www` (and add the site's address to the API's `CORS_ORIGINS`). Leaving `API_BASE` unset means "use the same origin, auto-detect".

---

## 6. Configuration reference

All settings are environment variables (see `.env.example`, which has the same list with comments). **Only `JWT_SECRET` and the database are required in production.** Everything else switches a feature on.

### Core

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | — | `production` on the live site. Turns on indexing, disables the demo checkout, requires `JWT_SECRET`. |
| `PORT` | `3000` | HTTP port. **Leave unset on Hostinger** — the platform assigns it. |
| `JWT_SECRET` | dev only | **Required in production.** Long random string (`openssl rand -hex 32`). Changing it signs everyone out. |
| `PUBLIC_SITE_URL` | `https://addabaaz.in` | The public address, `https://…`, no trailing slash. Used in emails, canonical URLs and the sitemap. |
| `PUBLIC_API_URL` | — | Public address of the API when it differs from the site (needed for HLS video behind a proxy). |
| `CORS_ORIGINS` | `*` | Allowed browser origins, comma separated. Sign-in uses bearer tokens, so `*` is safe; restrict it if you like. |
| `TRUST_PROXY` | — | Number of reverse proxies in front of the app (e.g. `1`). Needed so rate limits and logs see real visitor IPs. |
| `UPLOAD_DIR` | `./uploads` | Local **cache** of admin-uploaded images and subtitles. The real copies are stored in MySQL (table `uploaded_files`), so a restart or redeploy that empties this folder loses nothing — files are served from MySQL and copied back. A folder outside the deployed app (section 10.2-C) or a Docker volume just saves re-reading them. |
| `IMAGE_ALLOWED_HOSTS` | *(empty)* | Optional: extra hosts (comma-separated) whose pages may show `/media` and `/uploads` images. The site (`PUBLIC_SITE_URL`, with and without `www`), `CORS_ORIGINS` entries and the native app (`app.addabaaz.in`) are always allowed. |

### Database

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — | `mysql://user:password@host:3306/database` |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | `127.0.0.1` `3306` `root` (empty) `addabaaz` | Use these instead of `DATABASE_URL` if you prefer. |
| `DB_SSL` / `DB_SSL_VERIFY` | off | `DB_SSL=true` for managed MySQL. `DB_SSL_VERIFY=false` skips certificate checks (not recommended). |
| `DB_SSL_CA` / `DB_SSL_CA_FILE` | empty | The provider's CA certificate, for databases whose certificates are signed by a private CA (Aiven): pasted as text (`DB_SSL_CA`) or a file path (`DB_SSL_CA_FILE`). Either one turns TLS on. `DB_SSL_VERIFY_IDENTITY=true` also checks the host name. |
| `DB_POOL_SIZE` | `10` | Connection pool size. |
| `DB_CREATE` | `false` | `true` = create the database if it doesn't exist. |
| `DB_MIGRATE` | `true` | `false` = don't migrate on start; run `npm run db:migrate` in your deploy step instead. |

### Sign-in

| Variable | Meaning |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth "Web application" client id. Enables the Google button. |
| `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_EXTRA_CLIENT_IDS` | Extra accepted client ids for the mobile apps (comma separated). |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Enable Facebook sign-in. The secret stays on the server. |
| `FACEBOOK_CLIENT_TOKEN`, `FACEBOOK_GRAPH_VERSION` | Only for the native apps / to pin the Graph API version. |
| `APPLE_SERVICE_ID` | Sign in with Apple on the **website** (a Services ID). |
| `APPLE_CLIENT_ID` | Sign in with Apple in the **iOS app** (the app's bundle id). |
| `ADMIN_SESSION_HOURS` | `12` — admin console sessions are shorter than viewer sessions. |
| `ADMIN_TOKEN` | Optional 24+ character secret for scripts/curl to call `/api/v1/admin/*`. Leave empty otherwise. |

### Premium video and playback

| Variable | Default | Meaning |
|---|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | — | Optional private Cloudflare R2 video storage (use it when the media itself needs protection). |
| `R2_ENDPOINT` | derived | Override for S3-compatible storage other than R2. |
| `STREAM_URL_TTL` | `21600` | Seconds a signed video link stays valid (6 h). |
| `STREAM_LIMIT` | `2` | Premium screens one account may play at the same time. |

### Payments, GST, email

| Variable | Meaning |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay checkout and webhook. Use `rzp_test_…` keys while testing. |
| `ALLOW_MOCK_PAYMENTS` | `true` = staging only: enables the fake checkout even in production. **Anyone can grant themselves a plan.** |
| `REFUND_WINDOW_DAYS` | `7` — self-service refund requests; `0` turns them off. |
| `GSTIN` | Your 15-character GST number (checked at start). Empty = plain receipts with no tax. |
| `GST_LEGAL_NAME`, `BUSINESS_ADDRESS`, `BUSINESS_STATE`, `GST_SAC`, `GST_RATE`, `INVOICE_PREFIX`, `INVOICE_FOOTER` | Printed on invoices. Defaults: SAC `998439`, rate `18`, prefix `AB`. Use `\n` for line breaks in the address. |
| `SUPPORT_EMAIL` | Shown on invoices and in emails; also receives refund requests. |
| `SMTP_URL` | e.g. `smtps://user:pass@smtp.example.com:465`. Empty = emails are not sent. |
| `MAIL_FROM` | e.g. `"ADDABAAZ <billing@addabaaz.in>"`. |
| `EXPIRY_REMINDER_DAYS` | `3` — "your plan ends soon" emails; `0` = off. |

### Notifications, analytics, monitoring

| Variable | Meaning |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push. Generate with `npx web-push generate-vapid-keys`; subject like `mailto:support@addabaaz.in`. |
| `GA4_MEASUREMENT_ID` | `G-XXXXXXX` — optional Google Analytics 4; loads only after the visitor accepts. |
| `SENTRY_DSN` | Optional server error alerts (also `npm i @sentry/node`). |
| `CONTACT_WEBHOOK_URL` | Optional: POST every contact-form message to Slack/Zapier/etc. |

### Search engines

| Variable | Meaning |
|---|---|
| `ALLOW_INDEXING` | `true` / `false` to force indexing on/off regardless of `NODE_ENV`. |
| `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` | Tokens for the HTML-tag ownership check. |
| `DISABLE_COMPRESSION` | `true` only if your proxy/CDN already compresses responses. |

### Backups and testing

| Variable | Meaning |
|---|---|
| `BACKUP_DIR` (`./backups`), `BACKUP_PASSPHRASE`, `BACKUP_KEEP` (`14`) | Where backups go, encryption passphrase, how many to keep. |
| `BACKUP_R2_BUCKET` (+ `BACKUP_R2_ACCOUNT_ID`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_ENDPOINT`) | Also copy backups to a **separate** R2 bucket. |
| `DISABLE_RATE_LIMIT` | `true` for load tests on staging only (ignored in production). |
| `TEST_DATABASE_URL` | Database server used by `npm test`. |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` | Docker Compose only: passwords for the bundled MySQL container. |

---

## 7. Create your first administrator

Admins are ordinary accounts with an admin flag. (On a Hostinger **Web App** there is no command line — use the phpMyAdmin method in [10.2-D](#102-step-by-step-web-app) instead of step 2.)

1. Open the site and **create an account** (Sign up).
2. On the server, promote it:
   ```bash
   npm run admin -- grant you@example.com
   # Docker:  docker compose exec app npm run admin -- grant you@example.com
   npm run admin -- list          # who is an admin
   npm run admin -- revoke you@example.com
   ```
3. Open `/admin` and sign in with that email and password. (If you signed up with Google/Facebook, sign in on the main site first, then open `/admin`.)
4. The **Dashboard** has a *Finish setting up* list that tells you which optional features are still unconfigured.

Admin sessions last 12 hours. Every admin action is written to the **Audit log**.

---

## 8. Turn on features, one at a time

Every feature is optional and independent. After changing environment variables, **restart the server**.

### 8.1 Sign in with Google

1. [Google Cloud Console](https://console.cloud.google.com/) → *APIs & Services* → **OAuth consent screen** → External, app name ADDABAAZ, your support email and domain → publish.
2. *Credentials* → **Create OAuth client ID** → *Web application*. Under **Authorized JavaScript origins** add `https://addabaaz.in` (and `http://localhost:3000` for development). No redirect URI is needed.
3. Set `GOOGLE_CLIENT_ID=<the client id>` and restart. A "Continue with Google" button appears on the sign-in pages.
4. For the mobile apps also create an Android client (package `in.addabaaz.app` + your signing SHA-1) and an iOS client, then set `GOOGLE_IOS_CLIENT_ID` and add the Android id to `GOOGLE_EXTRA_CLIENT_IDS`.

### 8.2 Sign in with Facebook

1. [developers.facebook.com](https://developers.facebook.com/) → *Create app* → use case **Authenticate and request data from users with Facebook Login** (type Consumer).
2. *Facebook Login → Settings*: enable *Login with the JavaScript SDK* and list `https://addabaaz.in` under **Allowed Domains for the JavaScript SDK**.
3. *App settings → Basic*: copy **App ID** → `FACEBOOK_APP_ID` and **App Secret** → `FACEBOOK_APP_SECRET`; add your privacy-policy URL (`https://addabaaz.in/privacy`) and a data-deletion instruction; switch the app to **Live**.
4. `public_profile` and `email` need no App Review. Restart. For the apps also set `FACEBOOK_CLIENT_TOKEN`.

### 8.3 Sign in with Apple

Required by the App Store if the iOS app offers Google or Facebook. Needs a paid Apple Developer account.

1. *Certificates, Identifiers → Identifiers → App IDs*: enable **Sign In with Apple** on your app's bundle id → `APPLE_CLIENT_ID=<bundle id>`.
2. For the website create a **Services ID** (e.g. `com.addabaaz.web`), tick Sign In with Apple → *Configure*: domain `addabaaz.in`, return URL `https://addabaaz.in` → `APPLE_SERVICE_ID=<services id>`.
3. Restart. Check with `curl https://addabaaz.in/api/v1/auth/providers` — it lists every provider that is configured.

### 8.4 Optional private video storage in Cloudflare R2

Premium is an app-level access setting and is independent of source. This walkthrough configures optional private R2 storage for titles whose media files also need protection; ADDABAAZ gates Premium playback to signed-in viewers **with an active paid plan**.

1. Cloudflare → **R2 → Create bucket** (e.g. `addabaaz-premium`). Keep **public access OFF**.
2. *R2 → Manage API tokens → Create token* with **Object Read only** for that bucket. Copy the Access Key ID and Secret, and note your Account ID.
3. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Restart.
4. Bucket **CORS** (needed for HLS): *Bucket → Settings → CORS policy*:
   ```json
   [{ "AllowedOrigins": ["https://addabaaz.in", "http://localhost:3000"],
      "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["Range"],
      "ExposeHeaders": ["Content-Length", "Content-Range"], "MaxAgeSeconds": 3600 }]
   ```
5. **Getting a video in** — either
   * *MP4 (simplest):* `ffmpeg -i episode.mov -c:v libx264 -crf 21 -preset slow -c:a aac -b:a 128k -movflags +faststart ep6.mp4`, then upload it in the admin (Videos → New video → *Private Cloudflare R2* → Upload — this needs a **write-capable** token, so either use a read/write token in `R2_*` or upload with another tool such as `rclone` and type the key), or
   * *Adaptive HLS (better on mobile networks):* on your own computer, `npm run encode:hls -- episode.mov --name shahid-ep6 --upload`. It needs `ffmpeg` and a write-capable token, and prints the key to use (`premium/shahid-ep6/master.m3u8`). Try a short clip first.
6. In the admin, create the video with *Source = Private Cloudflare R2* and that key; set *Access = Premium*.
7. Verify: `npm run r2:check -- premium/shahid-ep6/master.m3u8`.

For Premium titles stored in R2, playback is protected by login, plan and short-lived signed links. It is **not DRM**; a determined person can still record their screen.

### 8.5 Payments (Razorpay, prepaid plans)

Plans are ₹99 for 30 days and ₹799 for 365 days (prices include GST); they don't auto-renew. Change them in `server/src/plans.js`.

1. Create a [Razorpay](https://razorpay.com/) account. In *Settings → API Keys* generate **test** keys first.
2. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. *Settings → Webhooks* → add `https://addabaaz.in/api/v1/payments/webhook`, events **`payment.captured`**, **`payment.failed`** and **`refund.created` / `refund.processed` / `refund.failed`**, choose a secret and put it in `RAZORPAY_WEBHOOK_SECRET`.
4. Restart, and **make a real test-mode payment** (Razorpay's test cards/UPI), check the invoice PDF and the refund flow in `/admin → Payments`.
5. Switch to `rzp_live_…` keys only after the test passes.

Without keys: development shows a labelled demo checkout; production has no checkout at all.

### 8.6 GST invoices and refunds

Set `GSTIN` (15 characters, checked for format, state code and check character), `GST_LEGAL_NAME`, `BUSINESS_ADDRESS` (and the other `GST_*` / `INVOICE_*` values). The server refuses to start with a malformed GSTIN. Every paid plan then gets a numbered tax invoice (`AB/2627/000001`, gapless per financial year); refunds produce credit notes. Download the sales register CSV from `/admin → Payments` for your accountant.

Not included: GST e-invoice/IRN and return filing (they need a GST Suvidha Provider).

### 8.7 Email (receipts, password reset, verification, refunds)

Set `SMTP_URL`, `MAIL_FROM`, `SUPPORT_EMAIL` and `PUBLIC_SITE_URL` (links in emails use it). Any SMTP provider works (Amazon SES, Brevo, Mailgun, Zoho, Gmail app password…). Once SMTP is set, viewers must confirm their email before buying or commenting. Set up SPF/DKIM for your sending domain so mail doesn't land in spam. After deploy, use `/admin` → Dashboard → System status → **Send test email** to verify the actual SMTP connection and delivery. On Render Free, ports 25/465/587 are blocked: use a provider with port 2525 (`SMTP_URL=smtp://username:password@smtp-host:2525`, STARTTLS) or a paid Render instance; URL-encode special characters in the username/password.

### 8.8 Push notifications

1. `npx web-push generate-vapid-keys`
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:support@addabaaz.in`, restart.
3. Viewers switch it on under *Account → Notifications*. New episodes and launch reminders are sent automatically; send announcements from `/admin → Notifications`.
4. iPhones receive web push only when the site is added to the Home Screen (iOS 16.4+).

### 8.9 Analytics and error monitoring

* Built in: `/admin → Analytics` (plays, watch time, top titles, revenue) and `/admin → Errors`. Nothing to set up.
* Optional Google Analytics 4: create a GA4 property, set `GA4_MEASUREMENT_ID=G-XXXXXXX`. A consent banner then appears and GA loads only after a visitor accepts.
* Optional Sentry: `npm i @sentry/node`, set `SENTRY_DSN`.

### 8.10 Legal pages (do this before taking money)

The site serves `/privacy`, `/terms` and `/refunds`. **They are templates, not legal advice.** Have a lawyer review them, then edit the wording in `app/js/legal-text.js` (one file used by the site and the search-engine renderer) and update `LEGAL_UPDATED`. See `docs/COMPLIANCE.md` for what the software stores and what the policies must say.

---

## 9. Adding content

The live catalog is stored in MySQL and edited in `/admin`:

* **Shows** — poster, description, genres, rating (U / 7+ / 13+ / 16+ / 18+; Kids profiles show only U and 7+), Free/Premium.
* **Videos & reels** — YouTube link, MP4/HLS URL or R2 key, thumbnail, duration, *Publish at* (schedule), *Subtitles* (upload `.srt`/`.vtt`), rating and independent Free/Premium access.
* **Coming soon**, **Gallery**, **Studio & team** (About / Services / Contact pages).

The first start seeds MySQL from `data/catalog.json` and `data/studio.json`. Those files are still used by the static site and the mobile bundle, so after editing in the admin run `npm run catalog:export` to write them back, then commit. `npm run catalog:import -- --force` goes the other way and **replaces** the database catalog. `npm run validate:catalog` checks the files.

---

## 10. Deploying to production (Hostinger Business Web Hosting)

This guide is for **Hostinger Business Web Hosting** (no VPS). Business plans can run a Node.js app as a **Web App** in hPanel, deployed from GitHub or a ZIP file, and include MySQL databases, phpMyAdmin, free SSL and cron/File Manager tools. (Hostinger's *Premium* and *Single* shared plans do not offer Node.js Web Apps — you would need to upgrade to Business.)

Business hosting is shared hosting, so three things work differently from a normal server. Each is handled in the steps below:

| Limit | What it means | What you do |
|---|---|---|
| **Deploys erase the app folder** | Everything inside the deployed app (`hbuilds/…`, `public_html`) is replaced on every deploy. Images uploaded from `/admin` are kept in MySQL, so they survive; only the local upload cache is emptied. | Nothing required; optionally keep the cache outside the app (**10.2-C**). |
| **The process sleeps when idle** | Hostinger stops your app when nobody visits and restarts it on the next request. Timer-based jobs (renewal reminders, new-episode pushes) only run while it is awake. | A free uptime monitor pings it every 5 minutes (**10.2-E**). |
| **No command line** | You can't run `npm run admin` or `npm run backup`. | Make the first admin and take backups with phpMyAdmin and hPanel (**10.2-D**, section 13). |

### 10.1 Before you start (both routes)

1. **Domain with HTTPS.** Point your domain at the hosting in hPanel (*Domains*), and make sure the free SSL certificate is active. Pick **one** hostname (`addabaaz.in` *or* `www.addabaaz.in`) and redirect the other to it.
2. **Code on GitHub.** This repository (or your fork) — Hostinger deploys straight from it. A private repo works once you install the Hostinger GitHub App on it.
3. **Secrets ready.** Generate `JWT_SECRET` once and keep it in a password manager (changing it signs everyone out):
   ```bash
   openssl rand -hex 32        # or: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Settings you will paste into Hostinger** (from section 6). At minimum:

   | Variable | Value on Hostinger |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | the random string above |
   | `PUBLIC_SITE_URL` | `https://addabaaz.in` (your real address, no trailing slash) |
   | `DB_HOST` | **`127.0.0.1`** (not `localhost` — see the troubleshooting table) |
   | `DB_PORT` | `3306` |
   | `DB_NAME`, `DB_USER`, `DB_PASSWORD` | from step 10.2-A below (Hostinger adds a prefix like `u123456789_`) |
   | `DB_POOL_SIZE` | `5` (shared plans limit connections per database user) |
   | `TRUST_PROXY` | `1` |
   | `UPLOAD_DIR` | optional: a folder **outside** the deployed app (a cache; uploads themselves are stored in MySQL) — see 10.2-C |

   Do **not** set `PORT`: Hostinger chooses it and the app reads it automatically. Add the optional feature variables (Razorpay, R2, SMTP …) when you reach section 8.

   Use the separate `DB_*` variables rather than `DATABASE_URL` — a password containing `@`, `:` or `/` breaks a URL unless encoded.

### 10.2 Step by step (Web App)

**A. Create the database (hPanel)**

1. hPanel → your hosting → **Databases → MySQL Databases** → **Create database**. Enter a name, a user and a strong password; write all three down. Hostinger adds a prefix (your account id) to both (for example `u123456789_addabaaz`).
2. Nothing else to do — the app creates its own tables the first time it starts (`DB_MIGRATE` defaults to `true`). **Do not set `DB_CREATE=true`**: Hostinger database users may not create databases.
3. Keep **Remote MySQL** switched off. The app runs on the same account, so it only needs the local connection (`127.0.0.1`).

> Hostinger describes its databases as "MySQL"; on shared plans the engine can be MariaDB. ADDABAAZ is developed and tested against **MySQL 5.7/8** and only uses standard SQL plus JSON columns, which MariaDB stores as text — the code reads both forms. It has not been run on MariaDB by the project's tests, so **do the first-run check in step F** before you announce anything. If you see SQL errors there, copy the exact message from **Runtime logs** and get the (small) fix made in `server/migrations/` or `server/src/db*.js` — see the troubleshooting table. Ask Hostinger support which engine and version your database runs.

**B. Create the Web App**

1. hPanel → **Websites → Add Website → Node.js web app**.
2. Choose **Import Git repository → Connect with GitHub**, install the Hostinger GitHub App for this repository, and select it.
   **"Import Git repository" greyed out, or no GitHub?** Use **Upload your files** instead (the rest of the steps are identical):

   1. Make sure the code you want is what's on disk. If you added shows in your local `/admin` and want them on the live site, run `npm run catalog:export` first — it writes them into `data/*.json`, which seeds the new Hostinger database on its first start.
   2. Build a clean ZIP with `package.json` at its top level, **without** `node_modules`, `.git` or your local `.env`:
      ```bash
      git archive --format=zip -o addabaaz.zip HEAD          # committed files only (recommended)
      # Windows PowerShell: the same git archive command works — see section 4.6
      # or, without git:
      zip -r addabaaz.zip . -x "node_modules/*" ".git/*" ".env" "www/*" "backups/*" "uploads/*" "mobile/*"
      ```
   3. In hPanel choose **Upload your files**, upload `addabaaz.zip`, and continue with the settings below. Hostinger installs the packages itself.
   4. Uploads don't auto-deploy: for each update make a new ZIP and upload it again (**Deployments → Redeploy with new files**). Environment variables are kept.

   The usual reasons the Git option is unavailable: the GitHub App isn't installed for that repository (click *Connect with GitHub* and grant access), the domain already has a website on the plan (remove it first — download a backup — then *Add Website* again), or the plan isn't Business/Cloud.
3. Set the deploy settings:

   | Field | Value |
   |---|---|
   | Application type / framework preset | **Express** (or *Other*) |
   | Branch | `production` (or whichever branch you release from) |
   | Node.js version | **22** (20 or 24 also work) |
   | Root directory | `/` (leave empty) |
   | Build script | none needed. (For Express, Hostinger may pre-fill `npm run build:www` and not let you clear it — that's harmless: it only builds a static copy in `www/` and can print `fatal: not a git repository`, which you can ignore.) |
   | Output directory | leave empty (the whole project is deployed) |
   | Entry file | **`server.cjs`** — a small CommonJS file in the repo root that starts the real server. **Do not use `server/src/index.js`**: Hostinger loads the entry file with `require()`, which fails on it with `ERR_REQUIRE_ASYNC_MODULE`. |
   | Package manager | npm (detected from `package-lock.json`) |

4. Open **Set environment variables** and add every variable from the table in 10.1 (or use **Import .env** with a file made from `.env.example` — delete its `DATABASE_URL=…change-me…` line first, because `DATABASE_URL` takes priority over the `DB_*` variables). Values are stored encrypted and survive redeploys. Saving changes redeploys the app.
5. Click **Deploy**. Hostinger installs the packages, starts the app and shows a **Running** badge. On the very first start the app creates all tables and imports the starting catalog from `data/catalog.json`. Watch **Deployments → build log** and **Runtime logs** — you should see `[migrate] applied 6 migration(s)` and `ADDABAAZ running on …`.

**C. Uploads and deploys**

Hostinger **replaces everything inside the deployed app on every deployment** (`~/domains/<your-domain>/hbuilds/…` and `public_html`) — direct edits are not preserved. Images and subtitles uploaded from `/admin` are therefore **stored in your MySQL database** (table `uploaded_files`), not only as files: a deploy cannot lose them, every visitor on every device sees them, and your phpMyAdmin export (section 13) contains them. The app also keeps a copy in the upload folder (`UPLOAD_DIR`) to serve them faster, and quietly rebuilds that copy from MySQL whenever it is empty. So the folder is a cache and nothing needs to be done here.

*Optional:* to avoid re-reading images from MySQL after each deploy, keep the cache outside the deployed app:

1. hPanel → **File Manager** → in your home folder (the one that contains `domains/`) create `addabaaz-data/uploads`.
2. Add the environment variable `UPLOAD_DIR=/home/u123456789/addabaaz-data/uploads` (use your real account id; the File Manager shows the full path) and redeploy.
3. If the app cannot write there, nothing breaks — images are simply served straight from MySQL.

Images uploaded **before** uploads were stored in MySQL (migration `010_uploaded_files`) existed only as files and may already be gone after an earlier deploy: open `/admin`, edit the title, upload the image again and save (once).

Videos stored in **R2** are not affected: they go straight from the browser to Cloudflare R2, never to Hostinger's disk.

**D. Create your first administrator (no command line needed)**

The `npm run admin` tool is not available on this plan; do the same thing in phpMyAdmin:

1. Open your site and **sign up** with the email that will be the admin.
2. hPanel → **Databases → phpMyAdmin** → open your database → **SQL** tab → run (use your email in lowercase):
   ```sql
   UPDATE users SET is_admin = 1 WHERE email = 'you@example.com';
   ```
   It should report *1 row affected*. (The `is_admin` column exists after the first start — if phpMyAdmin says the column is unknown, the app has not finished its first start; check the runtime log.)
3. Open `https://your-domain/admin` and sign in.

**E. Turn on the scheduled jobs (keep the process awake)**

Hostinger stops a Web App's process after a period without traffic and starts it again on the next request. ADDABAAZ's background jobs (renewal reminders, "new episode" pushes, launch reminders, clean-ups) run on timers *inside* that process, so they only run while it is awake.

* Create a free monitor at [UptimeRobot](https://uptimerobot.com) (or any similar service): **HTTP(S) check** on `https://your-domain/api/v1/health/ready`, every **5 minutes**. This doubles as your downtime alert and keeps the app awake so the jobs run.
* Payment webhooks, sign-ins and page views also wake the app on their own, so nothing is lost if it sleeps — only *time-based* jobs are delayed until the next visit or ping.

**F. First-run check**

1. `https://your-domain/api/v1/health/ready` answers `{"ok":true,"db":"up"}` (a 503 means the database connection is wrong — check the runtime log).
2. Open the home page, sign up, sign in, and open `/admin` → **Dashboard** → *System status*.
3. In `/admin → Content` add a show, reload the public site, and see it appear.
4. View `https://your-domain/sitemap.xml` and `https://your-domain/robots.txt` (with `NODE_ENV=production` it must **allow** indexing).

**G. Updating**

Push to the connected branch — Hostinger rebuilds and restarts automatically (or press *Redeploy* in **Deployments**). Migrations run at start and are additive. Take a backup first (section 13). To roll back, push the older commit. The site briefly restarts during a deploy.

**H. Email (optional but recommended)**

If you created a mailbox in hPanel (*Emails*), you can send through it:
`SMTP_URL=smtps://billing%40addabaaz.in:MAILBOX_PASSWORD@smtp.hostinger.com:465` and `MAIL_FROM="ADDABAAZ <billing@addabaaz.in>"` (write `@` inside the username as `%40`, and URL-encode any special characters in the password). Make sure the SPF/DKIM records for the domain are in place (hPanel shows them under *Emails*; copy them across if your DNS is hosted elsewhere) so receipts don't land in spam.

### 10.3 After the first deploy

* Go through **section 8** for each feature you want (each one is just more environment variables, then a redeploy). Callback and webhook addresses always use your real domain, e.g. `https://addabaaz.in/api/v1/payments/webhook`.
* Then **section 11** (Google search), and finally the **go-live checklist** (section 14).
* Cloudflare's orange-cloud proxy in front of Hostinger is **not needed**. (Video files stored in Cloudflare R2 are separate and unaffected.)
* Your plan includes up to five Web Apps, so you can create a second app from the same repository as a **staging** copy on a subdomain (own database, test Razorpay keys, a different `JWT_SECRET`, and `ALLOW_INDEXING=false` so Google ignores it). Keep `NODE_ENV=production` there too — without it the app falls back to an insecure development secret.

### 10.4 If something doesn't fit

* **Static-only fallback:** `npm run build:www` produces a `www/` folder you can upload to `public_html` with File Manager on *any* Hostinger plan; you get browsing and free videos, but no accounts, premium video or admin (section 5).
* Anything not covered here: read the **Runtime logs** and **Deployments** build log in hPanel first, then the troubleshooting table (section 15), then Hostinger support (they can confirm your database engine, connection limits and whether the app may write outside its folder).

---

### 10.4 Another way to host: Render + Aiven MySQL

Not on Hostinger? The full guide for **Render** (web service) with **Aiven** (managed MySQL) is in [`docs/DEPLOY-RENDER-AIVEN.md`](docs/DEPLOY-RENDER-AIVEN.md); the repository contains a matching `render.yaml`.

---

## 11. After you deploy: Google search

1. `PUBLIC_SITE_URL` exact, `NODE_ENV=production` (only then is the site indexable; `robots.txt` and the sitemap are generated automatically).
2. One hostname; `http` → `https`; `www` → apex.
3. **Google Search Console** → add a *domain property* → verify (DNS, or set `GOOGLE_SITE_VERIFICATION`) → **Sitemaps → submit** `https://addabaaz.in/sitemap.xml`.
4. *URL inspection*: test `/`, one `/show/…` and one `/watch/…` page; *Request indexing* for the home page.
5. Run Google's **Rich Results Test** on a show and a watch page; check PageSpeed Insights.
6. Bing Webmaster Tools → import from Search Console.

Full guidance on writing titles and descriptions that rank is in `docs/SEO.md`.

---

## 12. Android and iOS apps

The apps are the website inside a native shell (Capacitor). Requirements: **Android** — Android Studio (SDK 36), JDK 21; **iOS** — a Mac with Xcode 16+ and CocoaPods; store accounts (Google Play $25 once, Apple Developer $99/year).

```bash
npm install                                            # repo root
API_BASE=https://addabaaz.in npm run build:www         # point the app at your API
cd mobile && npm install
npx cap add android
npx cap add ios                                        # macOS only
npm run assets                                         # icons + splash from ../resources
npm run sync                                           # also raises the Android build to API 36 / Gradle plugin 8.9.1
npm run open:android                                   # or open:ios
```

Later releases: `npm run mobile:sync` from the repo root, then build from Android Studio / Xcode.

Before publishing:

1. Edit `mobile/capacitor.config.json`: `appId` (default `in.addabaaz.app`) and a unique `server.hostname` you control.
2. Finish the native Google/Facebook/Apple sign-in configuration (Android SHA-1, iOS URL schemes, Facebook `Info.plist`/`strings.xml`) — see `docs/AUTH.md`.
3. Both stores require a **privacy-policy URL** (`https://addabaaz.in/privacy`) and in-app **account deletion** (Account → Delete account — built in).
4. The apps intentionally do **not** sell plans (Apple/Google require their own billing for in-app digital subscriptions); they tell viewers to subscribe on the website. Check the stores' current rules before you submit.
5. Answer the content-rating questionnaires honestly (some comedy has adult humour).

---

## 13. Running it

### Backups

**Hostinger Web App (no command line).** `npm run backup` cannot be run there, so use what Hostinger gives you — and do all three:

1. **Database:** hPanel → *Databases* → **phpMyAdmin** → select your database → **Export** (Quick, SQL) and keep the file somewhere else, weekly and before every big change. Restoring = phpMyAdmin → **Import**. Also turn on / check Hostinger's own **Backups** page in hPanel (its schedule depends on your plan).
2. **Uploaded images and subtitles** are stored in the database (table `uploaded_files`), so the phpMyAdmin export in step 1 already contains them; `addabaaz-data/uploads` (if you made it) is only a cache.
3. **Settings:** keep a copy of every environment variable (especially `JWT_SECRET`) in a password manager.

Test an import on a spare database once, before you need it. The `npm run backup` command below is for computers where you have a terminal (your own machine, or a copy of the site you run locally).

```bash
BACKUP_PASSPHRASE='a long secret' npm run backup     # → ./backups/addabaaz-<UTC time>.ndjson.gz.enc
```

* One file with **every table** and all admin-uploaded files, taken from a consistent snapshot. Set `BACKUP_PASSPHRASE` — it contains emails and password hashes.
* Keeps the newest `BACKUP_KEEP` files (default 14). With `BACKUP_R2_BUCKET` set it also copies each backup to a **separate** R2 bucket (never the bucket used for video media).
* **Copy backups off the server.** R2 video objects are not included — enable versioning on the video bucket. Your `.env` (especially `JWT_SECRET`) is not included either; store it in a password manager.
* Schedule daily: `0 3 * * * cd /path/to/addabaaz && npm run -s backup >> /var/log/ab-backup.log 2>&1` (Docker: `docker compose exec -T app npm run -s backup`).

Restore:

```bash
BACKUP_PASSPHRASE='…' npm run restore -- backups/addabaaz-….ndjson.gz.enc --check   # verify only, changes nothing
BACKUP_PASSPHRASE='…' npm run restore -- backups/addabaaz-….ndjson.gz.enc --force   # REPLACES all data and uploads
```

Test a restore on a spare database now and then — an untested backup is only a hope. A truncated, tampered or wrong-passphrase file is rejected before anything is deleted. Restart the app after a restore.

### Health, logs, errors

* `GET /api/v1/health` (liveness) and `/api/v1/health/ready` (503 when MySQL is down) — point your uptime monitor and load balancer here.
* `/admin → Dashboard → System status`, `/admin → Errors`, `/admin → Audit log`.
* Logs go to stdout (`docker compose logs -f app`).

### Load testing (staging only)

```bash
DISABLE_RATE_LIMIT=true npm start                     # a staging copy, never production
npm run loadtest -- --url http://localhost:3000 --users 50 --seconds 20
```

Prints requests per second and p50/p95/p99 latency per endpoint. The numbers depend on your machine, network and database size — use them to compare before/after changes, not as a capacity promise.

### Routine tasks

| Task | How |
|---|---|
| New administrator | `npm run admin -- grant email` (Hostinger Web App: `UPDATE users SET is_admin = 1 WHERE email = '…';` in phpMyAdmin) |
| Refund a customer | `/admin → Payments → Refund…`, or approve their request in `/admin → Refund requests` |
| Free access for someone | `/admin → Users → user → Give free access` |
| Delete a user's data on request | `/admin → Users → Delete` (payment/invoice records are kept — GST law) |
| Moderate comments | `/admin → Comments` |
| Send an announcement | `/admin → Notifications` |
| Change plan prices | edit `server/src/plans.js`, redeploy (prices appear on invoices — change deliberately) |

---

## 14. Go-live checklist

- [ ] `NODE_ENV=production`, strong unique `JWT_SECRET`, `PUBLIC_SITE_URL` correct, HTTPS working, one hostname.
- [ ] MySQL password strong; database **not** exposed to the internet; automated backups running and one restore tested.
- [ ] `TRUST_PROXY` set to match your proxy chain (`1` on Hostinger).
- [ ] **Hostinger:** an image uploaded in `/admin` is still shown after a redeploy (uploads are stored in MySQL); uptime monitor on `/api/v1/health/ready` running; a phpMyAdmin export downloaded and stored off Hostinger.
- [ ] At least one admin (`npm run admin -- grant …`); no leftover test admins.
- [ ] Razorpay **live** keys + webhook set, one real low-value payment and refund tried.
- [ ] `GSTIN` and business details set; a test invoice checked by your accountant.
- [ ] SMTP working (send yourself a password reset); SPF/DKIM set.
- [ ] Privacy / Terms / Refund text reviewed by a lawyer (`app/js/legal-text.js`).
- [ ] Google/Facebook/Apple sign-in tried on the real domain (Facebook app switched to **Live**).
- [ ] If using R2 media, the bucket is private and an R2-hosted Premium title plays for a paid account and is refused for a free one (`npm run r2:check`).
- [ ] Ratings set on shows/videos so the **Kids** profile has something to show.
- [ ] Sitemap submitted in Search Console.
- [ ] `ADMIN_TOKEN` empty unless a script needs it; `ALLOW_MOCK_PAYMENTS` **unset**.

---

## 15. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot connect to MySQL (ECONNREFUSED …)` on start | MySQL isn't running or `DATABASE_URL` is wrong. With Docker use host `db`, not `127.0.0.1`. |
| Hostinger: `Access denied for user '…'@'::1'` or `ECONNREFUSED ::1` | Use `DB_HOST=127.0.0.1`, not `localhost` (Node resolves `localhost` to IPv6). |
| Hostinger: Runtime log shows `ERR_REQUIRE_ASYNC_MODULE` | The entry file is `server/src/index.js` (or another ES-module file with top-level `await`). Set **Entry file** to `server.cjs` and redeploy. |
| Hostinger: app is "Running" but the site shows an error / 503 | Open **Runtime logs**. Usual causes: a missing or mistyped environment variable, wrong `DB_*` values, or an entry file that doesn't exist (use `server.cjs`). Never hard-code a port — the app reads `PORT`. |
| Hostinger: 403 after a redeploy | Hostinger regenerates `public_html/.htaccess` on each deploy; don't edit it by hand — just redeploy. |
| An uploaded poster/image shows on one device but not on others, or vanished after a deploy | It was uploaded before images were stored in MySQL, so its file was lost with the old disk. Upload it again in `/admin` and save the title (once); new uploads are permanent (section 10.2-C). |
| Hostinger: reminders / notifications arrive late | The process sleeps when idle. Add the 5-minute uptime monitor (section 10.2-E). |
| Hostinger: `Too many connections` / `max_user_connections` | Lower `DB_POOL_SIZE` (try `3`–`5`). |
| Hostinger: SQL syntax errors on the first start | The database is probably MariaDB and hit something the app doesn't support there. Copy the exact error from the **Runtime logs** and send it to whoever maintains the code — it is a small fix in `server/migrations/` or `server/src/db*.js`. Ask Hostinger support which engine/version your database runs. |
| `ER_ACCESS_DENIED_ERROR` / `Unknown database` | Wrong credentials, or the database doesn't exist — create it, or start once with `DB_CREATE=true`. |
| Android Studio build: `androidx.browser:browser:1.9.0 requires Android Gradle plugin 8.9.1 or higher` / `requires … compile against version 36 or later` | The generated Android project is older than its libraries. In `mobile/` run `npm run android:patch` (raises the Android Gradle Plugin to 8.9.1 and compileSdk/targetSdk to 36; it also runs on every `npm run sync`), install **Android 16 (API 36)** in Android Studio → SDK Manager, then **File → Sync Project with Gradle Files**. API 36 is also what Google Play requires for new apps and updates since 31 Aug 2026. |
| `npm test`: nearly every test fails with `MySQL is not reachable` | Start MySQL, or set `TEST_DATABASE_URL`. |
| Server refuses to start: JWT secret | `NODE_ENV=production` requires `JWT_SECRET`. |
| Server refuses to start: GSTIN invalid | Fix `GSTIN` (15 characters, valid state code and check character) or leave it empty. |
| Google/Facebook button missing | That provider's variables aren't set (or the server wasn't restarted). Check `/api/v1/auth/providers`. |
| Google button says "origin not allowed" | Add the exact site origin (scheme + host + port) to the OAuth client's Authorized JavaScript origins. |
| No emails arrive | Empty `SMTP_URL` → emails are only logged (`[mail:dev]` in development, silent in production). Check the SMTP URL and your provider's logs. |
| Reset/verify links point at the wrong site | Set `PUBLIC_SITE_URL`. |
| "Subscribe" does nothing in production | No Razorpay keys → no checkout in production. Set the keys (or `ALLOW_MOCK_PAYMENTS=true` on staging only). |
| Paid but no access | Webhook not set or wrong secret. Check *Razorpay → Webhooks → recent deliveries* and `RAZORPAY_WEBHOOK_SECRET`. |
| R2-hosted video 503 `storage_not_configured` | `R2_*` variables missing. |
| HLS video won't start | Bucket CORS missing; or behind a proxy without `PUBLIC_API_URL`; check `npm run r2:check`. |
| Premium video 429 "Too many screens" | The account is playing on more devices than `STREAM_LIMIT`; stop one, or *Account → Your devices → Remove*. |
| Uploads from the admin fail | Image uploads are limited to 10 MB by the app; behind nginx, set `client_max_body_size 10m` or higher. Video upload from the browser needs a write-capable R2 token and bucket CORS allowing `PUT`. |
| Admin says "That account isn't an administrator" | `npm run admin -- grant <email>`. |
| Everyone got signed out | `JWT_SECRET` changed (or was unset and the server restarted in dev). |
| Site shows old content after an update | The service worker caches the shell; hard-refresh once. Its version is in `sw.js`. |
| Google isn't indexing | Section 11; check *Search Console → Pages* for the reason. Staging/dev copies are deliberately `noindex`. |
| Mobile: white screen after update | Run `npm run build:www` before `npx cap sync` (the apps embed `www/`). |
| Mobile: YouTube "Error 153" on iOS | Keep `iosScheme` `https` and `server.hostname` set in `mobile/capacitor.config.json`, then `npx cap sync`. |

---

## 16. Where things are in the code

```
index.html, sw.js, manifest.webmanifest   the app shell, service worker, PWA manifest
app/js/                                    the website (vanilla ES modules)
  main.js, router.js, routes.js              start-up, page router, route table
  views/                                     one file per page (home, show, watch, account, billing …)
  data/                                      catalog + user state, API client, local/remote adapters
  ui/, players/, seo/                        shared widgets, video players, page meta (shared with the server)
app/css/styles.css                         the whole site's stylesheet
admin/                                     the admin console (index.html, admin.css, js/views/*)
server/src/                                the API + web server
  index.js                                   process start-up and schedulers
  app.js                                     Express app: all public and account routes
  features.js, admin.js, admin-extra.js      newer account features, admin API
  db*.js, migrate.js, ../migrations/*.sql    MySQL access layer and schema
  billing.js, gst.js, payments.js, emails.js payments, invoices, Razorpay, emails
  seo.js, catalog*.js, push.js, jobs.js, backup.js, …
server/test/                               automated tests (npm test)
scripts/                                   backup, restore, loadtest, encode-hls, build-www, catalog & image tools
mobile/                                    Capacitor config for the Android/iOS apps
docs/                                      deeper guides + openapi.yaml (API reference)
```

Deeper guides: `docs/ARCHITECTURE.md` (how the parts fit), `AUTH.md`, `PREMIUM.md`, `BILLING.md`, `ADMIN.md`, `ENGAGEMENT.md`, `COMPLIANCE.md`, `SEO.md`, `DATABASE.md`, `MOBILE.md`, `CONTENT.md`.
