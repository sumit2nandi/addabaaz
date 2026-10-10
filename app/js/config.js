// Front-end settings. Values that differ per deployment come from app/env.js (`window.ADDABAAZ_ENV`); the rest are tuning constants.
// app/env.js is loaded before this module; it may be missing or empty.
const env = globalThis.window?.ADDABAAZ_ENV || {};
export const CONFIG = {
  appName: 'ADDABAAZ',
  version: '2.0.1',
  // API base URL. '' = auto-detect the API on the same origin; 'off' = never use an API (static / local-only mode).
  apiBase: (env.API_BASE || '').replace(/\/$/, ''),   // '' = auto-detect, 'off' = local mode
  googleForm: env.GOOGLE_FORM || null,
  // UI limits and player behaviour (the server enforces its own limits too).
  maxProfiles: 5,
  homeRailSize: 12,
  autoplayCountdown: 5,      // seconds before the next episode starts
  resumeMinSeconds: 1,       // include any started video in Continue Watching
  watchedThreshold: 0.94,    // >94% watched = finished
};
