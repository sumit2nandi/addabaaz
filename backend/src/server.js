import mysql from 'mysql2/promise';
import { databaseConfig, serverConfig } from './config.js';
import { ContentRepository } from './repository.js';
import { createApp } from './app.js';
const pool = mysql.createPool(databaseConfig());
const app = createApp({ repository: new ContentRepository(pool), ...serverConfig() });
const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`ADDABAAZ API + frontend listening on port ${process.env.PORT || 3000}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
