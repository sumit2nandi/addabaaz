/* ---------------------------------------------------------------
 * Deployment-time settings. This is a plain (non-module) script so
 * it can be edited or generated per environment WITHOUT a rebuild:
 *   - Web (static host):   leave API_BASE empty -> the app auto-detects
 *                          a same-origin /api/v1 and otherwise runs in
 *                          "local mode" (profiles/list/progress stored on device).
 *   - Web + API:           set API_BASE to e.g. "https://api.addabaaz.in".
 *   - Android / iOS:       `npm run build:www` writes this file into www/ using
 *                          the API_BASE env var (see docs/MOBILE.md).
 * --------------------------------------------------------------- */
window.ADDABAAZ_ENV = {
  API_BASE: '',              // '' = auto-detect same-origin API, 'off' = force local mode
  PREMIUM_ENABLED: false,    // false = premium titles need a sign-in only. true = also require an ADDABAAZ Plus plan (and show Plans). Match PREMIUM_REQUIRES_SUBSCRIPTION on the server.
  GOOGLE_FORM: {             // contact-form fallback when no API is present
    action: 'https://docs.google.com/forms/d/e/1FAIpQLSefTIXeGfnzRR7oumsp1wsSvoOjEWjtK-opcCN5T1LR0ZE7fA/formResponse',
    fields: { name: 'entry.1034004557', email: 'entry.608979481', phone: 'entry.641949480', message: 'entry.548756118' }
  }
};
