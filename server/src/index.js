import { createApp } from './app.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';

const port = Number(process.env.PORT) || 3000;
const db = await createDb({ ensureDatabase: process.env.DB_CREATE === 'true' });
try { await db.ping(); }
catch (e) { console.error(`Cannot connect to MySQL (${e.code || e.message}). Check DATABASE_URL / DB_* settings — see .env.example.`); process.exit(1); }
if (process.env.DB_MIGRATE !== 'false') {                       // set DB_MIGRATE=false to run `npm run db:migrate` as a separate deploy step
  const applied = await migrate(db, { log: (m) => console.log('[migrate]', m) });
  if (applied.length) console.log(`[migrate] applied ${applied.length} migration(s)`);
}
const app = createApp({ db });
const server = app.listen(port, '0.0.0.0', () => console.log(`ADDABAAZ running on http://localhost:${port}  (site + API at /api/v1, MySQL connected)`));
// Renewal reminders: hourly, once per expiry date (the claim is atomic, so running several instances is fine).
const billing = app.locals.billing;
const remind = () => billing.sendExpiryReminders().catch((e) => console.error('[billing] reminder run failed:', e.message));
setTimeout(remind, 30_000).unref();
setInterval(remind, 3600_000).unref();
if (process.env.NODE_ENV === 'production') {
  if (!process.env.SMTP_URL) console.warn('[mail] SMTP_URL is not set — receipts, refund and reminder emails will NOT be sent.');
  if (process.env.RAZORPAY_KEY_ID && !billing.config.gstEnabled) console.warn('[billing] GSTIN is not set — invoices are issued as plain receipts without GST.');
}
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  server.close(async () => { await billing.idle().catch(() => {}); await db.close().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
