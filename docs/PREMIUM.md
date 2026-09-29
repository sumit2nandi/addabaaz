# Premium video on Cloudflare R2

Free titles stay on YouTube. **Premium titles live as files in a private Cloudflare R2 bucket** and are only playable by signed-in viewers: the bucket is never public, the catalog contains only object *keys*, and the API hands a signed, expiring URL to whoever it lets in.

```
Viewer opens a premium title
  └─ not signed in? → "Sign in to watch"           (UI)
  └─ signed in, no active plan? → Plans → pay        (UI, see "Payments")
  └─ POST /api/v1/videos/:id/stream  (Bearer)
        ├─ 401 login_required (not signed in) / 402 subscription_required (signed in, no active paid plan)
        └─ 200 { type: 'mp4' | 'hls', url, expiresAt }
              mp4 → presigned R2 URL (Range requests / seeking work)
              hls → /api/v1/media/<token>/master.m3u8  (playlists via API, segments 302 → presigned R2)
  └─ <video> / hls.js plays it; progress & resume work like any other title
```

## 1. Create the bucket and credentials

1. Cloudflare dashboard → **R2 Object Storage → Create bucket** (e.g. `addabaaz-premium`). Leave **public access OFF** (no r2.dev URL, no custom domain).
2. *R2 → Manage API tokens → Create API token*: permission **Object Read only**, scoped to that bucket. Copy the Access Key ID and Secret. (The server only ever reads. Upload with a separate, write-capable credential.)
3. Note your **Account ID** (R2 overview page).
4. Server environment: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (see `.env.example`).
5. Bucket **CORS** (only needed for HLS, where the player fetches segments cross-origin). *Bucket → Settings → CORS policy*:
   ```json
   [{ "AllowedOrigins": ["https://addabaaz.in", "https://app.addabaaz.in", "http://localhost:3000"],
      "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["Range"], "ExposeHeaders": ["Content-Length", "Content-Range"], "MaxAgeSeconds": 3600 }]
   ```
   (`app.addabaaz.in` is the Capacitor WebView origin — keep it in sync with `mobile/capacitor.config.json`.)

## 2. Prepare and upload a video

**MP4 (simplest):** H.264 + AAC with the index at the front so it can start before it fully downloads:

```bash
ffmpeg -i episode.mov -c:v libx264 -crf 21 -preset slow -c:a aac -b:a 128k -movflags +faststart ep6.mp4
```

**HLS (adaptive bitrate — better for mobile networks):**

```bash
ffmpeg -i episode.mov -filter_complex "[0:v]split=2[a][b];[a]scale=-2:720[v720];[b]scale=-2:480[v480]" \
  -map "[v720]" -map 0:a -map "[v480]" -map 0:a -c:v libx264 -crf 22 -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_filename "ep6/%v/seg_%03d.ts" \
  -master_pl_name master.m3u8 -var_stream_map "v:0,a:0,name:720p v:1,a:1,name:480p" "ep6/%v/index.m3u8"
```

Upload (any S3 tool with a *write* token — examples):

```bash
wrangler r2 object put addabaaz-premium/premium/shahid-ep6/ep6.mp4 --file ep6.mp4 --content-type video/mp4
rclone copy ep6/ r2:addabaaz-premium/premium/shahid-ep6/        # HLS folder (configure an rclone "s3" remote with provider Cloudflare)
```

Check that the server's credentials can read it:

```bash
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=addabaaz-premium npm run r2:check -- premium/shahid-ep6/ep6.mp4
```

## 3. Publish it in the catalog

Add (or change) a video in `data/catalog.json`; `access: "premium"` is what requires the login:

```json
{
  "id": "shahid-ep6-premium",
  "showId": "shahid", "kind": "episode", "episode": 6,
  "title": "শহীদ | EP 06 | …",
  "source": { "type": "r2", "key": "premium/shahid-ep6/ep6.mp4" },
  "thumbnail": "media/premium/shahid-ep6.webp",
  "duration": 1310, "publishedAt": "2026-10-11T13:30:00Z", "views": 0,
  "access": "premium"
}
```

- `source.format` is inferred (`.m3u8` ⇒ `hls`, otherwise `mp4`); for HLS the `key` is the **master playlist**, and every other file must sit in the same folder (or below it).
- `thumbnail` must be a public image (put it in `media/…`); R2 videos have no YouTube thumbnail. `npm run validate:catalog` checks all of this.
- An R2 video may also be `"access": "free"`: it's then playable without login (still delivered through signed URLs) — handy for hosting free titles yourself.

## Access rules

| Situation | Result |
|---|---|
| Free title (YouTube or R2) | Plays for everyone |
| Premium, signed out | `401 login_required` → "Sign in to watch" |
| Premium, signed in (email, Google or Facebook), no plan or plan expired | `402 subscription_required` → "ADDABAAZ Plus exclusive" → Plans page (`#/plans?next=/watch/<id>`) |
| Premium, signed in **and** an active paid plan | Plays |
| `R2_*` not configured | `503 storage_not_configured` |
| Static-only hosting (no API) | "Premium video needs an account" message |

## Payments (Razorpay)

Premium plays only for **a signed-in viewer with an active paid plan** — always, there is no switch to turn that off. Plans are **prepaid passes** (₹99 → 30 days, ₹799 → 365 days, edit `server/src/plans.js`): no auto-renewal, nothing to cancel; buying again *adds* time to the end of the current pass. When `expires_at` passes, access locks again automatically (no cron needed).

```
Plans page → POST /payments/checkout {planId}        API creates a Razorpay order + a `payments` row (status created)
          → Razorpay Checkout (UPI / cards / netbanking / wallets; card data never touches our servers)
          → POST /payments/verify {orderId, paymentId, signature}
                 API checks HMAC_SHA256(orderId|paymentId, KEY_SECRET) and that the order is the caller's → plan activated (once)
Razorpay  → POST /payments/webhook  (payment.captured)   same activation if the buyer closed the tab; signed with the webhook secret,
                                                          amount must match the order; replays are harmless (unique payment id)
```

Set up:
1. Razorpay dashboard → Settings → **API Keys** → generate keys (use `rzp_test_…` first). Put `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in the server environment (`.env.example`). The secret never leaves the server; only the key id is sent to the browser.
2. Dashboard → Settings → **Webhooks** → URL `https://<your-api>/api/v1/payments/webhook`, a secret of your choice (= `RAZORPAY_WEBHOOK_SECRET`), event **`payment.captured`**.
3. Test with Razorpay's test cards/UPI before switching to live keys (KYC required for live).

Without keys, **development** uses a labelled *demo checkout* (activates instantly, no money); in **production** there is no checkout at all (`501 payments_not_configured`) unless you deliberately set `ALLOW_MOCK_PAYMENTS=true` (staging only — it lets anyone grant themselves a plan).

Not included (decide with your accountant before launch): **GST invoices/receipts**, refunds (do them in the Razorpay dashboard, then shorten the user's `subscriptions.expires_at` by hand), failed-payment emails, coupon codes. In the store apps plans aren't sold (see `docs/MOBILE.md`). The Razorpay flow was verified in tests against a faked Razorpay API and a scripted browser checkout — run one real test-mode payment before going live.

## Security notes — read these

- **Signed URLs are bearer links.** Anyone holding one can play that file until it expires (`STREAM_URL_TTL`, default 6 h — long enough for a film plus pausing; shorten it if you like, it's requested again on every page load). This stops casual sharing and hotlinking, and hides the bucket, but it is **not DRM**: a determined signed-in viewer can still record or download what they can watch. If you need studio-grade protection, put the bucket behind Cloudflare Stream/DRM (Widevine/FairPlay) later — the `POST /videos/:id/stream` contract stays the same.
- HLS gateway tokens are scoped (`aud: media`, one video, same TTL) and can't be used as login sessions (and vice-versa). Playlist paths are confined to the video's own folder (path traversal is rejected; covered by tests).
- Keep the R2 credential **read-only** and out of the browser/app — it exists only in the server environment.
- The catalog (and therefore the object *keys*) is public; that's harmless with a private bucket, but don't put secrets in key names.
- With `NODE_ENV=production` set `PUBLIC_API_URL` (e.g. `https://api.addabaaz.in`) if the API sits behind a proxy that doesn't forward the original host/proto correctly (also set `TRUST_PROXY`).
