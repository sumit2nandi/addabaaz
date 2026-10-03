// Unauthenticated discovery/read endpoints. These do not receive viewer identity.
import { HttpError, wrap } from '../http.js';
import { PLANS } from '../plans.js';
import { STATES } from '../gst.js';

export function registerSystemRoutes(api, { db, catalog, payments, billing, r2, version }) {
  // Endpoints below need no sign-in.
  /* ---------- public ---------- */
  api.get('/health', wrap(async (_req, res) => {                 // liveness + discovery: always 200; `db` reports the database state
    const dbUp = await db.ping().then(() => true, () => false);
    res.json({ ok: true, service: 'addabaaz', version, db: dbUp ? 'up' : 'down', storage: r2.configured ? 'r2' : 'none', payments: payments.provider, time: new Date().toISOString() });
  }));
  api.get('/health/ready', wrap(async (_req, res) => {           // readiness for load balancers / orchestrators: 503 when MySQL is unreachable
    const dbUp = await db.ping().then(() => true, () => false);
    res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? 'up' : 'down' });
  }));
  // The whole catalog as JSON; cached for 15 s by browsers and CDNs.
  api.get('/catalog', wrap(async (_req, res) => { res.set('Cache-Control', 'public, max-age=15'); res.json((await catalog.get()).catalog); }));
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
