/**
 * The HTTP surface: the portal (static files) and the JSON API under /api/v1.
 *
 * Everything the service can do is reachable from a terminal:
 *
 *   curl -T episode.mkv -H "Authorization: Bearer $TOKEN" \
 *        "http://localhost:8080/api/v1/jobs/raw?name=episode.mkv&slug=shahid-ep6&preset=auto"
 *
 * Route map
 *   GET    /health                        (public)  ffmpeg, R2, queue — what is missing, if anything
 *   GET    /api/v1/config                            portal bootstrap (presets, limits, R2 target)
 *   POST   /api/v1/uploads                           open a staging slot for a browser upload
 *   PUT    /api/v1/uploads/:id?name=…                 stream the video file into it
 *   POST   /api/v1/jobs                              create a job (uploadId | r2Key | url + options)
 *   POST   /api/v1/jobs/raw?name=…                    create a job straight from a raw body (curl)
 *   GET    /api/v1/jobs · /api/v1/jobs/:id            list / read jobs
 *   GET    /api/v1/jobs/:id/stream                    live NDJSON progress for the portal
 *   POST   /api/v1/jobs/:id/cancel · /retry           stop or re-run
 *   DELETE /api/v1/jobs/:id                           forget a job (+ its local files, never R2)
 *   GET    /api/v1/jobs/:id/download                  the package as a ZIP
 *   GET    /api/v1/r2/check                           prove the bucket credentials work
 *   GET    /api/v1/site/videos · POST /api/v1/jobs/:id/publish   optional catalog bridge
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, bad, wrap, errorHandler, rateLimit, notFound } from './http.js';
import { requireToken } from './auth.js';
import { PRESETS, presetNames, pickLadder } from './ffmpeg.js';
import { newJob, brief } from './store.js';
import { dirSize } from './queue.js';
import { writeZip } from './zip.js';

// Accepted video containers — anything a modern ffmpeg can demux (the browser upload picker shows the
// same list). Kept deliberately broad: “any other possible video” was the requirement.
export const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', 'avi', 'divx', 'wmv', 'asf', 'flv', 'f4v', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg', 'mpe', 'mpv', 'vob', '3gp', '3g2', 'ogv', 'ogg', 'rm', 'rmvb', 'mxf', 'hevc', 'h264', 'dv', 'y4m', 'amv', 'dav', 'gxf', 'wtv', 'rec', 'mod', 'tod', 'trp', 'm2v', 'm1v']);
const NON_VIDEO = new Set(['exe', 'msi', 'bat', 'cmd', 'sh', 'ps1', 'vbs', 'html', 'htm', 'xhtml', 'svg', 'xml', 'js', 'mjs', 'cjs', 'css', 'json', 'wasm', 'php', 'jsp', 'py', 'rb', 'pl', 'jar', 'class', 'dll', 'so', 'dylib', 'apk', 'ipa', 'deb', 'rpm', 'dmg', 'iso', 'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'md', 'csv', 'sql', 'env', 'pem', 'key', 'p12', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'mp3', 'wav', 'flac', 'aac', 'm4a']);

/** File name safe for the disk and for an object key: no paths, no surprises, still recognisable. */
export function safeName(input, fallback = 'video.mp4') {
  // Windows and POSIX separators both end at a file name; everything else is a name, never a path.
  const base = String(input || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).replace(/[^\w.]/g, '').slice(0, 12) : '';
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .replace(/[^\w\- ]+/g, '-')                          // punctuation becomes a dash…
    .replace(/\s+/g, '-')                                 // …spaces too…
    .replace(/-{2,}/g, '-')                                // …and runs collapse
    .replace(/^[.\-_]+|[.\-_]+$/g, '');                  // no leading/trailing dots or dashes
  if (!stem && !ext) return fallback;                                    // nothing usable was supplied
  return ((stem || 'video') + ext).slice(0, 120);
}

const extOf = (name) => (/\.([A-Za-z0-9]{1,10})$/.exec(String(name)) || [, ''])[1].toLowerCase();

/** Accepts a file when its extension or its declared MIME type says “video”, and never for script-ish types. */
export function looksLikeVideo(name, contentType = '') {
  const ext = extOf(name);
  if (ext && NON_VIDEO.has(ext)) return false;
  if (ext && VIDEO_EXT.has(ext)) return true;
  return /^video\/[a-z0-9.+-]+/i.test(String(contentType).split(';')[0].trim());
}

/** Slug for the R2 folder: lowercase a-z, 0-9 and dashes. */
export const slugify = (s) => String(s || '').toLowerCase().replace(/\.[a-z0-9]{1,10}$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
/** A folder prefix inside the bucket: no leading slash, no traversal, no double slashes. */
export const safePrefix = (s, dflt = 'premium') => {
  const cleaned = String(s ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter((p) => p && p !== '.' && p !== '..').map((p) => p.replace(/[^\w.\- ]+/g, '_')).join('/');
  return cleaned || dflt;
};

/** Streams a request body to a file, enforcing the size cap. Resolves with the number of bytes. */
export function streamToFile(readable, dest, maxBytes) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const out = fs.createWriteStream(dest);
    let bytes = 0, settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      // Stop writing, but keep reading for a moment: destroying the request outright would reset the
      // connection and the client would see “fetch failed” instead of the actual 413 message.
      readable.unpipe?.(out);
      readable.resume?.();
      out.destroy?.();
      fs.rm(dest, { force: true }, () => {
        reject(err);
        // A client that keeps sending after we answered is cut loose — the response is already on the wire.
        setTimeout(() => readable.destroy?.(), 1500).unref?.();
      });
    };
    readable.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail(new HttpError(413, 'too_large', `That file is larger than the limit of ${(maxBytes / 1024 ** 3).toFixed(1)} GB (MAX_UPLOAD_GB).`));
    });
    readable.on('error', (e) => fail(new HttpError(400, 'upload_failed', `The upload was interrupted: ${e.message}`)));
    out.on('error', (e) => fail(new HttpError(500, 'disk_error', `Could not write the upload to disk: ${e.message}`)));
    out.on('finish', () => { if (!settled) { settled = true; resolve(bytes); } });
    readable.pipe(out);
  });
}

/** Validates and normalises the job options sent by the portal or by curl. */
export function normalizeOptions(input = {}, { name = 'video.mp4', cfg } = {}) {
  const preset = presetNames().includes(input.preset) ? input.preset : cfg.defaultPreset;
  const segmentSec = Math.min(30, Math.max(1, Number(input.segmentSec) || 6));
  const packaging = input.packaging === 'fmp4' ? 'fmp4' : 'ts';
  const x264Preset = /^(ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow)$/.test(input.x264Preset) ? input.x264Preset : 'medium';
  const profile = /^(baseline|main|high)$/.test(input.profile) ? input.profile : 'main';
  const slug = slugify(input.slug || name);
  const prefix = safePrefix(input.r2Prefix ?? `${cfg.r2.prefix}`, cfg.r2.prefix);
  const flag = (v, dflt) => (v === undefined || v === '' ? dflt : !/^(false|0|no|off)$/i.test(String(v)));
  return { slug, preset, segmentSec, packaging, x264Preset, profile, r2Prefix: prefix, upload: flag(input.upload, true), keepLocal: flag(input.keepLocal, false) };
}

export function createServer({ cfg, store, queue, transcoder, r2, site, log = () => {} }) {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);
  const api = express.Router();
  const auth = requireToken(cfg.token);
  const publicDir = path.join(cfg.root, 'public');

  // Security headers for everything (the portal is a tool, not a public site: nothing may frame it).
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
      ...(cfg.secureHsts ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    });
    next();
  });
  // Optional CORS: the portal is served by this service itself, so nothing is allowed from elsewhere
  // unless CORS_ORIGINS lists the origins (e.g. your Admin console calling this API from its own page).
  const origins = cfg.corsOrigins;
  if (origins.length) {
    app.use((req, res, next) => {
      const origin = req.get('origin') || '';
      const allowed = origins.includes('*') ? '*' : origins.find((o) => o === origin);
      if (allowed) {
        res.set({ 'Access-Control-Allow-Origin': allowed, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' });
      }
      if (req.method === 'OPTIONS') return res.status(allowed ? 204 : 403).end();
      next();
    });
  }
  // JSON bodies for the few endpoints that take them (uploads arrive as raw video/* bodies instead,
  // so nothing is ever buffered in memory).
  api.use(express.json({ limit: '256kb' }));

  /** Job payloads are JSON snapshots — never the live object (the queue keeps mutating it). */
  const snapshot = (job, { logs = false } = {}) => {
    const copy = JSON.parse(JSON.stringify(job));
    if (!logs) delete copy.logs;
    return copy;
  };
  const requireJob = (req) => {
    const job = store.get(req.params.id);
    if (!job) throw notFound('This job no longer exists.');
    return job;
  };

  /* ---------- public: health ---------- */
  let ffmpegCache = { at: 0, value: null };
  const ffmpegInfo = async () => {
    if (Date.now() - ffmpegCache.at < 60_000) return ffmpegCache.value;
    ffmpegCache = { at: Date.now(), value: await transcoder.version() };
    return ffmpegCache.value;
  };
  const health = wrap(async (_req, res) => {
    const ffmpeg = await ffmpegInfo();
    let disk = null;
    try { const s = fs.statfsSync(cfg.dataDir); disk = { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }; } catch { /* unsupported */ }
    res.json({
      ok: !!ffmpeg && !!cfg.token && cfg.token.length >= 24,
      version: cfg.version,
      uptimeSeconds: Math.round(process.uptime()),
      ffmpeg: ffmpeg ? { found: true, version: ffmpeg.version, path: cfg.ffmpeg } : { found: false, path: cfg.ffmpeg, hint: 'Install ffmpeg, set FFMPEG_PATH, or run “npm run get:ffmpeg”.' },
      ffprobe: { path: cfg.ffprobe },
      r2: r2.configured ? { configured: true, bucket: r2.bucket, prefix: cfg.r2.prefix } : { configured: false, reason: r2.reason },
      site: { configured: site.configured },
      token: cfg.token ? { configured: cfg.token.length >= 24 } : { configured: false },
      queue: queue.stats(),
      disk,
    });
  });
  app.get('/health', health);
  api.get('/health', health);                 // public, like /health (a load balancer may probe both)
  // AUTHENTICATION: from here down, every API route needs the service token. Registering it on the
  // router (rather than on each route) means a new endpoint cannot be added unauthenticated by accident
  // — an unknown /api/v1 path answers 401 without a token and 404 with one.
  api.use(auth);

  /* ---------- portal configuration ---------- */
  api.get('/config', (_req, res) => res.json({
    version: cfg.version,
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })),
    defaultPreset: cfg.defaultPreset,
    maxShortSide: cfg.maxShort,
    segmentSeconds: [2, 4, 6, 10],
    x264Presets: ['veryfast', 'fast', 'medium', 'slow'],
    profiles: ['baseline', 'main', 'high'],
    packaging: [{ id: 'ts', label: 'MPEG-TS (.ts) — plays everywhere' }, { id: 'fmp4', label: 'fMP4/CMAF (.m4s) — modern, smaller' }],
    r2: { configured: r2.configured, reason: r2.reason || null, bucket: r2.bucket || null, prefix: cfg.r2.prefix, publicBaseUrl: cfg.r2.publicBaseUrl || null },
    site: { configured: site.configured, apiUrl: site.configured ? site.apiUrl : null },
    limits: { maxUploadBytes: cfg.maxUploadBytes, concurrency: cfg.concurrency, retentionHours: cfg.retentionHours },
    videoExtensions: [...VIDEO_EXT],
  }));

  /* ---------- uploads (the browser streams the file here first) ---------- */
  const uploadLimit = rateLimit('upload', 60, 60_000);
  api.post('/uploads', uploadLimit, (_req, res) => {
    const id = `up_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    fs.mkdirSync(path.join(cfg.uploadsDir, id), { recursive: true });
    res.status(201).json({ uploadId: id, maxBytes: cfg.maxUploadBytes, putUrl: `/api/v1/uploads/${id}` });
  });
  // Raw-body PUT: `fetch(url, { method: 'PUT', body: file })` or `curl -T file`. Never buffered in memory.
  api.put('/uploads/:id', uploadLimit, wrap(async (req, res) => {
    if (!/^up_[a-z0-9_]+$/.test(req.params.id)) throw bad('Unknown upload id.');
    const dir = path.join(cfg.uploadsDir, req.params.id);
    if (!fs.existsSync(dir)) throw notFound('This upload slot has expired — start the upload again.');
    const name = safeName(req.query.name || req.get('x-file-name') || 'video.mp4');
    if (!looksLikeVideo(name, req.get('content-type'))) throw bad(`“${name}” does not look like a video file.`, 'unsupported_type');
    const dest = path.join(dir, name);
    const bytes = await streamToFile(req, dest, cfg.maxUploadBytes);
    if (bytes === 0) { fs.rmSync(dest, { force: true }); throw bad('The uploaded file was empty.'); }
    log(`[upload] ${req.params.id}/${name} (${(bytes / 1024 ** 2).toFixed(1)} MB)`);
    res.status(201).json({ uploadId: req.params.id, name, bytes });
  }));

  /* ---------- jobs ---------- */
  api.get('/jobs', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { total, jobs } = store.list({ status: typeof req.query.status === 'string' && req.query.status ? req.query.status : null, limit, offset });
    res.json({ total, jobs: jobs.map((j) => brief(j)), counts: store.counts(), queue: queue.stats() });
  });

  api.get('/jobs/:id', (req, res) => res.json({ job: snapshot(requireJob(req), { logs: true }) }));

  /** Creates a job. Body: `{ source: { uploadId } | { r2Key } | { url }, options }`. */
  const createLimit = rateLimit('create', 60, 60_000);
  const MAX_QUEUE = 100;
  const startJob = async (source, optionsInput) => {
    const stats = queue.stats();
    if (stats.queued + stats.active >= MAX_QUEUE) throw new HttpError(429, 'queue_full', `The converter already has ${stats.queued + stats.active} jobs waiting. Let it finish, or raise CONCURRENCY.`);
    let source_ = source;
    if (source.type === 'r2') {
      if (!r2.configured) throw new HttpError(503, 'r2_not_configured', 'Cloudflare R2 is not configured on this server, so a bucket object cannot be read.');
      const head = await r2.head(source.key).catch((e) => { throw new HttpError(502, 'r2_unreachable', `Could not check the object in R2: ${e.message}`); });
      if (head.status === 404) throw bad(`No object “${source.key}” in bucket “${r2.bucket}”.`, 'r2_object_missing');
      if (head.status !== 200) throw new HttpError(502, 'r2_error', `R2 answered HTTP ${head.status} for “${source.key}”.`);
      source_ = { ...source, size: head.size || null, name: source.name || source.key.split('/').pop() };
    }
    const options = normalizeOptions(optionsInput, { name: source_.name, cfg });
    const job = newJob({ source: source_, options });
    store.add(job);
    log(`[job] ${job.id} ${source_.type}=${source_.name} → ${options.r2Prefix}/${options.slug}`);
    queue.enqueue(job.id);
    return job;
  };

  api.post('/jobs', createLimit, wrap(async (req, res) => {
    const body = req.body || {};
    const src = body.source || {};
    let source;
    if (src.uploadId) {
      if (!/^up_[a-z0-9_]+$/.test(String(src.uploadId))) throw bad('Unknown uploadId.');
      const dir = path.join(cfg.uploadsDir, String(src.uploadId));
      if (!fs.existsSync(dir)) throw notFound('That staged upload is gone — upload the file again.');
      const files = fs.readdirSync(dir);
      if (!files.length) throw notFound('That staged upload has no file — upload the file again.');
      const name = safeName(src.name || files[0]);
      const file = files.includes(name) ? path.join(dir, name) : path.join(dir, files[0]);
      source = { type: 'upload', uploadId: src.uploadId, name: path.basename(file), size: fs.statSync(file).size, localPath: file };
    } else if (src.r2Key) {
      source = { type: 'r2', key: String(src.r2Key).replace(/^\/+/, ''), name: safeName(src.r2Key.split('/').pop()), size: 0 };
    } else if (src.url) {
      let parsed;
      try { parsed = new URL(String(src.url)); } catch { throw bad('source.url is not a valid URL.'); }
      if (!/^https?:$/.test(parsed.protocol)) throw bad('source.url must be http or https.');
      source = { type: 'url', url: parsed.toString(), name: safeName(src.name || path.basename(parsed.pathname) || 'download.mp4'), size: 0 };
    } else throw bad('Provide source.uploadId, source.r2Key or source.url.');
    const job = await startJob(source, body.options);
    res.status(201).json({ job: snapshot(job, { logs: true }) });
  }));

  /** One-shot: raw video body + query-string options (what curl and scripts use). */
  api.post('/jobs/raw', createLimit, wrap(async (req, res) => {
    const name = safeName(req.query.name || req.get('x-file-name') || 'video.mp4');
    if (!looksLikeVideo(name, req.get('content-type'))) throw bad(`“${name}” does not look like a video file — pass ?name=episode.mp4 or a video/* Content-Type.`, 'unsupported_type');
    const uploadId = `up_raw_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dest = path.join(cfg.uploadsDir, uploadId, name);
    const bytes = await streamToFile(req, dest, cfg.maxUploadBytes);
    if (!bytes) { fs.rmSync(path.dirname(dest), { recursive: true, force: true }); throw bad('The uploaded file was empty.'); }
    const options = { ...req.query, slug: req.query.slug || name };
    const job = await startJob({ type: 'upload', uploadId, name, size: bytes, localPath: dest }, options);
    res.status(201).json({ job: snapshot(job, { logs: true }) });
  }));

  /** Live progress for the portal: one JSON object per line, sent only when something changed. */
  api.get('/jobs/:id/stream', (req, res) => {
    const job = requireJob(req);
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    let last = '';
    const send = (payload) => { res.write(JSON.stringify(payload) + '\n'); };
    const tick = () => {
      const current = store.get(job.id);
      if (!current) { send({ type: 'gone' }); return finish(); }
      const payload = { type: 'job', job: snapshot(current, { logs: true }) };
      const line = JSON.stringify(payload);
      if (line !== last) { last = line; send(payload); }
      if (['done', 'failed', 'canceled'].includes(current.status)) return finish();
    };
    const finish = () => { clearInterval(timer); clearInterval(beat); res.end(); };
    const timer = setInterval(tick, 600);
    const beat = setInterval(() => res.write('\n'), 15_000);      // keep proxies from closing an idle socket
    req.on('close', () => { clearInterval(timer); clearInterval(beat); });
    tick();
  });

  api.post('/jobs/:id/cancel', (req, res) => {
    const job = requireJob(req);
    const ok = queue.cancel(job.id);
    res.json({ canceled: ok, job: snapshot(store.get(job.id)) });
  });
  api.post('/jobs/:id/retry', (req, res) => {
    const job = requireJob(req);
    const ok = queue.retry(job.id);
    if (!ok) throw bad('This job is still running — cancel it first.', 'not_retryable');
    res.json({ retried: true, job: snapshot(store.get(job.id), { logs: true }) });
  });
  api.delete('/jobs/:id', (req, res) => {
    const job = requireJob(req);
    if (job.status === 'running' && !req.query.force) throw bad('This job is still running — cancel it first (or pass ?force=1).', 'still_running');
    queue.remove(job.id);
    res.json({ deleted: job.id, note: 'Local files removed. Objects in R2 were left untouched.' });
  });

  /** The finished package as a ZIP (built on demand and deleted right after it is sent). */
  api.get('/jobs/:id/download', wrap(async (req, res) => {
    const job = requireJob(req);
    const dir = queue.paths.outDirOf(job.id);
    if (!fs.existsSync(path.join(dir, 'master.m3u8'))) throw notFound('No local package for this job (it may have been swept or deleted after upload).');
    const files = transcoder.listPackage(dir);
    const zipPath = path.join(queue.paths.scratchOf(job.id), `${job.options.slug}-hls.zip`);
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const { bytes } = await writeZip(zipPath, files.map((f) => ({ path: f.path, name: `${job.options.slug}/${f.name}` })));
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${job.options.slug}-hls.zip"`,
      'Content-Length': String(bytes),
      'Cache-Control': 'no-store',
    });
    res.sendFile(zipPath, (err) => { fs.rm(zipPath, { force: true }, () => {}); if (err && !res.headersSent) res.end(); });
  }));

  /* ---------- R2 + system ---------- */
  const checkLimit = rateLimit('check', 10, 60_000);
  api.get('/r2/check', checkLimit, wrap(async (_req, res) => {
    if (!r2.configured) throw new HttpError(503, 'r2_not_configured', r2.reason || 'Cloudflare R2 is not configured.');
    res.json(await r2.check());
  }));
  api.get('/system', wrap(async (_req, res) => {
    const dirSizes = {};
    for (const [name, dir] of Object.entries({ uploads: cfg.uploadsDir, work: cfg.workDir })) {
      let bytes = 0, entries = 0;
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) { entries++; bytes += dirSize(path.join(dir, e.name)); }
      } catch { /* missing */ }
      dirSizes[name] = { entries, bytes };
    }
    let disk = null;
    try { const s = fs.statfsSync(cfg.dataDir); disk = { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }; } catch { /* unsupported */ }
    res.json({ version: cfg.version, dataDir: cfg.dataDir, ffmpeg: cfg.ffmpeg, ffprobe: cfg.ffprobe, dirs: dirSizes, disk, queue: queue.stats(), node: process.version });
  }));
  api.post('/maintenance/sweep', (_req, res) => res.json(queue.sweep()));

  /* ---------- optional: publish into the ADDABAAZ catalog ---------- */
  api.get('/site/videos', wrap(async (_req, res) => {
    if (!site.configured) throw new HttpError(503, 'site_not_configured', 'APP_API_URL and APP_ADMIN_TOKEN are not set on this service.');
    res.json({ apiUrl: site.apiUrl, videos: await site.videos() });
  }));
  api.post('/jobs/:id/publish', wrap(async (req, res) => {
    const job = requireJob(req);
    if (job.status !== 'done' || !job.output?.masterKey) throw bad('This job has not uploaded a package yet.', 'not_ready');
    const out = await site.publish({ videoId: req.body?.videoId, masterKey: job.output.masterKey });
    store.update(job.id, { published: { videoId: out.videoId, title: out.title, at: new Date().toISOString() } });
    store.logJob(job.id, `published to catalog video “${out.videoId}” (${out.title})`);
    res.json({ published: out, job: snapshot(store.get(job.id), { logs: true }) });
  }));

  /* ---------- the portal ---------- */
  api.use((_req, _res, next) => next(notFound('Unknown endpoint.')));       // JSON 404 for anything under /api/v1
  app.use('/api/v1', api);
  app.use(express.static(publicDir, { index: 'index.html', extensions: ['html'], maxAge: 0, etag: true }));
  app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.use((req, res, next) => (req.path.startsWith('/api/') ? next(notFound('Unknown endpoint.')) : res.status(404).type('text/plain').send('Not found')));
  app.use(errorHandler);
  app.locals.cfg = cfg;
  return app;
}

