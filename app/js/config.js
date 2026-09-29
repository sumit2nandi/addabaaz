const env = window.ADDABAAZ_ENV || {};
export const CONFIG = {
  appName: 'ADDABAAZ',
  version: '2.0.0',
  apiBase: (env.API_BASE || '').replace(/\/$/, ''),   // '' = auto-detect, 'off' = local mode
  premiumEnabled: !!env.PREMIUM_ENABLED,
  googleForm: env.GOOGLE_FORM || null,
  maxProfiles: 5,
  homeRailSize: 12,
  autoplayCountdown: 8,      // seconds before the next episode starts
  resumeMinSeconds: 8,       // don't bother resuming before this
  watchedThreshold: 0.94,    // >94% watched = finished
};
