import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`ADDABAAZ running on http://localhost:${port}  (site + API at /api/v1)`);
});
const stop = () => { app.db.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
