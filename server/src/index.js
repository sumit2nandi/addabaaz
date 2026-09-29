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
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  server.close(async () => { await db.close().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
