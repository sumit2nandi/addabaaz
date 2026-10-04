// Entry point (`npm start`): check the setup, restore the job history, build the collaborators and
// start serving. Also runs the retention sweeper and shuts down cleanly on SIGINT / SIGTERM.
//
// Everything comes from environment variables — see .env.example and README.md.
import { configFromEnv, prepareDataDirs, configProblems } from './config.js';
import { createStore } from './store.js';
import { createTranscoder } from './transcode.js';
import { createR2 } from './r2.js';
import { createQueue } from './queue.js';
import { createSiteBridge } from './site.js';
import { createServer } from './server.js';

const cfg = prepareDataDirs(configFromEnv());
const log = (m) => console.log(`[hls] ${m}`);

// ---- start-up report: the two things that stop this service working are shown before anything else.
const problems = configProblems(cfg);
const transcoder = createTranscoder(cfg, { log });
const ffmpeg = await transcoder.version();
console.log('┌──────────────────────────────────────────────────────────────');
console.log(`│ ADDABAAZ HLS converter ${cfg.version}`);
console.log(`│ data dir : ${cfg.dataDir}`);
console.log(`│ ffmpeg   : ${ffmpeg ? `${ffmpeg.version} (${cfg.ffmpeg})` : `NOT FOUND — looked for “${cfg.ffmpeg}”`}`);
console.log(`│ R2       : ${cfg.r2.bucket ? `${cfg.r2.bucket} under ${cfg.r2.prefix}/` : 'not configured (encode + download only)'}`);
console.log(`│ jobs     : ${cfg.concurrency} at a time, history in ${cfg.jobsFile}`);
console.log('└──────────────────────────────────────────────────────────────');
if (!ffmpeg) console.warn('[hls] ⚠ ffmpeg is missing: install it, set FFMPEG_PATH, or run “npm run get:ffmpeg”. Jobs will fail until then.');
for (const p of problems) console.warn(`[hls] ⚠ ${p}`);
if (cfg.production && problems.length) console.warn('[hls] ⚠ running in production with an incomplete configuration.');

// ---- collaborators -----------------------------------------------------------------------------
const store = createStore({ file: cfg.jobsFile, log });
const loaded = store.load();
if (loaded.loaded) log(`restored ${loaded.loaded} job(s) from history${loaded.interrupted ? ` (${loaded.interrupted} marked as interrupted — use Retry)` : ''}`);
const r2 = createR2(cfg.r2, { log });
const site = createSiteBridge(cfg);
const queue = createQueue({ cfg, store, transcoder, r2, log });
const app = createServer({ cfg, store, queue, transcoder, r2, site, log });

// ---- serve -------------------------------------------------------------------------------------
const server = app.listen(cfg.port, cfg.host, () => {
  log(`portal → http://localhost:${cfg.port}/          API → http://localhost:${cfg.port}/api/v1`);
  if (!cfg.token) log('set CONVERTER_TOKEN (≥24 characters) to enable the portal and the API');
});

// Retention sweep: hourly, and once shortly after boot (a redeploy may have left old files behind).
const sweep = () => { try { queue.sweep(); } catch (e) { log(`sweeper failed: ${e.message}`); } };
setTimeout(sweep, 20_000).unref?.();
setInterval(sweep, 3600_000).unref?.();

// Graceful shutdown: stop the encoder, save the history, close the socket, then exit (5 s hard limit).
let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  log(`${signal} — stopping (finished jobs are kept in ${cfg.jobsFile})`);
  queue.stop();
  server.close(async () => { await store.close().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref?.();
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('[hls] unhandled rejection:', e));
