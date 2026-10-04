/**
 * The job queue: takes a staged source file, produces an HLS package and uploads it to R2.
 *
 * One job at a time by default (each encode already uses every core), with a small worker pool when
 * CONCURRENCY is raised. The state machine, in order:
 *
 *   queued → fetching → probing → encoding → packaging → uploading → verifying → done
 *                                └──────────── canceled / failed ─────────────┘
 *
 * Every stage writes to the job record, which is what the portal streams; the queue itself never
 * touches HTTP. Failures carry a `hint` written for the operator ("Is ffmpeg installed?", "that token
 * needs write access"), because that is the difference between a five-minute fix and an afternoon.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { pickLadder } from './ffmpeg.js';
import { uploadPackage, folderOf } from './uploader.js';

const GB = 1024 ** 3;
const human = (bytes) => (bytes >= GB ? `${(bytes / GB).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Classifies an encoder/report failure into a code plus an operator-facing hint. */
export function explain(error, cfg) {
  const message = String(error?.message || error || 'The job failed.');
  const base = { code: error?.code || 'job_failed', message };
  if (/Could not run ffmpeg|Could not run ffprobe/i.test(message)) {
    return { ...base, code: 'ffmpeg_missing', hint: `ffmpeg was not found (looked for “${cfg.ffmpeg}”). Install it (apt/apk/brew/winget install ffmpeg), set FFMPEG_PATH, or run “npm run get:ffmpeg” inside hls-service/.` };
  }
  if (base.code === 'r2_not_configured') return { ...base, hint: 'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET, then restart the service.' };
  if (/403|denied|permission|credential/i.test(message)) return { ...base, code: error?.code || 'r2_denied', hint: 'The R2 API token must allow Object Read & Write on this bucket (Cloudflare → R2 → Manage API tokens).' };
  if (/No space left|ENOSPC/i.test(message)) return { ...base, code: 'disk_full', hint: 'Free disk space under DATA_DIR, or lower LOCAL_RETENTION_HOURS and delete finished jobs from the portal.' };
  if (/Invalid data found|moov atom not found|Invalid argument|End of file/i.test(message)) return { ...base, code: 'bad_input', hint: 'The file does not look like a complete video. Re-export it, or remux it first: ffmpeg -i in.mkv -c copy out.mp4' };
  if (/timed out/i.test(message)) return { ...base, code: 'probe_timeout', hint: 'The file took too long to inspect — it may be on a slow network or damaged.' };
  if (/ENOENT/i.test(message)) return { ...base, code: 'file_missing', hint: 'A file the job needed is gone (a folder may have been swept or moved). Upload the source again, or check DATA_DIR.' };
  return base;
}

export function createQueue({ cfg, store, transcoder, r2, log = () => {}, fetchImpl = fetch }) {
  // Job id → { cancel(), canceled, encoder, startedAt, lastProgressAt }. `canceled` is checked
  // between stages, so a job can be stopped during download or probing too — not only while encoding.
  const running = new Map();
  const pending = [];                 // ids waiting for a worker
  let active = 0, stopped = false;

  // Layout inside DATA_DIR/work/<job id>/ :  hls/<rung>/…  is the package, everything else is scratch.
  const workDirOf = (id) => path.join(cfg.workDir, id);
  const outDirOf = (id) => path.join(workDirOf(id), 'hls');
  const scratchOf = (id) => path.join(workDirOf(id), 'scratch');

  const jobLog = (id, msg, level = 'info') => { store.logJob(id, msg, level); if (level === 'error') log(`[${id}] ${msg}`); };
  const setProgress = (id, patch) => {
    const job = store.get(id);
    if (!job) return;
    store.update(id, { progress: { ...job.progress, ...patch } });
  };

  /** Refuses to start an encode that cannot possibly fit (source + all rungs + headroom). */
  function diskGuard(needBytes) {
    try {
      const stat = fs.statfsSync(cfg.dataDir);
      const free = Number(stat.bavail) * Number(stat.bsize);
      if (free < needBytes) throw Object.assign(new Error(`Not enough free disk space: ${human(free)} available, about ${human(needBytes)} needed.`), { code: 'disk_full' });
    } catch (e) { if (e?.code === 'disk_full') throw e; /* statfs unavailable → carry on */ }
  }

  /** Downloads the source to `dest` (no-op for an already-staged upload). Returns the file to encode. */
  async function fetchSource(job, dest) {
    const { source } = job;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (source.type === 'upload') {
      if (!source.localPath || !fs.existsSync(source.localPath)) {
        throw Object.assign(new Error('The uploaded file is no longer on disk (the service may have restarted or the retention sweep removed it). Upload it again.'), { code: 'source_gone' });
      }
      return source.localPath;
    }
    if (source.type === 'r2') {
      if (!r2.configured) throw Object.assign(new Error('Cloudflare R2 is not configured, so a source object cannot be read.'), { code: 'r2_not_configured', status: 503 });
      jobLog(job.id, `downloading r2://${r2.bucket}/${source.key}`);
      const before = Date.now();
      await r2.getToFile(source.key, dest, {
        onBytes: (n) => { if (Date.now() - before > 700) setProgress(job.id, { stage: 'fetching', bytes: n }); },
      });
      return dest;
    }
    if (source.type === 'url') {
      jobLog(job.id, `downloading ${source.url}`);
      const res = await fetchImpl(source.url, { redirect: 'follow' });
      if (!res.ok) throw Object.assign(new Error(`Could not download the video URL (HTTP ${res.status}).`), { code: 'source_download_failed' });
      const length = Number(res.headers.get('content-length')) || 0;
      if (length && length > cfg.maxUploadBytes) throw Object.assign(new Error(`That video is ${human(length)} and the limit is ${human(cfg.maxUploadBytes)} (MAX_UPLOAD_GB).`), { code: 'too_large' });
      let bytes = 0, lastTick = 0;
      const stream = Readable.fromWeb(res.body);
      stream.on('data', (c) => {
        bytes += c.length;
        if (bytes > cfg.maxUploadBytes) return stream.destroy(new Error('The video is larger than the configured upload limit.'));
        if (Date.now() - lastTick > 700) { lastTick = Date.now(); setProgress(job.id, { stage: 'fetching', bytes }); }
      });
      await pipeline(stream, fs.createWriteStream(dest));
      return dest;
    }
    throw Object.assign(new Error('Unknown source type.'), { code: 'bad_source' });
  }

  /** The full pipeline for one job. Never throws: every failure is recorded on the job. */
  async function run(job) {
    const startedAt = Date.now();
    const state = { canceled: false, encoder: null, startedAt, lastProgressAt: Date.now() };
    state.cancel = () => { state.canceled = true; state.encoder?.(); };
    running.set(job.id, state);
    const stopIfCanceled = () => { if (state.canceled) throw Object.assign(new Error('Canceled by the operator.'), { code: 'canceled', canceled: true }); };
    try {
      fs.mkdirSync(outDirOf(job.id), { recursive: true });
      store.update(job.id, { status: 'running', stage: 'fetching', error: null });

      // ---- 1. the source, on local disk ------------------------------------------------
      const input = await fetchSource(job, path.join(scratchOf(job.id), `source${path.extname(job.source.name) || '.mp4'}`));
      stopIfCanceled();
      const size = fs.statSync(input).size;
      jobLog(job.id, `source ready (${human(size)})`);

      // ---- 2. inspect it and decide the ladder ----------------------------------------
      store.update(job.id, { stage: 'probing' });
      const info = await transcoder.probe(input);
      stopIfCanceled();
      const { rungs, orientation, preset, sourceShort } = pickLadder(info, { preset: job.options.preset, maxShort: cfg.maxShort });
      const duration = info.duration || 0;
      // Roughly: the source again, plus every rung at its bitrate for the length of the video, plus 0.5 GB of slack.
      diskGuard(size * 2 + rungs.reduce((n, r) => n + (Number(String(r.vb).replace('k', '')) * 1000 * (duration || 900)) / 8, 0) + 512 * 1024 ** 2);
      store.update(job.id, {
        stage: 'encoding',
        probe: { ...info, size, display: `${info.width}×${info.height}`, sourceShort },
        rungs: rungs.map((r) => ({ name: r.name, size: r.size, short: r.short, vb: r.vb, ab: r.ab, segments: 0, percent: 0 })),
      });
      jobLog(job.id, `${info.width}×${info.height} @${info.fps}fps ${info.hasAudio ? info.audioCodec || 'audio' : 'no audio'} · ${duration ? `${Math.round(duration)}s` : 'unknown length'} → ${rungs.map((r) => r.name).join(', ')} (${preset})`);

      // ---- 3. encode -------------------------------------------------------------------
      for (const r of rungs) fs.mkdirSync(path.join(outDirOf(job.id), r.name), { recursive: true });
      let lastTick = 0, segments = {}, segmentsAt = 0;
      const encoderHandle = transcoder.encode({
        input, outDir: outDirOf(job.id), rungs, orientation,
        opts: { duration, segmentSec: job.options.segmentSec, fps: info.fps, hasAudio: info.hasAudio, packaging: job.options.packaging, x264Preset: job.options.x264Preset, profile: job.options.profile, threads: cfg.threads },
        onProgress: (p) => {
          const state = running.get(job.id);
          if (state) state.lastProgressAt = Date.now();
          const now = Date.now();
          if (now - lastTick < 400 && !p.done) return;                   // never flood the store
          lastTick = now;
          if (now - segmentsAt > 3000) {                                 // counting segments walks the disk
            segmentsAt = now;
            segments = Object.fromEntries(rungs.map((r) => [r.name, transcoder.countSegments(path.join(outDirOf(job.id), r.name))]));
          }
          setProgress(job.id, { stage: 'encoding', percent: p.percent, outTimeSec: p.outTimeSec, fps: p.fps, speed: p.speed, etaSeconds: p.etaSeconds, duration, segments });
          store.update(job.id, { rungs: rungs.map((r) => ({ ...r, segments: segments[r.name] || 0, percent: p.percent })) });
        },
        onLog: (line) => { if (/error|invalid|failed/i.test(line)) jobLog(job.id, line, 'error'); else if (/warning/i.test(line)) jobLog(job.id, line, 'warn'); },
      });
      state.encoder = () => encoderHandle.cancel();
      if (stopped || state.canceled) encoderHandle.cancel();
      // Stall watchdog: silence for a long time means a stuck encode; stop it rather than hang forever.
      const watchdog = setInterval(() => {
        const s = running.get(job.id);
        if (s && Date.now() - s.lastProgressAt > cfg.stallSeconds * 1000) {
          jobLog(job.id, `no encoder progress for ${cfg.stallSeconds}s — stopping the encode`, 'error');
          encoderHandle.cancel();
        }
      }, 15_000);
      watchdog.unref?.();
      const result = await encoderHandle.done;
      clearInterval(watchdog);
      stopIfCanceled();
      if (result.canceled) throw Object.assign(new Error('Canceled by the operator.'), { code: 'canceled', canceled: true });
      if (result.code !== 0) throw Object.assign(new Error(`ffmpeg exited with code ${result.code}: ${result.stderrTail.split('\n').filter(Boolean).slice(-3).join(' ') || 'no details'}`), { code: 'encode_failed' });
      setProgress(job.id, { stage: 'packaging', percent: 100, etaSeconds: 0 });

      // ---- 4. check what came out before spending upload bandwidth on it ---------------
      const verified = transcoder.verifyPackage(outDirOf(job.id));
      const files = transcoder.listPackage(outDirOf(job.id));
      store.update(job.id, { rungs: job.rungs.map((r) => ({ ...r, segments: (verified.variants.find((v) => v.name === r.name)?.segments) || r.segments, percent: 100 })) });
      jobLog(job.id, `package ready: ${files.length} files, ${human(files.reduce((n, f) => n + f.bytes, 0))}, ${verified.totalSegments} segments`);

      // ---- 5. upload (or hand the folder over for a manual upload) ---------------------
      stopIfCanceled();
      const prefix = job.options.r2Prefix;
      if (job.options.upload === false) {
        store.update(job.id, {
          status: 'done', stage: 'done', progress: { ...job.progress, percent: 100, stage: 'done', etaSeconds: 0 },
          output: { prefix, slug: job.options.slug, masterKey: null, folder: null, files: files.length, segments: verified.totalSegments, bytes: files.reduce((n, f) => n + f.bytes, 0), local: true, localDir: outDirOf(job.id) },
        });
        jobLog(job.id, 'upload skipped (download-only) — download the ZIP from this page and put it in R2 yourself');
      } else {
        store.update(job.id, { stage: 'uploading', progress: { ...job.progress, stage: 'uploading', percent: 0, bytes: 0, totalBytes: files.reduce((n, f) => n + f.bytes, 0) } });
        const up = await uploadPackage({
          files, r2, prefix, slug: job.options.slug,
          onProgress: ({ done, total, bytes, totalBytes, name }) => setProgress(job.id, { stage: 'uploading', percent: (done / total) * 100, bytes, totalBytes, uploading: name }),
          log: (m) => jobLog(job.id, m),
        });
        setProgress(job.id, { stage: 'verifying', percent: 100 });
        const publicBase = cfg.r2.publicBaseUrl || r2.publicBaseUrl || '';
        const publicUrl = publicBase ? `${publicBase}/${up.masterKey}` : null;
        store.update(job.id, {
          status: 'done', stage: 'done', progress: { ...job.progress, percent: 100, stage: 'done', etaSeconds: 0 },
          output: { prefix, slug: job.options.slug, masterKey: up.masterKey, folder: up.folder || folderOf(up.masterKey), files: up.files, segments: verified.totalSegments, bytes: up.totalBytes, publicUrl, localDir: cfg.deleteLocalAfterUpload ? null : outDirOf(job.id) },
        });
        jobLog(job.id, `uploaded ${up.files} files to r2://${r2.bucket}/${up.folder}`);
        jobLog(job.id, `Content studio → Videos & reels → Video source: Private Cloudflare R2 → key  ${up.masterKey}`);
      }
      jobLog(job.id, `finished in ${Math.round((Date.now() - startedAt) / 1000)}s`);

      // ---- 6. housekeeping -------------------------------------------------------------
      // A downloaded source is always disposable; an uploaded one is kept so Retry works and the
      // retention sweep removes it later.
      if (job.source.type !== 'upload') fs.rmSync(scratchOf(job.id), { recursive: true, force: true });
      if (cfg.deleteLocalAfterUpload && job.options.upload !== false) fs.rmSync(outDirOf(job.id), { recursive: true, force: true });
    } catch (e) {
      const canceled = e?.code === 'canceled' || e?.canceled;
      const info = canceled ? { code: 'canceled', message: 'Canceled by the operator.' } : explain(e, cfg);
      store.update(job.id, {
        status: canceled ? 'canceled' : 'failed',
        stage: canceled ? 'canceled' : 'failed',
        error: { code: info.code, message: info.message, ...(info.hint ? { hint: info.hint } : {}) },
      });
      jobLog(job.id, canceled ? 'canceled' : `failed: ${info.message}`, canceled ? 'warn' : 'error');
      if (job.source.type !== 'upload') { try { fs.rmSync(scratchOf(job.id), { recursive: true, force: true }); } catch { /* ignore */ } }
    } finally {
      running.delete(job.id);
      store.flush();
    }
  }

  /** Picks up the next queued job whenever a worker is free. */
  function pump() {
    if (stopped) return;
    while (pending.length && active < cfg.concurrency) {
      const id = pending.shift();
      const job = store.get(id);
      if (!job || job.status !== 'queued') continue;
      active++;
      run(job).catch((e) => log(`[queue] unexpected error in ${id}: ${e.message}`)).finally(() => { active--; pump(); });
    }
  }

  const api = {
    /** Queues a job that is already in the store. */
    enqueue(id) {
      const job = store.get(id);
      if (!job) return false;
      pending.push(id);
      log(`[queue] queued ${id} (${job.source.name} → ${job.options.r2Prefix}/${job.options.slug})`);
      pump();
      return true;
    },
    /** Stops a running encode (at any stage) or drops a queued one. */
    cancel(id) {
      const job = store.get(id);
      if (!job) return false;
      if (job.status === 'queued') {
        const i = pending.indexOf(id);
        if (i >= 0) pending.splice(i, 1);
        store.update(id, { status: 'canceled', stage: 'canceled', error: { code: 'canceled', message: 'Canceled by the operator.' } });
        store.flush();
        return true;
      }
      if (job.status === 'running') { running.get(id)?.cancel(); return true; }
      return false;
    },
    /** Re-runs a finished/failed/canceled job with the same settings. */
    retry(id) {
      const job = store.get(id);
      if (!job || job.status === 'running' || job.status === 'queued') return false;
      store.update(id, { status: 'queued', stage: 'queued', error: null, output: null, logs: [], rungs: [], progress: { percent: 0, stage: 'queued', fps: 0, speed: 0, etaSeconds: null, outTimeSec: 0, segments: {}, bytes: 0 } });
      return api.enqueue(id);
    },
    /** The portal's Delete: forgets the job, its staged source and its package. R2 objects are never touched. */
    remove(id) {
      api.cancel(id);
      const job = store.get(id);
      if (job?.source.type === 'upload' && job.source.localPath) { try { fs.rmSync(path.dirname(job.source.localPath), { recursive: true, force: true }); } catch { /* ignore */ } }
      try { fs.rmSync(workDirOf(id), { recursive: true, force: true }); } catch { /* ignore */ }
      const had = store.remove(id);
      store.flush();
      return had;
    },
    /** Retention sweep (hourly): forgets the disk copies of jobs that finished long ago. */
    sweep() {
      const cutoff = new Date(Date.now() - cfg.retentionHours * 3600_000).toISOString();
      let removed = 0, freed = 0;
      for (const job of store.finishedBefore(cutoff)) {
        if (job.options?.keepLocal) continue;                              // the operator pinned this one
        const dir = workDirOf(job.id);
        if (fs.existsSync(dir)) { freed += dirSize(dir); fs.rmSync(dir, { recursive: true, force: true }); removed++; }
        if (job.source.type === 'upload' && job.source.localPath) { const f = job.source.localPath; try { freed += fs.statSync(f).size; fs.rmSync(f, { force: true }); } catch { /* gone */ } }
        if (job.output?.localDir) store.update(job.id, { output: { ...job.output, localDir: null } });
      }
      // Uploads that never became a job (browser closed mid-upload) go after a day.
      try {
        for (const entry of fs.readdirSync(cfg.uploadsDir, { withFileTypes: true })) {
          const full = path.join(cfg.uploadsDir, entry.name);
          const age = Date.now() - fs.statSync(full).mtimeMs;
          if (age < 24 * 3600_000) continue;
          const known = [...store.list({ limit: 10_000 }).jobs].some((j) => j.source.localPath?.startsWith(full));
          if (known) continue;
          freed += dirSize(full);
          fs.rmSync(full, { recursive: true, force: true }); removed++;
        }
      } catch { /* the folder may not exist yet */ }
      if (removed) log(`[sweep] removed ${removed} item(s), freed ${human(freed)}`);
      store.flush();
      return { removed, freed };
    },
    stats: () => ({ concurrency: cfg.concurrency, active, queued: pending.length, running: [...running.keys()], counts: store.counts() }),
    /** Kills anything still running (graceful shutdown). */
    stop() { stopped = true; for (const [, state] of running) state.cancel(); pending.length = 0; },
    paths: { workDirOf, outDirOf, scratchOf },
  };
  return api;
}

/** Size of a folder tree in bytes (the sweeper's log line). */
export function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { try { total += fs.statSync(full).size; } catch { /* vanished */ } }
    }
  };
  walk(dir);
  return total;
}
