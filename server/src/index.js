// Process entry point (`npm start`): connects to MySQL, applies pending migrations, creates the app and starts listening.
// Also schedules the background jobs and shuts down cleanly on SIGINT / SIGTERM.
// All settings come from environment variables - see .env.example and SETUP.md.
import { createApp } from './app.js';
import { createDb } from './db.js';
import { dbConfigFromEnv } from './config.js';
import { migrate } from './migrate.js';
import { runScheduledJobs } from './jobs.js';

// Listen port (PORT, default 3000).
const port = Number(process.env.PORT) || 3000;
// Work out where the database settings come from and log it (host, database and user only - never the password),
// so a wrong or leftover DATABASE_URL is easy to spot in the host's runtime log.
const dbConfig = dbConfigFromEnv();
console.log(`[db] settings from ${process.env.DATABASE_URL ? 'DATABASE_URL' : 'DB_* variables'}: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
// Say how the connection is secured (no secrets): helps to tell "certificate missing" from "wrong password" in the host's log.
console.log(`[db] TLS: ${dbConfig.ssl ? (dbConfig.ssl.ca ? `on, trusting the provided CA certificate (${(dbConfig.ssl.ca.match(/BEGIN CERTIFICATE/g) || []).length})` : 'on, NO custom CA certificate (only public CAs are trusted)') : 'off'}`);
// Connect to MySQL (creating the database first when DB_CREATE=true) and stop early with a clear message if it is unreachable.
const db = await createDb({ config: dbConfig, ensureDatabase: process.env.DB_CREATE === 'true' });
try { await db.ping(); }
catch (e) {
  console.error(`Cannot connect to MySQL (${e.code || e.message}). Check DATABASE_URL / DB_* settings — see .env.example.`);
  if (e.code && e.message && e.message !== e.code) console.error(`[db] details: ${e.message}`);
  if (/SSL|CERT|TLS/i.test(`${e.code} ${e.message}`)) console.error(dbConfig.ssl?.ca ? '[db] TLS failed although a CA certificate was provided: make sure it is the CA certificate of THIS Aiven service (download it again from the service page).' : '[db] TLS failed and no CA certificate was provided: set DB_SSL_CA (the text of ca.pem) or DB_SSL_CA_FILE.');
  process.exit(1);
}
if (process.env.DB_MIGRATE !== 'false') {                       // set DB_MIGRATE=false to run `npm run db:migrate` as a separate deploy step
  const applied = await migrate(db, { log: (m) => console.log('[migrate]', m) });
  if (applied.length) console.log(`[migrate] applied ${applied.length} migration(s)`);
}
// DISABLE_RATE_LIMIT=true is for load tests on a staging copy only — it is ignored in production.
const noRate = /^(1|true)$/i.test(process.env.DISABLE_RATE_LIMIT || '') && process.env.NODE_ENV !== 'production';
if (noRate) console.warn('⚠ Rate limiting is OFF (DISABLE_RATE_LIMIT) — never expose this instance publicly.');
// Build the HTTP app.
const app = createApp({ db, rate: !noRate });
// Optional Sentry: `npm i @sentry/node` and set SENTRY_DSN. Not installed by default; the built-in Errors page in /admin works without it.
if (process.env.SENTRY_DSN) {
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development', tracesSampleRate: 0 });
    app.locals.captureError = (err, req) => Sentry.captureException(err, { extra: { method: req?.method, path: req?.path } });
    console.log('[sentry] error reporting enabled');
  } catch (e) { console.warn('[sentry] SENTRY_DSN is set but @sentry/node could not be loaded (npm i @sentry/node):', e.message); }
}
// Start serving on all interfaces (required inside Docker / behind a reverse proxy).
const server = app.listen(port, '0.0.0.0', () => console.log(`ADDABAAZ running on http://localhost:${port}  (site + API at /api/v1, MySQL connected)`));
// Renewal reminders: hourly, once per expiry date (the claim is atomic, so running several instances is fine).
const billing = app.locals.billing;
const remind = () => billing.sendExpiryReminders().catch((e) => console.error('[billing] reminder run failed:', e.message));
setTimeout(remind, 30_000).unref();
setInterval(remind, 3600_000).unref();
// Every minute: announce newly published episodes / launches (Web Push), and purge expired tokens, idle playback seats, old errors.
const jobs = () => runScheduledJobs({ db, catalog: app.locals.catalog, push: app.locals.push, log: console });
setTimeout(jobs, 10_000).unref();
setInterval(jobs, 60_000).unref();
if (process.env.NODE_ENV === 'production') {
  if (!process.env.SMTP_URL) console.warn('[mail] SMTP_URL is not set — receipts, refund and reminder emails will NOT be sent.');
  if (process.env.RAZORPAY_KEY_ID && !billing.config.gstEnabled) console.warn('[billing] GSTIN is not set — invoices are issued as plain receipts without GST.');
}
// Graceful shutdown: stop accepting connections, wait for in-flight e-mails, close the database, then exit (force-exit after 5 s).
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  server.close(async () => { await billing.idle().catch(() => {}); await db.close().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
