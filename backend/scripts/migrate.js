import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import { databaseConfig } from '../src/config.js';
export async function migrate(pool) {
  const sql = await fs.readFile(new URL('../migrations/001-initial.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').filter(s => s.trim())) await pool.query(statement);
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const pool = mysql.createPool(databaseConfig());
  try { await migrate(pool); console.log('Database schema ready.'); } finally { await pool.end(); }
}
