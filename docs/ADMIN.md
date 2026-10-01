# Admin console

`/admin` is a web console for running the whole site: **content** (shows, episodes, reels, trailers, coming-soon, gallery, studio & team), **customers** (users, plans, payments, refunds, invoices, coupons, contact messages) and a **per-person audit log**. It is part of the same server as the site — no extra service.

```
https://your-site/admin
```

## 1. Give yourself access

Admins are normal accounts with an admin flag. Sign up on the site (email/password, Google or Facebook), then on the server:

```bash
npm run admin -- grant you@example.com     # make an administrator
npm run admin -- revoke you@example.com
npm run admin -- list
```

Open `/admin` and sign in with the **email and password** of that account. (Social-only accounts: sign in on the main site first, then open `/admin` — the same session is used.) Later, administrators can promote or demote each other from **Users → user → Make admin**; the last administrator can't be removed, and nobody can lock themselves out.

Security notes

- Admin sessions are honoured only for **12 hours** after sign-in (`ADMIN_SESSION_HOURS`), then you sign in again. A normal viewer session can never call the admin API (403).
- A disabled account is signed out everywhere immediately.
- The console page is served with `Cache-Control: no-store`, a strict Content-Security-Policy (no inline script) and `X-Frame-Options: DENY`. Serve everything over HTTPS.
- `ADMIN_TOKEN` (24+ chars) is now **optional** and only for scripts/curl (`Authorization: Bearer <token>` on `/api/v1/admin/*`). Leave it empty and scripts can't use the admin API; browsers never need it. Actions taken with it are logged as `token`.

## 2. What you can do

| Section | |
|---|---|
| **Dashboard** | revenue and sign-ups for 30 days, active subscribers, plans expiring within 7 days, open messages, recent payments/users, and a *Finish setting up* list (GSTIN, SMTP, R2 if using private media, Razorpay keys, weak secrets…). When SMTP is configured, **Send test email** sends a real diagnostic message to the signed-in administrator. |
| **Shows** | add / edit / delete / reorder; poster upload; "featured" on the home page. Deleting a show also deletes its videos (you are told how many first) |
| **Videos & reels** (also) | each video has *Publish at* (scheduled release), *Maturity rating* (U / 7+ / 13+ / 16+ / 18+ — Kids profiles show only U and 7+) and *Subtitles* (upload .srt/.vtt). Shows have a rating too. |
| **Videos & reels** | Episodes, reels, trailers and clips. Filter by show/kind/access/source/rating/duration/website status; 25 per page. **Preview YouTube channel** scans every public upload, compares it with the catalog, and lets you select missing videos or import all missing. Shorts appear in Reels and landscape uploads join the home page's Latest Episodes & Videos rail. Imports start free, unrated and show-less with unknown duration (shown as —); set show, rating, access and runtime in Edit when needed. Select videos across pages to hide, restore or delete in bulk. **Undo last import** and **Remove today's imports** delete only tracked YouTube videos (India Standard Time). Public page loads never fetch YouTube. Sources can also be added directly as YouTube URLs, MP4/HLS links or R2 objects; premium access is selected separately. |
| **Coming soon** | Edit the homepage **Releasing This Month** desktop/mobile banner artwork; add / edit / delete / reorder upcoming titles and their carousel posters. New titles are placed first; use the order controls to adjust the list. |
| **Gallery** | add / edit / delete / reorder; photo upload |
| **Studio & team** | the About, Services and Contact pages: address, phones, WhatsApp, social links, mission text, services, team members with photos |
| **Users** | search, filter (paid, expiring, expired, free, admins, disabled); rename, make/remove admin, disable/enable, delete; **give free access** (N days, no payment or invoice); end a plan |
| **Payments & refunds** | every checkout with buyer, coupon, status, invoice/credit-note PDFs; **Refund…** (full or partial, via Razorpay; credit note issued when it is processed); GST **sales register CSV** by date range |
| **Coupons** | create percent / flat codes with plan, date, per-user and total limits; turn off, edit limits, delete (used codes can only be turned off) |
| **Refund requests** | customers' self-service requests: approve (runs the Razorpay refund + credit note) or decline with a note; sidebar badge for pending ones |
| **Messages** | contact-form inbox: reply by email, mark handled, delete; unread count in the sidebar |
| **Comments** | moderation queue: comments auto-hidden after 3 reports or reported once; restore, hide, delete, search |
| **Analytics** | plays and watch time per day, top shows/videos (7/30/90 days), revenue |
| **Notifications** | send a Web Push announcement to everyone / news subscribers / followers of a show / reminder-holders of a launch |
| **Errors** | grouped browser and server errors of the last 7 days with stack traces |
| **Audit log** | who did what, when, to what (`catalog.show.update`, `payment.refund`, `user.grant`, `coupon.create`, …). Append-only from the UI |

Changes go live straight away: the public API serves the new catalog within a few seconds (several servers stay in sync through a version counter).

## 3. Where the catalog lives now

The catalog is in **MySQL** (`catalog_items`, `catalog_meta`). `data/catalog.json` and `data/studio.json` are:

- the **seed** — imported once, on the first start with an empty database;
- the **static-hosting / mobile bundle** — the site still works with no backend, and the native apps bundle these files (and refresh from the API when one is configured).

Editing the JSON files after the first start does **not** change a running site any more. Keep them in step with:

```bash
npm run catalog:export            # MySQL → data/catalog.json + data/studio.json (validated; commit them, then `npm run mobile:sync`)
npm run catalog:import -- --force # JSON → MySQL, REPLACING the database catalog (asks for --force; validates first)
npm run validate:catalog          # check the files
```

Every admin write is validated with the same rules as `validate:catalog` (unique ids, existing shows, valid video sources, safe URLs and keys, image files that exist, …). Premium access can be assigned independently of the media source; use private R2 if the media itself must be protected.

## 4. Uploads

- **Images** (posters, thumbnails, gallery, team photos): the browser shrinks them and converts to WebP when possible. `POST /api/v1/admin/uploads/image` accepts files up to 10 MB. The server checks the real file type (not the extension), names the file by its content hash and stores it in `UPLOAD_DIR` (default `./uploads`), served at `/uploads/<hash>.webp` with a one-year cache. **Mount a persistent volume there** — the Docker image declares `/app/uploads` a volume and `docker-compose.yml` creates one. Back it up with the database. Native apps rewrite `uploads/…` to the API host automatically.
- **R2 video files** go **straight from the browser to your private R2 bucket** through a short-lived presigned `PUT` (the server never handles the video). This is available for media that needs file-level protection, whether its app access is Free or Premium. It needs, once:
  1. an R2 API token with **write** access (Object Read & Write) — the read-only token recommended in `docs/PREMIUM.md` can play but not upload, so the server needs the write-capable one for uploads to work.;
  2. a **CORS rule on the bucket** allowing `PUT` from your site's origin, header `Content-Type`:
     ```json
     [{ "AllowedOrigins": ["https://your-site"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
     ```
  Uploads over a few GB are better done with `rclone`/the R2 dashboard; type the key into the form afterwards.

## 5. Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_SESSION_HOURS` | `12` | how long after sign-in the console keeps working |
| `UPLOAD_DIR` | `./uploads` | where admin image uploads are stored |
| `YOUTUBE_CHANNEL_ID` | `UCdG8idFz3zA7xOaca8H6qtw` | channel whose uploads are scanned only after an administrator clicks **Preview YouTube channel** |
| `YOUTUBE_API_KEY` | *(empty)* | required for the complete uploads-playlist scan; keep the key on the server and restrict it to YouTube Data API v3 |
| `ADMIN_TOKEN` | *(empty)* | optional script token, 24+ characters |

## 6. Admin API

Everything the console does is under `/api/v1/admin/*` (see `docs/openapi.yaml`), authenticated with the admin's normal bearer token, so you can script it. Errors use the usual `{ error: { code, message } }` shape; `401 admin_session_expired` means sign in again.

`POST /api/v1/admin/catalog/youtube/preview` is the only operation that contacts YouTube. With `YOUTUBE_API_KEY` configured, it paginates the channel's complete public uploads playlist, compares every video ID with the database, and returns a paginated admin preview of missing and already-present videos. The signed, 15-minute preview snapshot is stored in MySQL so imports do not fetch YouTube again and work across app instances. Select individual missing uploads or import all missing; imports are chunked and grouped as one undoable batch, and each new item starts free, unrated, and with unknown duration. Set `YOUTUBE_CHANNEL_ID` to override the built-in `@ADDABAAZ01` channel. Create a key in Google Cloud Console, enable YouTube Data API v3, restrict the key to that API, and set it only in the server environment; without it, preview returns a clear configuration error rather than silently showing only the newest 15 feed entries.

The Videos & reels list has filters for show, kind, access, source, maturity rating, duration status, and website visibility/scheduled status. Select rows across pages (up to 500 at a time) to hide, restore, or delete them in bulk. Hidden videos remain in the admin catalog but are omitted from public catalog reads, the website, and search indexing; restoring makes them public again. Bulk delete also removes viewer list/progress references, but R2 objects must be deleted from storage separately. `GET /api/v1/admin/catalog/youtube/imports` reports the last batch and today's active imports; `POST /api/v1/admin/catalog/youtube/remove-imports` with `{ "scope": "last" | "today" }` removes those tracked imports. Public page loads never trigger a YouTube request.

## Not included (yet)

- Plan **prices/durations** are code (`server/src/plans.js`), not editable in the console — they appear on invoices, so change them deliberately.
- No role granularity: every admin can do everything (the audit log tells you who did what).
- No two-factor sign-in; use a strong password and HTTPS.
- Refund buttons only work for real Razorpay payments (demo checkouts have nothing to refund).
