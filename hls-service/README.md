# ADDABAAZ HLS Converter

A **standalone microservice** that turns any video you upload into a **multi-resolution HLS package** and
puts it straight into your **Cloudflare R2** bucket, ready for the website to stream.

It is deliberately separate from the main app: its own folder, its own server, its own port, its own
`CONVERTER_TOKEN`. The main site never has to know it exists — but when a package is in R2, the key it
prints is exactly what the Content studio's *Private Cloudflare R2* source field wants
(`premium/<slug>/master.m3u8`), so premium playback works with zero changes on the site.

```
  your video ──▶ portal (upload / R2 key / URL) ──▶ ffmpeg ──▶ HLS ladder ──▶  R2 bucket
   mp4 mov mkv avi webm ts flv wmv 3gp mpeg mxf …   1080p/720p/540p/480p/360p/240p   premium/<slug>/
```

| | |
|---|---|
| **Inputs** | Any file you drop in the browser, an object already in R2, or a direct video URL. Containers ffmpeg can read: mp4, m4v, mov, mkv, avi, webm, flv, f4v, wmv/asf, ts/mts/m2ts, mpg/mpeg, 3gp, ogv, vob, rmvb, mxf, divx, dv … |
| **Outputs** | Adaptive HLS (VOD): `master.m3u8`, one playlist + segments per quality, aligned keyframes, MPEG-TS or fMP4/CMAF |
| **Resolutions** | 1080p → 240p (Apple's bitrate ladder), never upscaled, portrait/reels measured by their short edge; presets: auto, up to 1080p, up to 720p, mobile, fast draft, single-quality |
| **Where it runs** | Your laptop, a VPS, Docker, or Render — ffmpeg is bundled in the image, nothing else to install |
| **Uploads** | Streamed to the bucket with retries, parallel PUTs, segments first and `master.m3u8` **last**, then verified by reading the playlists back |
| **Portal** | Live per-quality progress bars, speed/ETA/segment counts, log tail, cancel/retry, download the package as a ZIP, “Test R2” button, optional one-click publish into the site's catalog |
| **Dependencies** | `express` — that is the entire dependency list |

---

## 1 · Quick start

```bash
cd hls-service
npm install

cp .env.example .env               # then edit: CONVERTER_TOKEN + R2_*
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # a token

npm run doctor                     # checks ffmpeg, disk, settings and the bucket itself
npm start                          # → http://localhost:8080
```

Open the portal, paste the token once, drop a video in, press **Start conversion**. When the job turns
green the page shows the exact object key to paste into the site (and a **Copy key** button).

**Docker** (ffmpeg included — nothing to install on the host):

```bash
cp .env.example .env && docker compose up --build      # → http://localhost:8080
```

**No ffmpeg on this machine?** `npm run get:ffmpeg` downloads a static build into `./.tools/` (Linux +
macOS) and the service picks it up automatically; on Windows use `winget install Gyan.FFmpeg`. The
Docker image already contains ffmpeg.

**No bucket yet?** Leave `R2_*` empty: the service still encodes, keeps the package on disk and offers it
as a ZIP download. To try the complete flow offline, run the in-memory fake bucket:

```bash
node scripts/dev-bucket.mjs 9100      # terminal 1 — a throw-away S3/R2 stand-in
R2_ACCOUNT_ID=dev R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev \
R2_BUCKET=addabaaz-dev R2_ENDPOINT=http://127.0.0.1:9100 npm start     # terminal 2
```

---

## 2 · Configuration

Everything is environment variables — the service does **not** read `.env` by itself. Use
`node --env-file=.env src/index.js` (Node 20.6+), `docker compose`, or your host's env settings.

| Variable | Default | What it does |
|---|---|---|
| `CONVERTER_TOKEN` | — (**required**, ≥24 chars) | The shared secret for the portal and the API. Generate one; treat it like a password. |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Where the portal listens. |
| `DATA_DIR` | `./data` | Staged uploads, encoded packages, `jobs.json`. Needs room for ~2–3× the largest video. |
| `CONCURRENCY` | `1` | Jobs at once. One job already uses every core; raise only on a big machine. |
| `FFMPEG_THREADS` | `0` (all cores) | Threads per encode. |
| `MAX_UPLOAD_GB` | `16` | Refuse anything bigger (protects the disk). Minimum `0.001`. |
| `LOCAL_RETENTION_HOURS` | `48` | How long finished packages (and their ZIPs) stay on disk before the hourly sweep removes them. |
| `DELETE_LOCAL_AFTER_UPLOAD` | `0` | `1` = free the disk as soon as the upload is verified. |
| `STALL_SECONDS` | `300` | Stop an encode that reports no progress for this long. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` on `PATH`, else `./.tools` | Which binaries to run. |
| `DEFAULT_PRESET` | `auto` | Preset the portal starts on: `auto`, `full`, `hd`, `mobile`, `fast`, `source`. |
| `MAX_SHORT_SIDE` | `1080` | Highest rung ever produced (a 4K master is capped here). |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | — | Where packages are uploaded. Same names as the main app — but this token needs **Object Read & Write**, not the read-only token the website uses. |
| `R2_ENDPOINT` | `<account>.r2.cloudflarestorage.com` | Any S3-compatible store. |
| `R2_PREFIX` | `premium` | Packages go to `<prefix>/<slug>/`. Keep `premium` for the site's private videos. |
| `R2_PUBLIC_BASE_URL` | — | Optional custom domain, only used to show a playable link. |
| `APP_API_URL`, `APP_ADMIN_TOKEN` | — | Optional bridge to the main app's admin API: lets the portal list catalog videos and publish a finished package into one. |
| `CORS_ORIGINS` | *(none)* | Only needed if another site's page (e.g. your Admin console) should call this API from a browser. |
| `TRUST_PROXY` | `0` | `1` behind a reverse proxy / platform load balancer. |
| `HSTS` | `0` | `1` to send `Strict-Transport-Security` (only when you serve HTTPS directly). |

### Cloudflare R2 setup (once)

1. *R2 → Manage API tokens → Create API token*: **Object Read & Write**, scoped to your bucket.
2. Copy the access key id + secret into `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, the account id into
   `R2_ACCOUNT_ID`, and the bucket name into `R2_BUCKET`.
3. Press **Test R2** in the portal (or `npm run doctor`) — it uploads a probe file, reads it back and
   deletes it, so a permission problem is found before an hour-long encode.
4. Bucket **CORS** is only needed for *playback* in the browser (HLS segments fetched cross-origin) —
   that is the main app's setting, see `docs/PREMIUM.md` in the repository root.

---

## 3 · Using the portal

1. **Source** — *Upload a file* (drag & drop, streamed to the service, no size limit beyond
   `MAX_UPLOAD_GB`), *From R2* (paste an object key; the service downloads it itself), or *From a URL*.
2. **Output** — folder name (`slug`), R2 prefix, quality ladder, segment length, packaging, encoding effort.
3. **Start conversion** — the job appears under *Jobs* with a bar per quality, live speed, ETA and segment
   counts. The detail drawer adds the probe result, the full ladder, the log tail and the result.
4. When it finishes: **Copy key**, or **Download ZIP**, or (if `APP_API_URL` is set) **Publish** the package
   into an existing catalog video.

Actions on any job: **Cancel** (works during download, probing and encoding), **Retry** (same settings,
re-uses the staged source), **Delete** (removes local files; it never deletes anything from R2).

### From the command line

The whole API is usable with curl — handy for scripting a batch of episodes:

```bash
TOKEN=…            # CONVERTER_TOKEN
# raw upload → one call
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: video/mp4" \
     --data-binary @episode6.mkv \
     "http://localhost:8080/api/v1/jobs/raw?name=episode6.mkv&slug=shahid-ep6&preset=auto&segmentSec=6"

# or: a file already in the bucket
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"source":{"r2Key":"raw/episode6.mkv"},"options":{"slug":"shahid-ep6","preset":"hd"}}' \
     http://localhost:8080/api/v1/jobs

curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/jobs          # list
curl -N -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/jobs/<id>/stream   # live progress
```

| Method & path | Purpose |
|---|---|
| `GET /health` | Public: ffmpeg, R2, queue, free disk. What a platform health check should poll. |
| `GET /api/v1/config` | Presets, limits, R2 target and the optional catalog bridge (drives the portal). |
| `POST /api/v1/uploads` → `PUT /api/v1/uploads/:id?name=…` | Stage a file (raw body, streamed to disk). |
| `POST /api/v1/jobs` · `POST /api/v1/jobs/raw` | Create a job from a staged upload / R2 key / URL, or straight from a body. |
| `GET /api/v1/jobs` · `GET /api/v1/jobs/:id` | List (newest first, `?status=`) / read one. |
| `GET /api/v1/jobs/:id/stream` | Live NDJSON snapshots until the job finishes. |
| `POST /api/v1/jobs/:id/cancel` · `/retry` · `DELETE /api/v1/jobs/:id` | Stop, re-run, forget (+ local files). |
| `GET /api/v1/jobs/:id/download` | The finished package as a ZIP. |
| `GET /api/v1/r2/check` | Reads/writes/deletes a probe object: proves the bucket credentials. |
| `GET /api/v1/system` · `POST /api/v1/maintenance/sweep` | Disk usage, queue state; run the retention sweep now. |
| `GET /api/v1/site/videos` · `POST /api/v1/jobs/:id/publish` | Optional: catalog videos from the main app, publish this package into one. |

Every `/api/v1` route needs `Authorization: Bearer $CONVERTER_TOKEN` (or `x-api-token`). Authentication is
enforced on the router, so a new endpoint cannot be added unauthenticated by accident.

---

## 4 · What it writes to R2

```
premium/shahid-ep6/
├── master.m3u8            ← the key you give the website (uploaded LAST, so a player never
│                             sees a playlist pointing at files that are not there yet)
├── 720p/index.m3u8  seg_000.ts seg_001.ts …
├── 540p/index.m3u8  seg_000.ts …
├── 480p/index.m3u8  …
├── 360p/index.m3u8  …
└── 240p/index.m3u8  …
```

Content types are set per file (`application/vnd.apple.mpegurl`, `video/mp2t`, `video/iso.segment`,
`video/mp4` for fMP4 init segments) and the upload is verified afterwards: the master playlist is read
back from the bucket and every playlist it references is checked.

**Playing it on the site** — Content studio → *Videos & reels* → the video → **Video source: Private
Cloudflare R2**, key `premium/shahid-ep6/master.m3u8`. The app's existing `/api/v1/media/...` gateway
serves the playlists and hands out short-lived signed segment URLs, so the bucket stays private and
premium gating works exactly as it does for MP4 sources. Nothing on the site needs to change.

> The folder layout is flat on purpose: every file of a package lives under `<prefix>/<slug>/`, which is
> the rule the site's HLS gateway enforces when it serves playlists and segments.

---

## 5 · Where to run it (and what it costs)

Encoding is CPU work; the service is honest about it:

| Where | Good for | Notes |
|---|---|---|
| **Your own machine** (`npm start`, `docker compose up`) | Day-to-day publishing | Free, full speed, ffmpeg runs on your CPU/GPU-less cores; uploads to R2 use your bandwidth once. |
| **A small VPS** (Docker + a volume) | Unattended batches | 2–4 vCPU handles a 1080p ladder at roughly 0.3–1× realtime. |
| **Render / Fly / Railway** (Docker) | Trying it, short clips | Free/starter instances are small: a long episode can hit the memory cap or take hours. `render.yaml` mounts a disk for `DATA_DIR`. |
| **Serverless** | ✗ | Time limits and no persistent disk make a bad fit for long encodes. |

Rules of thumb: disk needs about **2–3× the source size** per running job (the source + every rung +
headroom); a 45-minute 1080p episode is roughly 25–40 minutes of encode time at the default *medium*
effort on 4 cores; `fast` roughly halves that with ~10 % larger files. The service checks free disk
before it starts and refuses a job that cannot fit.

---

## 6 · Security notes

* One shared secret (`CONVERTER_TOKEN`) — ≥24 characters, compared in constant time, stored in the
  browser's `localStorage`, never in a URL. Put the service behind HTTPS (a reverse proxy, Render,
  Cloudflare Tunnel…) before exposing it beyond `localhost`.
* Uploads are streamed to disk, size-capped, extension/MIME-checked (`.exe`, `.html`, `.svg`, archives,
  images and audio are refused even with a `video/*` MIME type), and file names are stripped to a safe
  base name — no path traversal can reach an object key.
* ffmpeg is never given user-controlled flags: the ladder, segment length, presets and profiles are
  chosen from fixed lists.
* The R2 token is write-capable by necessity; keep it scoped to this bucket only. The service **never
  deletes objects from the bucket** — not on job delete, not on retry, not on cleanup.
* The portal sets a strict CSP (`script-src 'self'`, no framing, no forms) and no-store caching; CORS is
  closed unless you list origins in `CORS_ORIGINS`.

---

## 7 · Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ffmpeg was not found` | Install ffmpeg, set `FFMPEG_PATH`, or `npm run get:ffmpeg` (Docker already has it). |
| **Test R2** fails with 403 | The token needs **Object Read & Write** on that bucket, and `R2_BUCKET` must match. |
| Job fails at `fetching` for an R2 source | The key is wrong (the portal lists nothing — paste it from the bucket) or the token cannot read it. |
| Job fails with `bad_input` hint | The file is not a complete video. Re-export it, or remux first: `ffmpeg -i in.mkv -c copy out.mp4`. |
| Encode is very slow | Use *Fast draft* or **Encoding effort → Fast/Very fast**; keep the ladder shorter (`hd`). |
| `Not enough free disk space` | Raise the volume, lower `LOCAL_RETENTION_HOURS`, delete finished jobs, or set `DELETE_LOCAL_AFTER_UPLOAD=1`. |
| Uploads time out behind a proxy | Raise the proxy's body/time limits (`client_max_body_size` in nginx, or use the R2/URL source instead of browser upload). |
| Portal says “That token was rejected (401)” | `CONVERTER_TOKEN` changed on the server; paste the new one (Settings → Connect). |
| Jobs vanish after a restart | Job *history* lives in `DATA_DIR/jobs.json` — mount `DATA_DIR` on a volume/disk. |

---

## 8 · Development

```bash
npm test           # everything: 58 tests, no network, no real bucket, ~9 s
npm run test:unit  # ladder, ffmpeg args, probe/progress parsing, SigV4, ZIP, store, HTTP edge cases
npm run test:api   # the service over HTTP with a fake encoder, the portal in a real DOM, the fake bucket
npm run test:e2e   # a REAL ffmpeg encode of a generated clip, uploaded to the fake bucket (skipped without ffmpeg)
npm run doctor     # environment + bucket check
npm run dev        # node --watch
```

The tests include an in-process **S3 server that verifies every SigV4 signature** (`test/helpers/fake-s3.mjs`),
so the upload path is exercised for real — a passing suite means real R2 requests will authenticate.
`test/helpers/fake-ffmpeg.mjs` produces real files and real `-progress` output, so the queue, progress
parsing, cancel/retry and verification are tested without waiting for an encoder.

```
hls-service/
├── src/
│   ├── index.js       entry point: startup banner, boot checks, sweeper, graceful shutdown
│   ├── server.js      Express app: portal + JSON API (streaming uploads, NDJSON progress, ZIP download)
│   ├── queue.js       the job pipeline (fetch → probe → encode → package → upload → verify) + sweeper
│   ├── transcode.js   ffmpeg/ffprobe processes, progress blocks, package inspection
│   ├── ffmpeg.js      pure logic: ladder, presets, command line, probe/progress parsing (unit-tested)
│   ├── r2.js          Cloudflare R2 client (SigV4 presigning, streaming PUT/GET, list, self-check)
│   ├── uploader.js    package upload order, parallel PUTs, verification
│   ├── store.js       job records, debounced durable history, restart recovery
│   ├── zip.js         dependency-free ZIP writer for the package download
│   ├── site.js        optional bridge to the main app's admin API (list videos, publish a package)
│   ├── auth.js        token check (constant time)
│   ├── config.js      all settings in one place
│   └── http.js        typed errors, async wrapper, rate limiting
├── public/            the portal (vanilla ES modules — no build step, like the main site)
├── scripts/           doctor.mjs · get-ffmpeg.mjs · dev-bucket.mjs
└── test/              unit + API + portal + real-ffmpeg end-to-end tests, with an in-process S3 mock
```

---

## 9 · Deliberate limits (and the road from here)

Kept simple on purpose, so you can read the whole thing in an afternoon:

* **One node, in-process queue.** Job state lives in `DATA_DIR/jobs.json`; scaling out would mean moving
  the queue to Redis/BullMQ and workers to separate containers — a drop-in change for the `queue.js` seam.
* **No HLS encryption** (AES-128 keys) yet. Access control is the site's signed-URL gateway, which is
  what the rest of the app already uses for premium video.
* **No trick-play packs** (separate I-frame-only playlists for scrubbing), no dolby/multi-audio tracks,
  no subtitle burn-in — the site takes WebVTT subtitles as separate uploads.
* **No thumbnail/storyboard generation** yet (a natural next step: a poster JPEG per rung alongside the
  package, plus `#EXT-X-IMAGE-STREAM-INF`).

Anything else — extra ladders, per-show defaults, a webhook that tells the main app a package is ready —
is a small, local change: the pieces above are separated exactly so that a new stage can be added to the
queue without touching the API or the portal.
