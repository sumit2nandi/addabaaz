// Alternative entry file (same job as server.cjs). Prefer server.cjs on Hostinger.
//
// Hostinger's launcher loads the entry file with require(). A file that uses top-level `await` cannot be required,
// so this one starts the real server with a plain import() call and no `await`.
try { process.loadEnvFile?.(new URL('./.env', import.meta.url)); } catch { /* no .env file - the host provides the variables directly */ }

import('./server/src/index.js').catch((err) => { console.error('ADDABAAZ failed to start:', err); process.exit(1); });
