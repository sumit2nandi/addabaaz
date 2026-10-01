# Viewing & engagement features

Everything here degrades gracefully: the static site (no API) simply doesn't show what needs an account.

## Accounts
| Feature | How it works |
|---|---|
| **Forgot / reset password** | `/forgot` → email with a single-use link `…/reset?token=…` (valid 1 h, stored hashed). Resetting signs out every other session and logs the person in. The answer never reveals whether an address has an account; one email per address per minute. Social-only accounts can use the same flow to **add** a password. |
| **Email confirmation** | Signup emails `…/verify?token=…` (valid 3 days). Social sign-ins arrive verified. **Only when SMTP is configured** are checkout and comments blocked for unverified addresses (403 `email_unverified`) — otherwise nobody could ever confirm. |
| **Sign out everywhere** | Account → Security. Bumps a per-user session version; every older token stops working immediately. Changing/resetting the password does the same. |
| **Sign in with Apple** | See `docs/AUTH.md`. |

## Watching
| Feature | Notes |
|---|---|
| **Subtitles** | Admin → Videos → *Subtitles*: upload `.srt`/`.vtt` (SRT is converted to WebVTT, validated, stored under `/uploads`) or paste an https `.vtt` URL. The player attaches them as `<track>`s (fetched by the app and used as same-origin blobs, so no CORS setup is needed on the video host). The viewer's last choice is remembered. Free YouTube videos use YouTube's own captions. |
| **Cast** | A *Cast* button appears in browsers that support the Remote Playback API (Chrome/Edge/Android) or AirPlay (Safari). Works for R2/MP4/HLS titles; YouTube embeds use YouTube's own cast. |
| **Kids profiles + parental PIN** | Mark a profile "Kids": only shows/videos rated **U** or **7+** are visible (unrated titles are hidden — set ratings in the admin), no comments. A 4–6 digit PIN (Account → Kids & parental controls) is required to leave a Kids profile and, on the server, to create/edit/delete profiles (`X-Parental-Pin`; 5 wrong tries lock for 15 min). **The kids filter itself runs in the app** — it is a family-friendly filter, not a security boundary: the raw `/catalog` JSON still lists everything. |
| **Screens at once** | Each plan allows `STREAM_LIMIT` (default 2) premium streams at the same time. Devices identify themselves with `X-Device-Id`, send a heartbeat every 30 s while playing, and a seat expires 90 s after the last beat. Over the limit → 429 `stream_limit`; the player offers *Try again* and *Manage devices*. Free videos are never limited. |
| **Resume anywhere** | Progress is stored per profile on the server (already the case); covered by a two-device test. |
| **Ratings** | 👍/👎 on shows and videos, one per profile, public counts. Feeds *Because you watched …* on the home page (computed on the device from history, list and thumbs: same-genre shows you haven't started, minus ones you disliked). |
| **Comments** | On videos, moderated: 1–1000 chars, at most one link, 5 per 10 minutes per account, report button; **3 reports auto-hide** a comment until an admin restores or deletes it (Admin → Comments). Deleting an account deletes its comments. |

## Notifications (Web Push)
1. `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:you@addabaaz.in`.
2. Viewers switch it on in Account → Notifications (per browser; choose new episodes / launches / announcements). Signing out removes that device's subscription. Dead subscriptions (404/410) are cleaned up automatically.
3. **Automatic:** a new episode of a show someone follows (My List) and the launch of a Coming Soon title they set a reminder for. A `notify_sent` ledger makes every notification at-most-once even across restarts or several server instances. Scheduled videos notify when they go live.
4. **Manual:** Admin → Notifications → audience (announcements, everyone, followers of a show, reminder-holders of a launch).
5. iOS: Web Push works only for the site **installed to the Home Screen** (iOS 16.4+). Native FCM/APNs push for the store apps is **not** included (it needs your Firebase/Apple credentials).

## Analytics
- **First-party**: the player reports plays and watch time (`POST /events/play`, no cookies, no personal data, capped per request). Admin → Analytics shows plays/watch time per day, top shows and videos, revenue. Counted only when a video really starts playing here (ad-blockers may hide some). YouTube's own view counts are separate.
- **Google Analytics 4 (optional)**: set `GA4_MEASUREMENT_ID=G-XXXXXXX`. It is loaded **only after the visitor accepts** the consent banner (shown only when an id is configured); *Privacy choices* in the footer changes the decision at any time. Page views are sent on route changes.

## Scheduled publishing
Set *Publish at* on a video: until then it is hidden from viewers, the API, the sitemap and Google (admins still see it, with a "goes live" badge). The scheduler (every minute, `server/src/jobs.js`) announces it when it goes live.

## Self-service refunds
Billing → *Request a refund* (Razorpay-paid purchases within `REFUND_WINDOW_DAYS`, default 7). The support inbox gets an email; Admin → Refund requests → **Approve** runs the normal refund (Razorpay, credit note, access revoked unless you untick it) or **Decline** with a note the customer receives. If Razorpay refuses, the request returns to *pending*. Legal wording for your refund policy is a template (see `docs/COMPLIANCE.md`).

## Error monitoring
The browser reports uncaught errors and failed route renders (max 5 per page, de-duplicated, common noise filtered); the server records unexpected 500s. Admin → Errors groups them (kept 30 days). For alerts, `npm i @sentry/node` and set `SENTRY_DSN` — server errors are then forwarded too.

## Operations scripts
| Command | What |
|---|---|
| `npm run backup` | One gzipped NDJSON file with **every table** plus admin-uploaded files → `BACKUP_DIR` (default `./backups`), consistent snapshot, keeps the newest `BACKUP_KEEP` (14). `BACKUP_PASSPHRASE` encrypts it (AES-256-GCM) — **set it**: the file contains emails and password hashes. `BACKUP_R2_BUCKET` (+ `BACKUP_R2_*` or the `R2_*` credentials) also copies it to a **separate** bucket (never the bucket used for video media). Not included: video objects stored in R2 (enable versioning on that bucket) and your env vars/JWT secret. Schedule it: `0 3 * * * cd /app && npm run -s backup >> /var/log/ab-backup.log 2>&1`. |
| `npm run restore -- <file> --check` | Decrypts and validates a backup (row counts, end marker) without touching anything. **Do this regularly** — a backup you never restored is a hope, not a backup. |
| `npm run restore -- <file> --force` | Migrates the schema, then **replaces** all data and uploads. A truncated, tampered or wrong-passphrase file is rejected before anything is deleted. Tested round trip: `server/test/backup.test.js`. |
| `npm run loadtest -- --url http://staging:3000 --users 50 --seconds 20` | Dependency-free load generator (anonymous browsing + signed-in progress/ratings). Start the target with `DISABLE_RATE_LIMIT=true` (ignored in production). **Numbers are indicative only** — they depend on the machine, network and database; use them to compare before/after changes. Never aim it at production. |
| `npm run encode:hls -- episode.mov --name shahid-ep6 --upload` | ffmpeg → adaptive HLS ladder (1080/720/480/360p, never upscaling, 6 s segments) → uploads to `premium/<name>/` in R2 and prints the key. **Needs ffmpeg/ffprobe on your machine; the command builder is unit-tested but the script has not been run against real ffmpeg/R2 here** — try a short clip first. |

## Environment
`STREAM_LIMIT`, `REFUND_WINDOW_DAYS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `APPLE_CLIENT_ID`, `APPLE_SERVICE_ID`, `GA4_MEASUREMENT_ID`, `SENTRY_DSN`, `BACKUP_*`, `DISABLE_RATE_LIMIT` — see `.env.example`.
