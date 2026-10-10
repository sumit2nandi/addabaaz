// Unauthenticated discovery/read endpoints. These do not receive viewer identity — except /catalog, which
// optionally resolves it so signed-in ADMIN accounts can also receive the videos hidden with "Show to
// Admins only" (see catalog.js publicView); guests and search engines keep the plain visitor view.
import { HttpError, wrap } from '../http.js';
import { PLANS } from '../plans.js';
import { STATES } from '../gst.js';

export function registerSystemRoutes(api, { db, catalog, payments, billing, r2, version, release = '', maintenance = null, viewer = null }) {
  const releaseSha = /^[0-9a-f]{7,40}$/i.test(String(release || '')) ? String(release).toLowerCase() : null;
  const releaseInfo = releaseSha ? { commit: releaseSha } : {};
  // Endpoints below need no sign-in.
  /* ---------- public ---------- */
  api.get('/health', wrap(async (_req, res) => {                 // liveness + discovery: always 200; `db` reports the database state
    const dbUp = await db.ping().then(() => true, () => false);
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({ ok: true, service: 'addabaaz', version, ...releaseInfo, db: dbUp ? 'up' : 'down', storage: r2.configured ? 'r2' : 'none', payments: payments.provider, time: new Date().toISOString() });
  }));
  api.get('/health/ready', wrap(async (_req, res) => {           // readiness for load balancers / orchestrators: 503 when MySQL is unreachable
    const dbUp = await db.ping().then(() => true, () => false);
    res.set('Cache-Control', 'no-store, max-age=0');
    res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? 'up' : 'down', ...releaseInfo });
  }));
  // Public status probe: what the site and the apps poll to know whether the service is up, whether it is in
  // maintenance and when it is expected back. Never blocked by the maintenance switch (server/src/maintenance.js).
  api.get('/status', wrap(async (_req, res) => {
    const m = maintenance ? await maintenance.state() : { active: false, enabled: false, message: '', until: null };
    res.set('Cache-Control', 'no-store, max-age=0').json({ ok: true, service: 'addabaaz', version, maintenance: m, time: new Date().toISOString() });
  }));
  // The app fetches this after a page reload so edits made in Admin appear immediately, including
  // when the request lands on another server with an in-memory catalog snapshot.
  api.get('/catalog', wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    // Optional identity: only an enabled ADMIN account changes the answer (hidden "admins only" videos join
    // the list). The resolver returns null for guests and for invalid or disabled sessions, so the public
    // payload — and everything search engines see — is untouched for everybody else.
    const user = viewer ? await viewer(req) : null;
    res.json((await catalog.get({ fresh: true, staff: !!user?.isAdmin })).catalog);
  }));
  api.get('/studio', wrap(async (_req, res) => {
    const s = (await catalog.get()).studio; if (!s) throw new HttpError(404, 'not_found', 'No studio profile.');
    res.set('Cache-Control', 'public, max-age=15'); res.json(s);
  }));
  // Client cache version. Bumping it (Admin → Client cache) makes every browser and installed app that
  // checks in drop its cached files on the next load — the "clear cache for everybody" button. `no-store`
  // so a proxy can never serve a stale value.
  api.get('/client-version', wrap(async (_req, res) => {
    const [version, scope] = await Promise.all([
      db.settings.get('client_cache_version', '1'),
      db.settings.get('client_cache_scope', 'assets'),
    ]);
    res.set('Cache-Control', 'no-store, max-age=0').json({ version: String(version), scope: scope === 'all' ? 'all' : 'assets' });
  }));
  // Plans, plus how payments are configured so the front end knows which checkout UI to show (never secrets).
  api.get('/plans', (_req, res) => res.json({
    plans: PLANS,
    payments: { provider: payments.provider, ...(payments.provider === 'razorpay' ? { keyId: payments.keyId } : {}), ...(payments.provider === 'mock' ? { demo: true } : {}) },
    billing: { gst: billing.config.gstEnabled, coupons: payments.provider === 'razorpay', states: STATES },
  }));

}
