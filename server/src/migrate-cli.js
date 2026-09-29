import { createDb } from './db.js';
import { migrate } from './migrate.js';

const db = await createDb({ ensureDatabase: process.env.DB_CREATE === 'true' });
try {
  const applied = await migrate(db, { log: (m) => console.log('[migrate]', m) });
  console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
} finally { await db.close(); }
