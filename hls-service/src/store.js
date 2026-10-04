/**
 * Job store: the queue's memory and its durable record.
 *
 * Every job is a plain object (see `newJob`), kept in memory for fast reads and mirrored to
 * `DATA_DIR/jobs.json` so a restart does not lose the history — a job that was mid-encode when the
 * process died is marked `failed` with “interrupted”, and the portal offers a Retry button.
 *
 * Writes are debounced: progress updates arrive several times a second, and rewriting the file on
 * every one of them would be pointless I/O.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const STATUSES = ['queued', 'running', 'done', 'failed', 'canceled'];
export const STAGES = ['queued', 'fetching', 'probing', 'encoding', 'uploading', 'verifying', 'done'];
// A short, sortable, filesystem-safe id (also used as the folder name under work/).
export const newId = () => `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${crypto.randomBytes(3).toString('hex')}`;

/** A brand-new job record. Everything the API returns about a job comes from this shape. */
export function newJob({ id = newId(), source, options, createdAt = new Date().toISOString() }) {
  return {
    id, createdAt, updatedAt: createdAt,
    status: 'queued', stage: 'queued',
    source, options,
    probe: null, rungs: [],
    progress: { percent: 0, stage: 'queued', fps: 0, speed: 0, etaSeconds: null, outTimeSec: 0, segments: {}, bytes: 0 },
    logs: [],
    output: null,
    error: null,
    published: null,
  };
}

/** The subset of a job the list view needs (the detail view adds logs, rungs and the R2 result). */
export const brief = (job) => ({
  id: job.id, createdAt: job.createdAt, updatedAt: job.updatedAt, status: job.status, stage: job.stage,
  source: { type: job.source.type, name: job.source.name, size: job.source.size },
  options: { slug: job.options.slug, preset: job.options.preset, packaging: job.options.packaging, r2Prefix: job.options.r2Prefix },
  progress: { percent: job.progress.percent, etaSeconds: job.progress.etaSeconds, bytes: job.progress.bytes, stage: job.progress.stage, speed: job.progress.speed, fps: job.progress.fps, segments: job.progress.segments },
  output: job.output ? { masterKey: job.output.masterKey, bytes: job.output.bytes, files: job.output.files, publicUrl: job.output.publicUrl || null } : null,
  error: job.error ? { code: job.error.code, message: job.error.message } : null,
});

export function createStore({ file, log = () => {} }) {
  const jobs = new Map();
  let timer = null, writing = null;

  /** Atomic write: temp file + rename, so a crash mid-write cannot corrupt the history. */
  function flushNow() {
    if (writing) return writing;
    writing = (async () => {
      const payload = JSON.stringify([...jobs.values()], null, 0);
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(tmp, payload);
      await fs.promises.rename(tmp, file);
    })().catch((e) => log(`[store] could not save ${file}: ${e.message}`)).finally(() => { writing = null; });
    return writing;
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flushNow(); }, 250);
    timer.unref?.();
  }

  const store = {
    /** Loads the history from disk; anything that was running when the process died becomes a failed job. */
    load() {
      try {
        if (!fs.existsSync(file)) return { loaded: 0, interrupted: 0 };
        const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
        let interrupted = 0;
        for (const row of Array.isArray(rows) ? rows : []) {
          if (!row?.id) continue;
          if (row.status === 'running' || row.status === 'queued') {
            row.status = 'failed'; row.stage = 'failed';
            row.error = { code: 'interrupted', message: 'The converter restarted while this job was running. Use Retry to encode it again.' };
            interrupted++;
          }
          jobs.set(row.id, row);
        }
        return { loaded: jobs.size, interrupted };
      } catch (e) {
        log(`[store] could not read ${file} (${e.message}) — starting with an empty history`);
        return { loaded: 0, interrupted: 0 };
      }
    },
    get: (id) => jobs.get(id) || null,
    /** Newest first, optionally filtered by status. */
    list({ status = null, limit = 100, offset = 0 } = {}) {
      let rows = [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (status) rows = rows.filter((r) => r.status === status);
      return { total: rows.length, jobs: rows.slice(offset, offset + limit) };
    },
    /** Counts per status, for the portal's filter chips and the health endpoint. */
    counts() {
      const out = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      for (const j of jobs.values()) out[j.status] = (out[j.status] || 0) + 1;
      return out;
    },
    add(job) { jobs.set(job.id, job); schedule(); return job; },
    /** Shallow-merges a patch into a job and saves. Returns the updated job (or null if it is gone). */
    update(id, patch) {
      const job = jobs.get(id);
      if (!job) return null;
      Object.assign(job, patch, { updatedAt: new Date().toISOString() });
      schedule();
      return job;
    },
    /** Appends to the job's log, keeping the last 300 lines (the full encoder output stays in the server log). */
    logJob(id, message, level = 'info') {
      const job = jobs.get(id);
      if (!job) return;
      job.logs.push({ t: new Date().toISOString(), level, message: String(message).slice(0, 500) });
      if (job.logs.length > 300) job.logs.splice(0, job.logs.length - 300);
      job.updatedAt = new Date().toISOString();
      schedule();
    },
    remove(id) { const had = jobs.delete(id); if (had) schedule(); return had; },
    /** Jobs that finished long ago — the retention sweeper deletes their files from disk. */
    finishedBefore(isoDate) {
      return [...jobs.values()].filter((j) => (j.status === 'done' || j.status === 'failed' || j.status === 'canceled') && j.updatedAt < isoDate);
    },
    flush: flushNow,
    async close() { if (timer) { clearTimeout(timer); timer = null; } await flushNow(); if (writing) await writing; },
  };
  return store;
}
