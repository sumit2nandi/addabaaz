// All configuration in one place, read from environment variables (see .env.example).
// Every value has a safe default, so the only hard requirement is CONVERTER_TOKEN.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = (v, dflt = false) => (v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(String(v)));
const num = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };

/** Loads the published ffmpeg build in ./.tools when FFMPEG_PATH is not set (npm run get:ffmpeg). */
function localTool(name) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const p = path.join(ROOT, '.tools', name + ext);
  return fs.existsSync(p) ? p : '';
}

export function configFromEnv(env = process.env) {
  const dataDir = path.resolve(ROOT, env.DATA_DIR || './data');
  const ffmpeg = env.FFMPEG_PATH || localTool('ffmpeg') || 'ffmpeg';
  const ffprobe = env.FFPROBE_PATH || localTool('ffprobe') || (env.FFMPEG_PATH ? env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1') : 'ffprobe');
  return {
    root: ROOT,
    port: num(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    token: env.CONVERTER_TOKEN || '',
    // Guard rails on the two things that can exhaust a machine: parallelism and disk.
    concurrency: Math.max(1, Math.min(num(env.CONCURRENCY, 1), 8)),
    threads: Math.max(0, num(env.FFMPEG_THREADS, 0)),
    maxUploadBytes: Math.max(0.001, num(env.MAX_UPLOAD_GB, 16)) * 1024 ** 3,   // 1 MB floor: below this no video is worthwhile
    retentionHours: Math.max(1, num(env.LOCAL_RETENTION_HOURS, 48)),
    deleteLocalAfterUpload: bool(env.DELETE_LOCAL_AFTER_UPLOAD, false),
    stallSeconds: Math.max(30, num(env.STALL_SECONDS, 300)),
    // Highest rung ever produced (a 4K master gets a 1080p top rung unless this is raised).
    maxShort: Math.max(240, num(env.MAX_SHORT_SIDE, 1080)),
    // Preset the portal starts on (auto | full | hd | mobile | fast | source).
    defaultPreset: /^(auto|full|hd|mobile|fast|source)$/.test(env.DEFAULT_PRESET || '') ? env.DEFAULT_PRESET : 'auto',
    ffmpeg,
    ffprobe,
    // Everything the service writes lives under DATA_DIR (uploads/, work/, jobs.json).
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    workDir: path.join(dataDir, 'work'),
    jobsFile: path.join(dataDir, 'jobs.json'),
    r2: {
      accountId: env.R2_ACCOUNT_ID || '',
      accessKeyId: env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
      bucket: env.R2_BUCKET || '',
      endpoint: env.R2_ENDPOINT || '',
      prefix: (env.R2_PREFIX || 'premium').replace(/^\/+|\/+$/g, ''),
      publicBaseUrl: (env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    },
    // Optional link to the main ADDABAAZ API: list videos and attach a finished HLS key.
    site: {
      apiUrl: (env.APP_API_URL || '').replace(/\/+$/, ''),
      adminToken: env.APP_ADMIN_TOKEN || '',
      get configured() { return !!(this.apiUrl && this.adminToken); },
    },
    trustProxy: bool(env.TRUST_PROXY, false),
    // Browser origins allowed to call this API from another site ('' = only this service's own pages).
    corsOrigins: String(env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    secureHsts: bool(env.HSTS, false),
    production: env.NODE_ENV === 'production',
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  };
}

/** Creates the data folders and refuses to boot without a usable token in production. */
export function prepareDataDirs(cfg) {
  for (const dir of [cfg.dataDir, cfg.uploadsDir, cfg.workDir]) fs.mkdirSync(dir, { recursive: true });
  return cfg;
}

/** Human-readable problems with this configuration (empty array = good to go). */
export function configProblems(cfg) {
  const problems = [];
  if (!cfg.token) problems.push('CONVERTER_TOKEN is not set — the portal and the API cannot authenticate anyone.');
  else if (cfg.token.length < 24) problems.push(`CONVERTER_TOKEN is only ${cfg.token.length} characters — use at least 24.`);
  const complete = cfg.r2.accessKeyId && cfg.r2.secretAccessKey && cfg.r2.bucket && (cfg.r2.accountId || cfg.r2.endpoint);
  if (!complete) problems.push('Cloudflare R2 is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) — packages can be encoded and downloaded, but not uploaded.');
  return problems;
}
