// Start-up file for Hostinger Node.js Web Apps (set "Entry file" to server.cjs).
//
// Why this exists: Hostinger's LiteSpeed launcher loads the entry file with require() (CommonJS), but this project is an
// ES-module project whose real entry point (server/src/index.js) uses top-level `await`, which require() refuses
// ("ERR_REQUIRE_ASYNC_MODULE"). A .cjs file is always CommonJS, and it can start the ES-module server with import().
const path = require('node:path');

// Some hosts write your environment variables to a `.env` file instead of injecting them into the process.
// Node can read it itself (Node 20.12+); variables already set by the host are never overridden.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env file - the host provides the variables directly */ }

// Start the real server. It reads its settings when it starts, so this must come after the lines above.
import('./server/src/index.js').catch((err) => { console.error('ADDABAAZ failed to start:', err); process.exit(1); });
