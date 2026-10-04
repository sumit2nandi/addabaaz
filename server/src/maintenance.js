// Maintenance mode (Admin → Maintenance).
//
// One switch in `app_settings` takes the viewer side of ADDABAAZ offline *on purpose*: viewer API calls
// answer 503 with `code: "maintenance"`, and any browser page is answered with the branded maintenance page
// (maintenance.html) instead of the app shell. Nothing is deployed and nothing is migrated — the switch
// works on the running server, which is the whole point.
//
// What stays available while the switch is on, because an operator needs it or a user already paid for it:
//   * /health, /health/ready           — uptime checks and load balancers keep seeing the process
//   * /status                          — the site and the apps poll it to know we are down and when we are back
//   * /admin/*                         — the console, so the switch can be turned back off
//   * /auth/*                          — signing in to reach that console
//   * /payments/webhook                — a payment that already happened must still settle
//   * /notifications/unsubscribe       — an unsubscribe link in an e-mail that was already sent
// Everything else is refused with 503 + Retry-After, and the apps show the maintenance screen.
//
// The window can end by itself: when `until` passes, the site comes back automatically even if nobody turns
// the switch off, so a forgotten "back in an hour" cannot strand the site. Settings are cached for a few
// seconds so a burst of page views does not hit the database on every request; `update()` clears the cache.
import { bad, wrap } from './http.js';

/** The `app_settings` keys this module owns. */
export const MAINTENANCE_KEYS = Object.freeze({
  enabled: 'maintenance_enabled',
  message: 'maintenance_message',
  until: 'maintenance_until',
  startedAt: 'maintenance_started_at',
});

export const DEFAULT_MESSAGE = 'ADDABAAZ is getting a quick upgrade. We’ll be back shortly — thanks for your patience!';
export const MAX_MESSAGE = 240;          // `app_settings.v` is VARCHAR(255)
export const DEFAULT_RETRY_AFTER = 60;   // seconds, when no end time is known

/** Paths (inside /api/v1) that the switch never blocks. */
export const ALWAYS_ALLOWED = Object.freeze([
  /^\/health(?:\/|$)/,
  /^\/status$/,
  /^\/admin(?:\/|$)/,
  /^\/auth(?:\/|$)/,
  /^\/payments\/webhook(?:\/|$)/,
  /^\/notifications\/unsubscribe$/,
]);

/** True for a path that keeps working during maintenance. */
export const maintenanceAllows = (path) => ALWAYS_ALLOWED.some((re) => re.test(String(path || '/')));

const isTrue = (v) => v === true || v === 'true' || v === '1' || v === 'yes';
const iso = (v) => {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * The switch. `db` is the repository facade (only `db.settings` is used), so this works with the in-memory
 * fakes in the tests exactly like it does with MySQL.
 */
export function createMaintenance({ db, log = console, ttlMs = 5000 } = {}) {
  let cached = null;               // { at, state } — a few seconds of shared state across all requests

  /** Reads the four settings and turns them into the public state object. Never throws. */
  async function read() {
    const blank = { active: false, enabled: false, message: DEFAULT_MESSAGE, until: null, startedAt: null, since: null };
    let raw;
    try { raw = await db.settings.all(); }
    catch (e) { log.warn?.('[maintenance] could not read settings:', e.message); return blank; }   // a database outage is not "maintenance mode"
    const enabled = isTrue(raw[MAINTENANCE_KEYS.enabled]);
    const until = iso(raw[MAINTENANCE_KEYS.until]);
    const startedAt = iso(raw[MAINTENANCE_KEYS.startedAt]);
    // `until` in the past ends the window by itself — including one that ended between two requests.
    const expired = !!(until && Date.parse(until) <= Date.now());
    const active = enabled && !expired;
    const message = String(raw[MAINTENANCE_KEYS.message] || '').trim() || DEFAULT_MESSAGE;
    return { active, enabled, expired, message, until: expired ? null : until, startedAt, since: active ? startedAt : null };
  }

  /** The current state (cached for `ttlMs`). `{ fresh: true }` always reads the database. */
  async function state({ fresh = false } = {}) {
    if (!fresh && cached && Date.now() - cached.at < ttlMs) return cached.state;
    const next = await read();
    cached = { at: Date.now(), state: next };
    return next;
  }

  const isActive = async () => (await state()).active;

  /** Validates and stores a change made in the console. Returns the new state. */
  async function update(patch = {}) {
    const current = await state({ fresh: true });
    const write = [];
    if (patch.enabled !== undefined) {
      const on = !!patch.enabled;
      if (on && !current.active) write.push([MAINTENANCE_KEYS.startedAt, new Date().toISOString()]);
      if (!on) write.push([MAINTENANCE_KEYS.startedAt, '']);
      write.push([MAINTENANCE_KEYS.enabled, on ? 'true' : 'false']);
    }
    if (patch.message !== undefined) {
      const message = String(patch.message ?? '').trim();
      if (message.length > MAX_MESSAGE) throw bad(`Keep the message under ${MAX_MESSAGE} characters.`, 'message_too_long');
      write.push([MAINTENANCE_KEYS.message, message]);
    }
    if (patch.until !== undefined) {
      if (patch.until === null || patch.until === '') write.push([MAINTENANCE_KEYS.until, '']);
      else {
        const until = iso(patch.until);
        if (!until) throw bad('That end time isn’t a date I understand.', 'invalid_until');
        if (Date.parse(until) <= Date.now()) throw bad('The end time is in the past — leave it empty to stay down until you turn it off.', 'invalid_until');
        write.push([MAINTENANCE_KEYS.until, until]);
      }
    }
    for (const [k, v] of write) await db.settings.set(k, v);
    cached = null;                                     // the very next request sees the change
    return state({ fresh: true });
  }

  /** Seconds to wait before retrying a blocked request (for Retry-After). */
  const retryAfter = (s) => {
    if (!s.until) return DEFAULT_RETRY_AFTER;
    const left = Math.ceil((Date.parse(s.until) - Date.now()) / 1000);
    return Math.max(30, Math.min(3600, left));
  };

  /**
   * The API middleware. Mount it once, before the viewer routes, on the /api/v1 router: it lets the
   * always-allowed paths through and refuses everything else while the switch is on.
   */
  function guard() {
    return wrap(async (req, res, next) => {
      if (req.method === 'OPTIONS') return next();                 // CORS preflight must not fail
      const s = await state();
      if (!s.active) return next();
      if (maintenanceAllows(req.path)) return next();
      res.status(503)
        .set({ 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter(s)) })
        .json({ error: { code: 'maintenance', message: s.message, until: s.until } });
    });
  }

  return { state, isActive, update, guard, retryAfter, DEFAULT_MESSAGE, MAX_MESSAGE, KEYS: MAINTENANCE_KEYS };
}
