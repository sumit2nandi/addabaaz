// Start-up shim for hosts that expect a root-level `server.js` (Hostinger's Node.js Web Apps default to that entry file).
// The real entry point is server/src/index.js; this file just loads settings and hands over to it.
//
// Some hosts write your environment variables to a `.env` file instead of injecting them into the process.
// Node can read that file itself (Node 20.12+/22); variables already set by the host are never overridden.
try { process.loadEnvFile?.(new URL('./.env', import.meta.url)); } catch { /* no .env file - the host provides the variables directly */ }

// Loaded after the settings above, because the server reads its configuration when it starts.
await import('./server/src/index.js');
