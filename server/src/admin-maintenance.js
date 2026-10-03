// Admin API for maintenance mode (Admin → Maintenance).
//
//   GET   /maintenance          → the switch, the message, the window, and what stays online while it is on
//   PATCH /maintenance          → { enabled, message, until } — audited
//
// Mounted from admin.js after the admin authentication middleware, so `req.admin` is always set and the
// console keeps working while the switch is on (see server/src/maintenance.js for the allow-list).
import { bad, wrap } from './http.js';
import { ALWAYS_ALLOWED, DEFAULT_MESSAGE, MAX_MESSAGE } from './maintenance.js';

export function adminMaintenanceRoutes({ router, maintenance, log, siteUrl = '' }) {
  const payload = async () => ({
    ...(await maintenance.state({ fresh: true })),
    defaults: { message: DEFAULT_MESSAGE, maxMessage: MAX_MESSAGE },
    page: `${siteUrl || ''}/maintenance`,
    // Shown in the console so the operator knows exactly what a viewer can still reach.
    stillOnline: ['Health checks', 'This console', 'Signing in', 'Payment webhooks', 'Unsubscribe links'],
    allowed: ALWAYS_ALLOWED.map(String),
  });

  router.get('/maintenance', wrap(async (_req, res) => res.json(await payload())));

  router.patch('/maintenance', wrap(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    if (b.message !== undefined) patch.message = b.message;
    if (b.until !== undefined) patch.until = b.until === null ? null : String(b.until);
    if (!Object.keys(patch).length) throw bad('Nothing to change.', 'nothing_to_update');
    const state = await maintenance.update(patch);
    const action = patch.enabled === true ? 'maintenance.on' : patch.enabled === false ? 'maintenance.off' : 'maintenance.update';
    await log(req, action, null, { until: state.until, message: String(state.message).slice(0, 80) });
    res.json(await payload());
  }));
}
