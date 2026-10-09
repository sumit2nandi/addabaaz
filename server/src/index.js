// Process entry point (`npm start`): connects to MySQL, applies pending migrations, creates the app and starts listening.
// Also schedules the background jobs and shuts down cleanly on SIGINT / SIGTERM.
// All settings come from environment variables - see .env.example and SETUP.md.
import { createApp, APP_VERSION } from './app.js';
import { createErrorLogger, installProcessErrorHandlers } from './error-reporting.js';
import { createDb } from './db.js';
import { dbConfigFromEnv } from './config.js';
import { migrate } from './migrate.js';
import { runScheduledJobs } from './jobs.js';
import { prepareWebAssets } from './web-assets.js';
import { safeErrorUrl } from './http.js';

// Listen port (PORT, default 3000).
const port = Number(process.env.PORT) || 3000;
// Render supplies this SHA for the deployed source revision. It is safe to log and expose in health checks,
// and makes it possible to distinguish a stale deployment from a live database/schema problem.
const release = process.env.RENDER_GIT_COMMIT || '';
const releaseSha = /^[0-9a-f]{7,40}$/i.test(release) ? release.toLowerCase() : '';
console.log(`[release] commit=${releaseSha || 'unknown'}`);
// Work out where the database settings come from and log it (host, database and user only - never the password),
// so a wrong or leftover DATABASE_URL is easy to spot in the host's runtime log.
const dbConfig = dbConfigFromEnv();
console.log(`[db] settings from ${process.env.DATABASE_URL ? 'DATABASE_URL' : 'DB_* variables'}: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
// Say how the connection is secured (no secrets): helps to tell "certificate missing" from "wrong password" in the host's log.
console.log(`[db] TLS: ${dbConfig.ssl ? (dbConfig.ssl.ca ? `on, trusting the provided CA certificate (${(dbConfig.ssl.ca.match(/BEGIN CERTIFICATE/g) || []).length})` : 'on, NO custom CA certificate (only public CAs are trusted)') : 'off'}`);
// Connect to MySQL (creating the database first when DB_CREATE=true) and stop early with a clear message if it is unreachable.
const db = await createDb({ config: dbConfig, ensureDatabase: process.env.DB_CREATE === 'true' });
// Create the reporter as soon as a DB handle exists. It can capture migration/startup failures whenever
// the error table is already available, and otherwise falls back to the host runtime log.
const errorLogger = createErrorLogger({ db, appVersion: APP_VERSION, release: releaseSha });
try { await db.ping(); }
catch (e) {
  console.error(`Cannot connect to MySQL (${e.code || e.message}). Check DATABASE_URL / DB_* settings — see .env.example.`);
  if (e.code && e.message && e.message !== e.code) console.error(`[db] details: ${e.message}`);
  if (/SSL|CERT|TLS/i.test(`${e.code} ${e.message}`)) console.error(dbConfig.ssl?.ca ? '[db] TLS failed although a CA certificate was provided: make sure it is the CA certificate of THIS Aiven service (download it again from the service page).' : '[db] TLS failed and no CA certificate was provided: set DB_SSL_CA (the text of ca.pem) or DB_SSL_CA_FILE.');
  process.exit(1);
}
if (process.env.DB_MIGRATE !== 'false') {                       // set DB_MIGRATE=false to run `npm run db:migrate` as a separate deploy step
  console.log(`[migrate] automatic startup migrations enabled (DB_MIGRATE=${process.env.DB_MIGRATE === undefined ? 'unset' : 'not false'})`);
  let applied;
  try { applied = await migrate(db, { log: (m) => console.log('[migrate]', m) }); }
  catch (e) {
    await errorLogger.capture(e, { severity: 'fatal', kind: 'startup-migration' });
    await errorLogger.flush();
    await db.close().catch(() => {});
    throw e;
  }
  console.log(`[migrate] startup check complete; applied ${applied.length} migration(s)`);
} else {
  console.warn('[migrate] DB_MIGRATE=false — migrations and schema-drift checks are skipped at startup; run `npm run db:migrate` as a deploy step.');
}
// The same reporter now spans startup checks, the HTTP app, background work and fatal process events.
// One address = one account: rewrite stored addresses in the normalized form (migration 012 could only
// lower-case and trim them in SQL). Rows that collide are flagged for Admin → Users → merge.
try {
  const n = await db.adminUsers.renormalizeEmails();
  if (n.updated || n.flagged) console.log(`[users] email normalization: ${n.updated} updated, ${n.flagged} duplicate row(s) flagged for merging`);
} catch (e) { errorLogger.logger.error('[users] email normalization failed:', e); }
// DISABLE_RATE_LIMIT=true is for load tests on a staging copy only — it is ignored in production.
const noRate = /^(1|true)$/i.test(process.env.DISABLE_RATE_LIMIT || '') && process.env.NODE_ENV !== 'production';
if (noRate) errorLogger.logger.warn('⚠ Rate limiting is OFF (DISABLE_RATE_LIMIT) — never expose this instance publicly.');
// Build the HTTP app.
// Minify the front-end first: production serves .build/ (same URLs, no readable source comments).
// Only for the public site; tests and API-only runs keep serving the original files.
if (process.env.MINIFY !== 'false') {
  try { const m = await prepareWebAssets(); console.log(`[web] front-end minified (${m.files} files, −${(m.saved / 1024).toFixed(0)} KB)`); }
  catch (e) { errorLogger.logger.warn('[web] front-end minification skipped — serving sources as-is:', e); }
}
let app;
try { app = createApp({ db, rate: !noRate, release: releaseSha, errorLogger }); }
catch (e) {
  await errorLogger.capture(e, { severity: 'fatal', kind: 'startup-app-creation' });
  await errorLogger.flush();
  await db.close().catch(() => {});
  throw e;
}
// Optional Sentry: `npm i @sentry/node` and set SENTRY_DSN. Not installed by default; the built-in Errors page in /admin works without it.
if (process.env.SENTRY_DSN) {
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development', tracesSampleRate: 0 });
    app.locals.captureError = (err, req) => Sentry.captureException(err, { extra: { method: req?.method, path: safeErrorUrl(req?.path) } });
    console.log('[sentry] error reporting enabled');
  } catch (e) { errorLogger.logger.warn('[sentry] SENTRY_DSN is set but @sentry/node could not be loaded (npm i @sentry/node):', e); }
}
// Start serving on all interfaces (required inside Docker / behind a reverse proxy).
const server = app.listen(port, '0.0.0.0', () => console.log(`ADDABAAZ running on http://localhost:${port}  (site + API at /api/v1, MySQL connected)`));
// Renewal reminders: hourly, once per expiry date (the claim is atomic, so running several instances is fine).
const billing = app.locals.billing;
const remind = () => billing.sendExpiryReminders().catch((e) => app.locals.logger.error('[billing] reminder run failed:', e));
setTimeout(remind, 30_000).unref();
setInterval(remind, 3600_000).unref();
// Every minute: announce newly published episodes / launches (Web Push), and purge expired tokens, idle playback seats, old errors.
const jobs = () => runScheduledJobs({ db, catalog: app.locals.catalog, push: app.locals.push, campaigns: app.locals.campaigns, promos: app.locals.promos, applicationMonitor: app.locals.applicationMonitor, log: app.locals.logger });
setTimeout(jobs, 10_000).unref();
setInterval(jobs, 60_000).unref();
if (process.env.NODE_ENV === 'production') {
  if (!process.env.SMTP_URL) errorLogger.logger.warn('[mail] SMTP_URL is not set — verification, password-reset, receipt, refund and reminder emails will NOT be sent.');
  if (process.env.RAZORPAY_KEY_ID && !billing.config.gstEnabled) errorLogger.logger.warn('[billing] GSTIN is not set — invoices are issued as plain receipts without GST.');
}
// Graceful shutdown: stop accepting connections, wait for in-flight e-mails, close MySQL, then exit.
// Fatal errors are flushed to the error table first, then take this same shutdown path with a failure code.
let stopping = false;
const stop = (requestedExitCode = 0) => {
  const exitCode = Number.isInteger(requestedExitCode) ? requestedExitCode : 0;
  if (stopping) return; stopping = true; process.exitCode = exitCode;
  const force = setTimeout(() => process.exit(exitCode), 5000); force.unref();
  server.close(async () => {
    await billing.idle().catch(() => {});
    await errorLogger.flush();
    await db.close().catch(() => {});
    clearTimeout(force);
    process.exit(exitCode);
  });
};
installProcessErrorHandlers({ errorLogger, onFatal: () => stop(1) });
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
