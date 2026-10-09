import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError, bad, wrap, rateLimit } from './http.js';
import { isDuplicate } from './db-errors.js';
import { visibleEmail, plainEmail } from './email-address.js';
import { sessionForRequest } from './sessions.js';
import { PLANS, paidPlan } from './plans.js';
import { validate, TYPES } from './catalog-schema.js';
import { describeImage, describeImageVariant, describeSubtitle, cacheUpload, UPLOAD_NAME, videoKey } from './uploads.js';
import { adminExtraRoutes } from './admin-extra.js';
import { adminPromoRoutes } from './admin-promos.js';
import { adminMaintenanceRoutes } from './admin-maintenance.js';
import { suggestYouTubeKind } from './youtube-feed.js';
import { smsHealthCheck } from './sms.js';

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const DATABASE_MONITOR_RETENTION_DAYS = [1, 3, 7, 14, 30];
const APPLICATION_MONITOR_RETENTION_DAYS = DATABASE_MONITOR_RETENTION_DAYS;
const DATABASE_MONITOR_RANGES = { '1h': 3_600, '6h': 21_600, '24h': 86_400, '3d': 259_200, '7d': 604_800, '14d': 1_209_600, '30d': 2_592_000 };
const APPLICATION_MONITOR_RANGES = DATABASE_MONITOR_RANGES;
// UTC half-open bounds for the current calendar day in Asia/Kolkata (MySQL timestamps are stored in UTC).
const istDayBounds = (now = new Date()) => {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const startMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000;
  return { start: new Date(startMs), end: new Date(startMs + 86_400_000) };
};

// Input helpers: `asInt` / `asDate` turn optional request values into numbers/dates (or null) and throw a 400 with a helpful message when invalid.
const asInt = (v, what) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 0) throw bad(`${what} must be a whole number.`); return n; };
const asDate = (v, what) => { if (v === undefined || v === null || v === '') return null; const t = Date.parse(v); if (Number.isNaN(t)) throw bad(`${what} must be an ISO date.`); return new Date(t); };
// Hash used to compare secrets in constant time (both sides get the same length).
const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
// Reads `limit` / `offset` query parameters with sane defaults and a maximum page size.
const page = (req, dflt = 25, max = 100) => ({ limit: Math.min(Math.max(Number(req.query.limit) || dflt, 1), max), offset: Math.max(Number(req.query.offset) || 0, 0) });

/**
 * The admin API (mounted at /api/v1/admin). Access = a signed-in ADMIN ACCOUNT (users.is_admin, granted with `npm run admin -- grant <email>`)
 * whose session is younger than `sessionHours`, or — for scripts — the shared ADMIN_TOKEN. Every change is written to the audit log.
 */
// Every route below runs after the authentication middleware, so `req.admin` is always set.
// Write actions call `log(...)` so the audit log records who did what.
export function createAdminRouter({ db, billing, catalog, youtubeFeed = null, r2, payments, mailer, push = null, campaigns = null, unsubscribeUrlFor = null, social, adminToken, secret, sessionHours = 12, uploadDir, mediaDir, rate = true, publicApiUrl = '', sms = null, promos = null, maintenance = null, applicationMonitor = null, siteUrl = '', logger = console, env = process.env }) {
  // The shared ADMIN_TOKEN (for scripts) only counts when it is long enough to be unguessable.
  const tokenOn = adminToken.length >= 24;
  if (adminToken && !tokenOn) logger.warn('[admin] ADMIN_TOKEN is shorter than 24 characters — the token is ignored (admin accounts still work).');
  const router = express.Router();

  // Generous rate limit for the console (600 requests/min per IP).
  router.use(rate ? rateLimit('admin', 600, 60_000) : (_q, _s, n) => n());
  // AUTHENTICATION: accept either the shared ADMIN_TOKEN, or a normal session token that belongs to an enabled account with the admin role
  // and is recent enough (admin sessions expire sooner than viewer ones).
  router.use(wrap(async (req, _res, next) => {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!got) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    if (tokenOn && crypto.timingSafeEqual(digest(got), digest(adminToken))) { req.admin = { id: null, email: 'ADMIN_TOKEN', name: 'Admin token', via: 'token' }; return next(); }
    const session = await sessionForRequest(req, { db, secret });
    if (!session) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    const { user, claims: payload } = session;
    if (user.disabledAt) throw new HttpError(403, 'account_disabled', 'This account is disabled.');
    if (!user.isAdmin) throw new HttpError(403, 'forbidden', 'This account is not an administrator.');
    if (Date.now() / 1000 - payload.iat > sessionHours * 3600) throw new HttpError(401, 'admin_session_expired', `For security, admin sessions last ${sessionHours} hours — please sign in again.`);
    req.admin = { id: user.id, email: user.email, name: user.name, via: 'session' };
    next();
  }));
  // Writes an entry to the audit log (who, what, which target, extra details, from which IP).
  const log = (req, action, target = null, meta = null) => db.audit.add({ actorId: req.admin.id, actor: req.admin.email, action, target, meta, ip: req.ip }).catch((e) => logger.error('[audit] audit record failed:', e));
  // The signed preview token contains only an opaque DB snapshot ID, so even a very large channel fits the API body limit.
  const signYoutubePreview = (payload) => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  };
  const readYoutubePreview = (token) => {
    const invalidPreview = () => new HttpError(400, 'invalid_youtube_preview', 'The YouTube preview is invalid. Preview the uploads again.');
    if (typeof token !== 'string' || token.length > 2_000) throw invalidPreview();
    const dot = token.lastIndexOf('.');
    if (dot <= 0 || !/^[A-Za-z0-9_-]{43}$/.test(token.slice(dot + 1))) throw invalidPreview();
    const encoded = token.slice(0, dot), supplied = Buffer.from(token.slice(dot + 1), 'base64url');
    const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw invalidPreview();
    let payload;
    try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw invalidPreview(); }
    if (!payload || !/^[0-9a-f-]{36}$/i.test(payload.snapshotId || '') || !Number.isFinite(payload.expiresAt)) throw invalidPreview();
    if (payload.expiresAt <= Date.now()) throw new HttpError(409, 'youtube_preview_expired', 'This preview has expired. Check YouTube again before importing.');
    return payload;
  };

  // Who am I? Used by the console after sign-in.
  router.get('/session', (req, res) => res.json({ admin: req.admin, sessionHours, tokenEnabled: tokenOn }));

  /* ---------- dashboard & setup checklist ---------- */
  // Dashboard numbers (users, subscribers, revenue, signups).
  router.get('/stats', wrap(async (_req, res) => res.json(await db.stats.overview())));
  // Process runtime and aggregate API telemetry, with a compact historical series across app instances.
  router.get('/application/monitor', wrap(async (req, res) => {
    if (!applicationMonitor?.current || !db.applicationMonitoring?.history || !db.applicationMonitoring?.retentionDays) {
      throw new HttpError(503, 'application_monitor_unavailable', 'Application monitoring is not available on this server.');
    }
    const [current, retentionDays] = await Promise.all([applicationMonitor.current(), db.applicationMonitoring.retentionDays()]);
    const maxSeconds = retentionDays * 86_400;
    const requestedValue = typeof req.query.range === 'string' ? req.query.range : '';
    const requested = Object.hasOwn(APPLICATION_MONITOR_RANGES, requestedValue) ? requestedValue : '7d';
    let range = requested;
    if (APPLICATION_MONITOR_RANGES[range] > maxSeconds) {
      range = Object.keys(APPLICATION_MONITOR_RANGES).filter((key) => APPLICATION_MONITOR_RANGES[key] <= maxSeconds).at(-1) || '1h';
    }
    const rangeSeconds = Math.min(APPLICATION_MONITOR_RANGES[range], maxSeconds);
    const since = new Date(Date.now() - rangeSeconds * 1000);
    const bucketSeconds = Math.max(60, Math.ceil(rangeSeconds / 600 / 60) * 60);
    const history = await db.applicationMonitoring.history({ since, bucketSeconds });
    res.set('Cache-Control', 'private, no-store');
    res.json({ current, history, range, rangeSeconds, retentionDays, sampleIntervalSeconds: 60 });
  }));
  router.patch('/application/monitor/settings', wrap(async (req, res) => {
    if (!db.applicationMonitoring?.setRetentionDays) throw new HttpError(503, 'application_monitor_unavailable', 'Application monitoring settings are not available on this server.');
    const days = Number(req.body?.retentionDays);
    if (!APPLICATION_MONITOR_RETENTION_DAYS.includes(days)) throw bad('Choose a supported application history retention period.');
    await db.applicationMonitoring.setRetentionDays(days);
    await log(req, 'application_monitor.retention_updated', null, { retentionDays: days });
    res.set('Cache-Control', 'private, no-store');
    res.json({ retentionDays: days });
  }));

  // Current database metrics plus a compact historical series for the Grafana-like charts.
  router.get('/database/monitor', wrap(async (req, res) => {
    if (!db.monitoring?.snapshot || !db.monitoring?.history || !db.monitoring?.retentionDays) {
      throw new HttpError(503, 'database_monitor_unavailable', 'Database monitoring is not available on this server.');
    }
    const [snapshot, retentionDays] = await Promise.all([db.monitoring.snapshot(), db.monitoring.retentionDays()]);
    const maxSeconds = retentionDays * 86_400;
    const requestedValue = typeof req.query.range === 'string' ? req.query.range : '';
    const requested = Object.hasOwn(DATABASE_MONITOR_RANGES, requestedValue) ? requestedValue : '7d';
    let range = requested;
    if (DATABASE_MONITOR_RANGES[range] > maxSeconds) {
      range = Object.keys(DATABASE_MONITOR_RANGES).filter((key) => DATABASE_MONITOR_RANGES[key] <= maxSeconds).at(-1) || '1h';
    }
    const rangeSeconds = Math.min(DATABASE_MONITOR_RANGES[range], maxSeconds);
    const since = new Date(Date.now() - rangeSeconds * 1000);
    // Downsample longer ranges in MySQL, keeping responses to roughly 600 chart points.
    const bucketSeconds = Math.max(60, Math.ceil(rangeSeconds / 600 / 60) * 60);
    const history = await db.monitoring.history({ since, bucketSeconds });
    res.set('Cache-Control', 'private, no-store');
    res.json({ ...snapshot, history, range, rangeSeconds, retentionDays, sampleIntervalSeconds: 60 });
  }));
  // Retention is persisted in app_settings; reducing it also removes samples outside the newly selected window.
  router.patch('/database/monitor/settings', wrap(async (req, res) => {
    if (!db.monitoring?.setRetentionDays) throw new HttpError(503, 'database_monitor_unavailable', 'Database monitoring settings are not available on this server.');
    const days = Number(req.body?.retentionDays);
    if (!DATABASE_MONITOR_RETENTION_DAYS.includes(days)) throw bad('Choose a supported history retention period.');
    await db.monitoring.setRetentionDays(days);
    await log(req, 'database_monitor.retention_updated', null, { retentionDays: days });
    res.set('Cache-Control', 'private, no-store');
    res.json({ retentionDays: days });
  }));
  // Setup checklist: reports which optional services (payments, mail, R2, social logins ...) are configured. Never reveals secret values.
  router.get('/health', wrap(async (_req, res) => {
    const dbUp = await db.ping().then(() => true, () => false);
    let uploads = false; try { fs.mkdirSync(uploadDir, { recursive: true }); fs.accessSync(uploadDir, fs.constants.W_OK); uploads = true; } catch { /* not writable */ }
    const prod = env.NODE_ENV === 'production';
    const indexing = env.ALLOW_INDEXING ? /^(1|true|yes)$/i.test(env.ALLOW_INDEXING) : prod;
    // Builds one checklist row: ok -> level "ok", otherwise the given level (warn / error).
    const item = (id, label, ok, detail, level = 'warn') => ({ id, label, ok, detail, level: ok ? 'ok' : level });
    res.json({ checks: [
      item('db', 'Database', dbUp, dbUp ? 'MySQL is reachable.' : 'MySQL is not reachable.', 'error'),
      item('jwt', 'Session secret', !!env.JWT_SECRET, env.JWT_SECRET ? 'JWT_SECRET is set.' : 'JWT_SECRET is not set — sessions use an insecure development secret.', prod ? 'error' : 'warn'),
      item('payments', 'Payments', payments.provider === 'razorpay', payments.provider === 'razorpay' ? 'Razorpay is connected.' : payments.provider === 'mock' ? 'Demo checkout — nobody is really charged.' : 'No payment provider: paid plans cannot be bought.'),
      item('gst', 'GST invoicing', billing.config.gstEnabled, billing.config.gstEnabled ? `Invoices are issued under GSTIN ${billing.config.gstin}.` : 'GSTIN is not set — purchases get plain receipts without GST.'),
      item('mail', 'Email', mailer.provider === 'smtp', mailer.provider === 'smtp' ? 'SMTP is configured. Use Send test email below to check actual delivery.' : 'SMTP_URL is not set — verification, password-reset and billing emails are not sent.'),
      // Phone sign-in (MSG91). Reports which variables are present — never their values — so "SMS is not set
      // up yet" is visible in the console instead of only in the server log (docs/MSG91.md).
      (() => { const c = smsHealthCheck(env, sms?.provider || 'none'); return item('sms', 'SMS sign-in (MSG91)', c.ok, c.detail, c.level); })(),
      item('r2', 'Private video storage (R2)', !!r2.configured, r2.configured ? `Bucket “${r2.bucket}” is configured.` : 'R2 is not configured — R2-hosted videos cannot play (optional for other sources).'),
      item('push', 'Web push', !!push?.configured, push?.configured ? 'VAPID keys are set; broadcasts reach browsers and installed web apps.' : 'VAPID keys are not set — browser notifications are off (optional).', 'info'),
      item('apppush', 'App push', !!push?.nativeConfigured, push?.nativeConfigured ? 'Server Firebase credentials are set; native app builds also need Firebase client config (and iOS APNs setup).' : 'FCM_SERVICE_ACCOUNT is not set — the phone apps cannot receive broadcasts (optional; see docs/MOBILE.md).', 'info'),
      item('apple', 'Apple sign-in', !!social.verifiers?.apple, social.verifiers?.apple ? 'Enabled.' : 'Not configured (optional; required only for iOS apps that offer other social logins).', 'info'),
      item('google', 'Google sign-in', !!social.verifiers?.google, social.verifiers?.google ? 'Enabled.' : 'Not configured (optional).', 'info'),
      item('facebook', 'Facebook sign-in', !!social.verifiers?.facebook, social.verifiers?.facebook ? 'Enabled.' : 'Not configured (optional).', 'info'),
      item('uploads', 'Image uploads', dbUp, dbUp ? `Stored in MySQL, so they survive restarts and redeploys. ${uploads ? `A local copy is kept in ${uploadDir} to serve them faster.` : `The local cache folder ${uploadDir} is not writable, so files are served straight from MySQL.`}` : 'MySQL is not reachable, so images and subtitles cannot be saved.', 'error'),
      item('site', 'Public site URL', !!env.PUBLIC_SITE_URL, env.PUBLIC_SITE_URL ? env.PUBLIC_SITE_URL : 'PUBLIC_SITE_URL is not set — links in emails, canonical URLs and the sitemap fall back to the address of each request. Set it to your https address (no trailing slash).', prod ? 'warn' : 'info'),
      item('indexing', 'Google indexing', indexing, indexing ? 'Search engines may index the site: robots.txt and /sitemap.xml are live.' : 'Search engines are told NOT to index this site (robots.txt disallows all). That is right for staging; on the live site set NODE_ENV=production or ALLOW_INDEXING=true.', prod ? 'warn' : 'info'),
      item('admins', 'Administrators', (await db.adminUsers.countAdmins()) > 0, `${await db.adminUsers.countAdmins()} admin account(s).`, 'warn'),
    ] });
  }));

  /* ---------- users ---------- */
  // List users with search, filter tabs and paging.
  router.get('/users', wrap(async (req, res) => res.json(await db.adminUsers.list({ q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '', filter: String(req.query.filter || 'all'), ...page(req) }))));
  // Loads a user or answers 404.
  const userOr404 = async (id) => { const u = await db.adminUsers.get(String(id)); if (!u) throw new HttpError(404, 'not_found', 'Unknown user.'); return u; };
  /* Accounts that ended up sharing one e-mail address (invisible characters, full-width @, spaces …).
   * Registered BEFORE `/users/:id` so the path is not read as a user id. */
  router.get('/users/duplicates', wrap(async (_req, res) => {
    const normalized = await db.adminUsers.renormalizeEmails();      // legacy rows first, so the report is exact
    const groups = await db.adminUsers.duplicateGroups();
    res.json({
      groups: groups.map((g) => ({ ...g, users: g.users.map((u) => ({ ...u, emailVisible: visibleEmail(u.email), emailPlain: plainEmail(u.email) })) })),
      normalized,
    });
  }));
  // Merge two accounts that share an address: everything moves to the one that stays, the other is deleted.
  router.post('/users/merge', wrap(async (req, res) => {
    const keepId = String(req.body?.keepId || ''), removeId = String(req.body?.removeId || '');
    if (!keepId || !removeId) throw bad('Both accounts are required.');
    const out = await db.adminUsers.mergeUsers(keepId, removeId);
    await log(req, 'user.merge', removeId, { keep: keepId, email: out.keep.email, moved: out.moved });
    res.json(out);
  }));
  router.get('/users/:id', wrap(async (req, res) => {
    const u = await userOr404(req.params.id);
    const [profiles, subscription, providers, pays] = await Promise.all([db.profiles.list(u.id), db.subscriptions.get(u.id), db.identities.providersOf(u.id), db.payments.listRecent({ userId: u.id, limit: 50 })]);
    res.json({ user: { ...u, hasPin: !!(await db.accounts.pin(u.id))?.hash, providers }, profiles, subscription, payments: pays, spentPaise: pays.filter((p) => p.status === 'paid').reduce((n, p) => n + p.amountPaise - p.refundedPaise, 0) });
  }));
  router.delete('/users/:id/parental-pin', wrap(async (req, res) => {
    const u = await userOr404(req.params.id);
    await db.accounts.setPin(u.id, null);
    await log(req, 'user.parental_pin.remove', u.id);
    res.sendStatus(204);
  }));
  // Rename, promote/demote admin, enable/disable. Safety rules: you cannot lock yourself out, and the last administrator cannot be removed.
  router.patch('/users/:id', wrap(async (req, res) => {
    const u = await userOr404(req.params.id), b = req.body || {}, patch = {};
    if (b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) throw bad('Name must be 1–60 characters.'); patch.name = b.name.trim(); }
    if (b.isAdmin !== undefined) patch.isAdmin = b.isAdmin === true;
    if (b.disabled !== undefined) patch.disabled = b.disabled === true;
    const self = req.admin.id === u.id;
    if (self && (patch.isAdmin === false || patch.disabled)) throw new HttpError(409, 'cannot_lock_yourself_out', 'You can’t remove your own admin access or disable your own account.');
    if (u.isAdmin && !u.disabledAt && (patch.isAdmin === false || patch.disabled) && (await db.adminUsers.countAdmins()) <= 1) throw new HttpError(409, 'last_admin', 'This is the last administrator.');
    await db.adminUsers.update(u.id, patch);
    for (const k of Object.keys(patch)) await log(req, `user.${k === 'isAdmin' ? 'admin' : k}`, u.email, { value: patch[k], name: patch.name });
    res.json({ user: await db.adminUsers.get(u.id) });
  }));
  /** Complimentary access (no payment, no invoice) — e.g. cast, press, support fixes. */
  router.post('/users/:id/grant', wrap(async (req, res) => {
    const u = await userOr404(req.params.id), b = req.body || {};
    // Free access grant: 1 to 3650 days of a paid plan, no payment and no invoice; recorded as provider "admin".
    const days = Number(b.days); if (!Number.isInteger(days) || days < 1 || days > 3650) throw bad('days must be a whole number from 1 to 3650.');
    const plan = paidPlan(b.planId || 'plus-monthly'); if (!plan) throw bad('Choose a paid plan.', 'unknown_plan');
    await db.subscriptions.extend(u.id, { planId: plan.id, days, provider: 'admin' });
    await log(req, 'user.grant', u.email, { days, planId: plan.id, note: typeof b.note === 'string' ? b.note.slice(0, 200) : undefined });
    res.json({ subscription: await db.subscriptions.get(u.id) });
  }));
  // Remove a user's plan immediately.
  router.post('/users/:id/revoke-plan', wrap(async (req, res) => {
    const u = await userOr404(req.params.id);
    await db.subscriptions.clear(u.id); await log(req, 'user.revoke_plan', u.email);
    res.json({ subscription: await db.subscriptions.get(u.id) });
  }));
  // Permanently delete an account (cascades to profiles, library, subscription).
  router.delete('/users/:id', wrap(async (req, res) => {
    const u = await userOr404(req.params.id);
    if (req.admin.id === u.id) throw new HttpError(409, 'cannot_lock_yourself_out', 'You can’t delete your own account here — use the site’s Account page.');
    if (u.isAdmin && !u.disabledAt && (await db.adminUsers.countAdmins()) <= 1) throw new HttpError(409, 'last_admin', 'This is the last administrator.');
    await db.users.remove(u.id); await log(req, 'user.delete', u.id);
    res.sendStatus(204);
  }));

  /* ---------- payments, refunds, invoices ---------- */
  // Payment list, filterable by buyer and status.
  router.get('/payments', wrap(async (req, res) => {
    const f = { email: typeof req.query.email === 'string' && req.query.email.trim() ? req.query.email.trim().toLowerCase() : null, status: ['created', 'paid', 'failed'].includes(req.query.status) ? req.query.status : null };
    const { limit, offset } = page(req, 50, 200);
    res.json({ total: await db.payments.countAll(f), payments: await db.payments.listRecent({ ...f, limit, offset }) });
  }));
  // Refund a payment (full or partial). Talks to Razorpay, issues a credit note and revokes access on a full refund - see billing.js.
  router.post('/payments/:id/refund', wrap(async (req, res) => {
    const b = req.body || {};
    const rec = await billing.refund({ paymentId: req.params.id, amountPaise: b.amountPaise === undefined ? undefined : Number(b.amountPaise), reason: typeof b.reason === 'string' ? b.reason.trim() : '', revokeAccess: b.revokeAccess === true });
    await log(req, 'payment.refund', req.params.id, { amountPaise: rec.refund?.amountPaise, status: rec.refund?.status, revokeAccess: b.revokeAccess === true, reason: b.reason });
    res.status(201).json({ refund: rec.refund, creditNote: rec.creditNote && { id: rec.creditNote.id, number: rec.creditNote.number }, accessRevoked: rec.revoked });
  }));
  // Download any invoice / credit note as PDF.
  router.get('/invoices/:id/pdf', wrap(async (req, res) => { const f = await billing.adminInvoicePdf(req.params.id); res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'private, no-store' }); res.send(f.content); }));
  /** Sales register as CSV. from/to are IST calendar dates (inclusive); default = the current calendar month. */
  router.get('/invoices.csv', wrap(async (req, res) => {
    // Date range is in IST calendar days, inclusive of the last day.
    const ist = (d) => new Date(Date.parse(`${d}T00:00:00+05:30`));
    const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(ist(d).getTime());
    const now = new Date(Date.now() + 5.5 * 3600_000), monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const from = req.query.from === undefined ? monthStart : req.query.from, to = req.query.to === undefined ? now.toISOString().slice(0, 10) : req.query.to;
    if (!ok(from) || !ok(to)) throw bad('from and to must be dates like 2026-04-01.');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales-register-${from}_${to}.csv"` });
    res.send(await billing.registerCsv(ist(from), new Date(ist(to).getTime() + 86_400_000)));
  }));

  /* ---------- coupons ---------- */
  // Coupon list (with how many times each was used).
  router.get('/coupons', wrap(async (_req, res) => res.json({ coupons: await db.coupons.list(), plans: PLANS.filter((p) => p.priceINR > 0).map((p) => ({ id: p.id, name: p.name, priceINR: p.priceINR })) })));
  // Create a coupon: percent (1-100) or flat amount in paise, optional plan restriction, redemption caps and dates.
  router.post('/coupons', wrap(async (req, res) => {
    const b = req.body || {}, code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw bad('Code must be 3–30 characters: letters, digits, "-" or "_".');
    if (!['percent', 'flat'].includes(b.kind)) throw bad('kind must be "percent" or "flat".');
    const value = asInt(b.value, 'value');
    if (b.kind === 'percent' ? !(value >= 1 && value <= 100) : !(value >= 100)) throw bad(b.kind === 'percent' ? 'A percent coupon must be 1–100.' : 'A flat coupon is in paise, at least 100 (₹1).');
    const planIds = Array.isArray(b.planIds) && b.planIds.length ? b.planIds.map(String) : null;
    if (planIds?.some((id) => !paidPlan(id))) throw bad('planIds must be paid plan ids.');
    const perUserLimit = asInt(b.perUserLimit ?? 1, 'perUserLimit'); if (!(perUserLimit >= 1)) throw bad('perUserLimit must be at least 1.');
    try {
      const coupon = await db.coupons.create({ code, description: typeof b.description === 'string' ? b.description.slice(0, 120) : null, kind: b.kind, value, planIds, maxRedemptions: asInt(b.maxRedemptions, 'maxRedemptions'), perUserLimit, startsAt: asDate(b.startsAt, 'startsAt'), expiresAt: asDate(b.expiresAt, 'expiresAt') });
      await log(req, 'coupon.create', code, { kind: b.kind, value });
      res.status(201).json({ coupon });
    } catch (e) { if (isDuplicate(e)) throw new HttpError(409, 'exists', 'A coupon with that code already exists.'); throw e; }
  }));
  // Only limits, dates, status and description can change; the discount itself is fixed so past invoices stay correct.
  router.patch('/coupons/:code', wrap(async (req, res) => {
    const code = String(req.params.code).toUpperCase(), b = req.body || {};
    if (!(await db.coupons.get(code))) throw new HttpError(404, 'not_found', 'Unknown coupon.');
    const patch = {};
    if (b.active !== undefined) patch.active = !!b.active;
    if ('expiresAt' in b) patch.expiresAt = asDate(b.expiresAt, 'expiresAt');
    if ('startsAt' in b) patch.startsAt = asDate(b.startsAt, 'startsAt');
    if ('maxRedemptions' in b) patch.maxRedemptions = asInt(b.maxRedemptions, 'maxRedemptions');
    if (b.perUserLimit !== undefined) { patch.perUserLimit = asInt(b.perUserLimit, 'perUserLimit'); if (!(patch.perUserLimit >= 1)) throw bad('perUserLimit must be at least 1.'); }
    if (typeof b.description === 'string') patch.description = b.description.slice(0, 120);
    const coupon = await db.coupons.update(code, patch); await log(req, 'coupon.update', code, patch);
    res.json({ coupon });
  }));
  // Only unused coupons can be deleted; used ones should be deactivated instead.
  router.delete('/coupons/:code', wrap(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!(await db.coupons.get(code))) throw new HttpError(404, 'not_found', 'Unknown coupon.');
    if (!(await db.coupons.remove(code))) throw new HttpError(409, 'coupon_used', 'This coupon has been used, so it is kept for the records — deactivate it instead.');
    await log(req, 'coupon.delete', code); res.sendStatus(204);
  }));

  /* ---------- contact messages ---------- */
  // Contact-form inbox: list, mark handled/re-open, delete.
  router.get('/messages', wrap(async (req, res) => res.json(await db.messages.list({ status: ['open', 'handled', 'all'].includes(req.query.status) ? req.query.status : 'open', ...page(req, 30) }))));
  router.patch('/messages/:id', wrap(async (req, res) => {
    if (typeof req.body?.handled !== 'boolean') throw bad('handled must be true or false.');
    if (!(await db.messages.setHandled(req.params.id, req.body.handled ? req.admin.email : null))) throw new HttpError(404, 'not_found', 'Unknown message.');
    await log(req, req.body.handled ? 'message.handled' : 'message.reopened', req.params.id); res.sendStatus(204);
  }));
  router.delete('/messages/:id', wrap(async (req, res) => {
    if (!(await db.messages.remove(req.params.id))) throw new HttpError(404, 'not_found', 'Unknown message.');
    await log(req, 'message.delete', req.params.id); res.sendStatus(204);
  }));

  // The audit log (newest first, filterable by action).
  router.get('/audit', wrap(async (req, res) => res.json({ entries: await db.audit.list({ limit: Math.min(Number(req.query.limit) || 100, 300), before: Number(req.query.before) || null, action: typeof req.query.action === 'string' ? req.query.action.slice(0, 40) : null }) })));

  /* ---------- catalog (shows, videos, coming soon, gallery, studio) ---------- */
  // Catalog documents may reference uploaded images / media files; this lets the validator check that a referenced path really exists (and stays inside the allowed folders).
  const fileExists = (rel) => {
    const [top, ...rest] = rel.split('/'); const base = top === 'uploads' ? uploadDir : top === 'media' ? mediaDir : null;
    if (!base) return false;
    const file = path.resolve(base, ...rest); return file.startsWith(path.resolve(base) + path.sep) && fs.existsSync(file);
  };
  // Extra context the catalog validator needs to check existing references and media files.
  const ctxOf = (snap) => ({ fileExists, showIds: snap.showIds, upcomingIds: snap.upcomingIds });
  // Uploaded images and subtitles live in MySQL; the upload folder is only a cache that a restart or redeploy can empty. So a document may
  // legitimately refer to an upload that is not on this server's disk. The validator is synchronous, so first look up the stored uploads
  // that the document mentions, then let `fileExists` accept those too.
  const uploadNamesIn = (value, found = new Set()) => {
    if (found.size >= 200) return found;
    if (typeof value === 'string') { const m = /^uploads\/([^/]+)$/.exec(value.trim()); if (m && UPLOAD_NAME.test(m[1])) found.add(m[1]); }
    else if (Array.isArray(value)) value.forEach((v) => uploadNamesIn(v, found));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => uploadNamesIn(v, found));
    return found;
  };
  const ctxFor = async (snap, doc) => {
    const stored = await db.uploads.existing([...uploadNamesIn(doc)]);
    return { ...ctxOf(snap), fileExists: (rel) => fileExists(rel) || (rel.startsWith('uploads/') && stored.has(rel.slice('uploads/'.length))) };
  };
  // Maps the `:type` URL segment (show, video, upcoming, gallery) to the collection; unknown types -> 404.
  const kindOf = (req) => { if (!TYPES[req.params.type]) throw new HttpError(404, 'not_found', 'Unknown catalog section.'); return { key: req.params.type, type: TYPES[req.params.type] }; };
  const invalid = (errors) => new HttpError(400, 'invalid_item', errors.join(' '));

  // This is the only code path that reads YouTube: a complete paginated channel scan runs only after an admin clicks Preview.
  const freshYoutubeFeed = async () => {
    if (!youtubeFeed?.refresh) throw new HttpError(503, 'youtube_not_configured', 'Full-channel YouTube preview is not configured on this server.');
    let feed;
    try { feed = await youtubeFeed.refresh(); }
    catch (e) { throw new HttpError(503, 'youtube_unavailable', 'YouTube could not be reached or its upload list could not be fully scanned. No catalog changes were made. Please try again.', { cause: e }); }
    if (!feed?.configured) {
      const detail = feed?.reason === 'missing_api_key'
        ? 'Set YOUTUBE_API_KEY to a server-side YouTube Data API v3 key before previewing the full channel.'
        : 'Set a valid YOUTUBE_CHANNEL_ID before previewing channel uploads.';
      throw new HttpError(503, 'youtube_not_configured', detail);
    }
    if (feed.complete !== true || !Array.isArray(feed.videos)) throw new HttpError(502, 'invalid_youtube_feed', 'YouTube did not return a complete channel upload list. No catalog changes were made.');
    if (feed.videos.length > 100_000) throw new HttpError(502, 'invalid_youtube_feed', 'The channel upload list exceeds the supported scan size. No catalog changes were made.');
    const videos = [], seen = new Set();
    for (const upload of feed.videos) {
      const id = String(upload?.id || '').trim(), title = String(upload?.title || '').trim(), publishedMs = Date.parse(upload?.publishedAt || '');
      if (!YOUTUBE_VIDEO_ID_RE.test(id) || !title || title.length > 300 || !Number.isFinite(publishedMs) || seen.has(id)) {
        throw new HttpError(502, 'invalid_youtube_feed', 'YouTube returned an invalid upload entry. No catalog changes were made.');
      }
      seen.add(id);
      videos.push({
        id, title, publishedAt: new Date(publishedMs).toISOString(),
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${id}`,
        suggestedKind: suggestYouTubeKind(title),
      });
    }
    const checkedAtMs = Number.isFinite(Date.parse(feed.updatedAt || '')) ? Date.parse(feed.updatedAt) : Date.now();
    return { videos, checkedAt: new Date(checkedAtMs).toISOString(), checkedAtMs };
  };

  router.post('/catalog/youtube/preview', wrap(async (req, res) => {
    const feed = await freshYoutubeFeed();
    const snap = await catalog.get({ all: true });
    const knownIds = new Set(snap.catalog.videos.map((v) => v.id));
    const knownYoutubeIds = new Set(snap.catalog.videos.filter((v) => v.source?.type === 'youtube').map((v) => v.source.id));
    const items = feed.videos.map((v) => ({ ...v, alreadyImported: knownIds.has(v.id) || knownYoutubeIds.has(v.id) }));
    const snapshotId = crypto.randomUUID(), expiresAtMs = Date.now() + 15 * 60_000;
    if (!db.catalog.createYouTubePreview) throw new HttpError(503, 'youtube_preview_unavailable', 'The database cannot store the YouTube preview snapshot.');
    await db.catalog.createYouTubePreview({
      snapshotId, actor: req.admin.email,
      checkedAt: new Date(feed.checkedAtMs), expiresAt: new Date(expiresAtMs), videos: feed.videos,
    });
    const previewToken = signYoutubePreview({ snapshotId, expiresAt: expiresAtMs });
    res.set('Cache-Control', 'no-store');
    res.json({ items, previewToken, checkedAt: feed.checkedAt, expiresAt: new Date(expiresAtMs).toISOString(), total: items.length, missing: items.filter((v) => !v.alreadyImported).length });
  }));

  // Import one small chunk from the signed, server-stored preview. Import never makes another YouTube request.
  router.post('/catalog/youtube/import', wrap(async (req, res) => {
    const claims = readYoutubePreview(req.body?.previewToken);
    if (!db.catalog.getYouTubePreview) throw new HttpError(503, 'youtube_preview_unavailable', 'The YouTube preview snapshot is unavailable. Preview the channel again.');
    const preview = await db.catalog.getYouTubePreview(claims.snapshotId, req.admin.email);
    if (!preview || !Array.isArray(preview.videos) || Date.parse(preview.expiresAt) <= Date.now()) {
      throw new HttpError(409, 'youtube_preview_expired', 'This preview has expired. Check YouTube again before importing.');
    }
    if (Date.parse(preview.expiresAt) !== claims.expiresAt) throw new HttpError(400, 'invalid_youtube_preview', 'The YouTube preview is invalid. Preview the uploads again.');
    const checkedAtMs = Date.parse(preview.checkedAt);
    if (!Number.isFinite(checkedAtMs)) throw new HttpError(409, 'youtube_preview_expired', 'This preview is invalid. Check YouTube again before importing.');
    const byId = new Map(preview.videos.map((v) => [v.id, v]));
    const selections = req.body?.selections;
    if (!Array.isArray(selections) || selections.length < 1 || selections.length > 200) throw bad('Choose between 1 and 200 videos to import at a time.');
    const requestedBatchId = req.body?.batchId;
    const batchId = requestedBatchId === undefined ? crypto.randomUUID() : requestedBatchId;
    if (typeof batchId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) throw bad('batchId must be a UUID.');
    const chosen = [], seen = new Set();
    for (const selection of selections) {
      const id = typeof selection?.id === 'string' ? selection.id : '';
      if (!YOUTUBE_VIDEO_ID_RE.test(id) || seen.has(id)) throw bad('Each selected video must have a unique YouTube video id.');
      if (!['reel', 'clip'].includes(selection?.kind)) throw bad('Every selected video must be set to Reel / Short or Landscape video.');
      const upload = byId.get(id);
      if (!upload) throw new HttpError(409, 'youtube_preview_changed', 'That video is not part of this preview. Check YouTube again and retry.');
      chosen.push({ upload, kind: selection.kind }); seen.add(id);
    }

    const snap = await catalog.get({ all: true });
    const knownIds = new Set(snap.catalog.videos.map((v) => v.id));
    const knownYoutubeIds = new Set(snap.catalog.videos.filter((v) => v.source?.type === 'youtube').map((v) => v.source.id));
    const candidates = [];
    for (const { upload, kind } of chosen) {
      if (knownIds.has(upload.id) || knownYoutubeIds.has(upload.id)) continue;
      // YouTube's API does not expose runtime or reliably identify Shorts. Admin-selected imports start free, unrated and hidden=false.
      const candidate = {
        id: upload.id, showId: null, kind, title: upload.title,
        source: { type: 'youtube', id: upload.id }, thumbnail: upload.thumbnail,
        duration: 0, publishedAt: upload.publishedAt, views: 0, access: 'free', hidden: false,
      };
      const { doc, errors } = validate('video', candidate, ctxOf(snap));
      if (errors.length) throw new HttpError(502, 'invalid_youtube_item', 'A selected upload could not be added to the video catalog.');
      candidates.push(doc);
    }
    const addedIds = candidates.length ? await db.catalog.putYouTubeImports(candidates, { batchId, actor: req.admin.email }) : [];
    const added = new Set(addedIds), skipped = selections.length - addedIds.length;
    const kindCounts = { reel: 0, clip: 0 };
    for (const { upload, kind } of chosen) if (added.has(upload.id)) kindCounts[kind]++;
    if (addedIds.length) catalog.invalidate();
    const checkedAt = new Date(checkedAtMs).toISOString();
    await log(req, 'catalog.youtube.import', 'youtube', { batchId: addedIds.length ? batchId : null, added: addedIds.length, skipped, kinds: kindCounts, checkedAt });
    res.set('Cache-Control', 'no-store');
    res.json({ batchId: addedIds.length ? batchId : null, added: addedIds.length, skipped, ids: addedIds, checkedAt });
  }));

  // Import history powers the admin's undo-last-batch and remove-today actions; it reads MySQL only.
  const youtubeImportSummary = async () => {
    if (!db.youtubeImports?.summary) throw new HttpError(503, 'youtube_import_history_unavailable', 'YouTube import history is unavailable.');
    const { start, end } = istDayBounds();
    const history = await db.youtubeImports.summary({ start, end });
    const snap = await catalog.get({ all: true });
    const activeYoutubeIds = new Set(snap.catalog.videos.filter((v) => v.source?.type === 'youtube').map((v) => v.id));
    const active = (ids = []) => [...new Set(ids)].filter((id) => activeYoutubeIds.has(id));
    return {
      last: history.last ? { ...history.last, videoIds: active(history.last.videoIds) } : null,
      todayVideoIds: active(history.todayVideoIds),
    };
  };
  router.get('/catalog/youtube/imports', wrap(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await youtubeImportSummary());
  }));

  // Removes only still-present YouTube videos that belong to the requested tracked scope.
  router.post('/catalog/youtube/remove-imports', wrap(async (req, res) => {
    const scope = req.body?.scope;
    if (!['last', 'today'].includes(scope)) throw bad('scope must be "last" or "today".');
    const history = await youtubeImportSummary();
    const ids = scope === 'last' ? (history.last?.videoIds || []) : history.todayVideoIds;
    const snap = await catalog.get({ all: true }), videosById = new Map(snap.catalog.videos.map((v) => [v.id, v]));
    let removed = 0;
    for (const id of ids) {
      if (videosById.get(id)?.source?.type !== 'youtube') continue;
      if (await db.catalog.remove('videos', id)) removed++;
    }
    if (removed) catalog.invalidate();
    await log(req, 'catalog.youtube.remove_imports', 'youtube', { scope, removed });
    res.set('Cache-Control', 'no-store');
    res.json({ scope, removed, skipped: ids.length - removed });
  }));

  // Multi-select actions on the admin's Videos & reels list. A bounded ID list keeps the request body small.
  router.post('/catalog/videos/bulk', wrap(async (req, res) => {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || ids.some((id) => typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) || new Set(ids).size !== ids.length) {
      throw bad('ids must be a list of 1–500 unique video IDs.');
    }
    if (!['hide', 'show', 'delete'].includes(action)) throw bad('action must be "hide", "show" or "delete".');
    const affectedIds = action === 'delete'
      ? await db.catalog.removeVideos(ids)
      : await db.catalog.setVideosHidden(ids, action === 'hide');
    if (affectedIds.length) catalog.invalidate();
    await log(req, `catalog.video.bulk_${action}`, 'videos', { requested: ids.length, affected: affectedIds.length, ids: affectedIds });
    res.json({ action, affected: affectedIds.length, skipped: ids.length - affectedIds.length, ids: affectedIds });
  }));

  // Full catalog including drafts and scheduled items (the public API hides those), plus first-party all-time play counts.
  router.get('/catalog', wrap(async (_req, res) => {
    const [s, playCounts] = await Promise.all([catalog.get({ all: true }), db.playStats.allTimeCounts()]);
    res.json({ ...s.catalog, playCounts, studio: s.studio });
  }));
  // Verify that an R2 video object actually exists in the configured bucket before saving a catalog entry pointing to it.
  const verifyR2Source = async (doc) => {
    if (doc?.source?.type !== 'r2') return;
    if (!r2.configured) throw new HttpError(503, 'storage_not_configured', 'Video storage (R2) is not configured on this server. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.');
    if (typeof r2.head !== 'function') return;
    let h;
    try { h = await r2.head(doc.source.key); }
    catch (e) { throw new HttpError(502, 'r2_unreachable', `Could not reach Cloudflare R2 to verify “${doc.source.key}” (${e?.message || 'network error'}). Check R2_ACCOUNT_ID and R2_ENDPOINT.`, { cause: e }); }
    if (h.status === 404) throw new HttpError(400, 'r2_object_missing', `The video file “${doc.source.key}” was not found in your R2 bucket${r2.bucket ? ` “${r2.bucket}”` : ''}. Click “Upload video” and wait for “Uploaded ✓”, or upload the file to R2 first.`);
    if (h.status === 403) throw new HttpError(502, 'r2_access_denied', `Cloudflare R2 rejected access to “${doc.source.key}”${r2.bucket ? ` in bucket “${r2.bucket}”` : ''} (HTTP 403). Check R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.`);
    if (h.status !== 200) throw new HttpError(502, 'r2_error', `Cloudflare R2 returned HTTP ${h.status} when checking “${doc.source.key}”.`);
  };
  // Create an item: validated by catalog-schema.js, stored in MySQL, then the cache is cleared so the site updates.
  router.post('/catalog/:type', wrap(async (req, res) => {
    const { key, type } = kindOf(req), snap = await catalog.get({ all: true });
    const { doc, errors } = validate(type, req.body, await ctxFor(snap, req.body)); if (errors.length) throw invalid(errors);
    await verifyR2Source(doc);
    try { await db.catalog.put(key, doc.id, doc, { create: true }); } catch (e) { if (isDuplicate(e)) throw new HttpError(409, 'exists', `A ${type} with the id “${doc.id}” already exists.`); throw e; }
    catalog.invalidate(); await log(req, `catalog.${type}.create`, doc.id, { title: doc.title || doc.caption || doc.id });
    res.status(201).json({ item: doc });
  }));
  // Drag-and-drop ordering. This route is declared before `/:id` so "order" is not mistaken for an id.
  router.put('/catalog/:type/order', wrap(async (req, res) => {
    const { key, type } = kindOf(req); if (key === 'videos') throw bad('Videos are ordered by date and episode number.');
    const ids = req.body?.ids; if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) throw bad('ids must be a list of ids.');
    const order = await db.catalog.reorder(key, ids); catalog.invalidate(); await log(req, `catalog.${type}.reorder`, null, { count: order.length });
    res.json({ ids: order });
  }));
  // Update (replace) an item. The id in the URL and in the body must match.
  router.put('/catalog/:type/:id', wrap(async (req, res) => {
    const { key, type } = kindOf(req), snap = await catalog.get({ all: true });
    const body = { ...(req.body || {}) }; if (body.id === undefined) body.id = req.params.id;
    if (body.id !== req.params.id) throw bad('An id can’t be changed — create a new item instead.');
    const { doc, errors } = validate(type, body, await ctxFor(snap, body)); if (errors.length) throw invalid(errors);
    await verifyR2Source(doc);
    if (!(await db.catalog.put(key, doc.id, doc))) throw new HttpError(404, 'not_found', `Unknown ${type}.`);
    catalog.invalidate(); await log(req, `catalog.${type}.update`, doc.id, { title: doc.title || doc.caption || doc.id });
    res.json({ item: doc });
  }));
  // Delete an item. Deleting a show that still has episodes needs `?cascade=1` so nothing disappears by accident.
  router.delete('/catalog/:type/:id', wrap(async (req, res) => {
    const { key, type } = kindOf(req), id = req.params.id, cascade = req.query.cascade === '1' || req.query.cascade === 'true';
    if (key === 'shows' && !cascade) { const n = await db.catalog.countVideosOf(id); if (n) throw new HttpError(409, 'has_videos', `This show has ${n} video(s). Delete them first, or delete the show together with its videos.`); }
    const out = await db.catalog.remove(key, id, { cascade }); if (!out) throw new HttpError(404, 'not_found', `Unknown ${type}.`);
    catalog.invalidate(); await log(req, `catalog.${type}.delete`, id, out.videos ? { videos: out.videos } : null);
    res.json({ ok: true, deletedVideos: out.videos });
  }));
  // The About/studio page content.
  router.put('/studio', wrap(async (req, res) => {
    const snap = await catalog.get({ all: true });
    const { doc, errors } = validate('studio', req.body, await ctxFor(snap, req.body)); if (errors.length) throw invalid(errors);
    await db.catalog.putStudio(doc); catalog.invalidate(); await log(req, 'catalog.studio.update'); res.json({ studio: doc });
  }));

  /* ---------- uploads ---------- */
  // Image upload: the raw file is the request body; the type is detected from its bytes (not the file name).
  // The file is saved in MySQL (durable, and shared by every server instance), then copied into the upload folder as a local cache.
  const keepUpload = async (file) => { await db.uploads.put(file.name, file.type, file.data); cacheUpload(uploadDir, file.name, file.data); };
  router.post('/uploads/image', express.raw({ type: () => true, limit: '10mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Send the image file as the request body.');
    const highName = req.get('x-image-variant-of');
    const saved = highName
      ? describeImageVariant(req.body, highName)
      : describeImage(req.body, { progressive: req.get('x-image-renditions') === 'progressive' });
    if (!saved) throw bad(highName ? 'The compact rendition must be WebP and match a saved high-quality upload.' : 'Only WebP, PNG, JPEG or GIF images are accepted.', 'unsupported_image');
    if (highName) {
      const high = await db.uploads.get(highName);
      if (!high) throw new HttpError(404, 'image_not_found', 'Upload the high-quality image before its compact rendition.');
      if (saved.bytes >= high.data.length) throw bad('The compact rendition must be smaller than the high-quality image.', 'invalid_image_variant');
    }
    await keepUpload(saved);
    await log(req, highName ? 'upload.image.variant' : 'upload.image', saved.path, { bytes: saved.bytes });
    res.status(201).json({ path: saved.path, bytes: saved.bytes, type: saved.type, ...(highName ? { variant: 'low' } : {}) });
  }));
  // Broadcast images live in private R2, not uploaded_files/MySQL. Their stable public app URL redirects
  // to a fresh short-lived R2 GET signature whenever a notification or e-mail client fetches the image.
  router.post('/uploads/broadcast-image', express.raw({ type: () => true, limit: '10mb' }), wrap(async (req, res) => {
    if (!r2?.configured || typeof r2.putObject !== 'function') {
      throw new HttpError(503, 'storage_not_configured', 'Broadcast photo storage (R2) is not configured on this server. Configure R2 with Object Read & Write access, then try again.');
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Send the image file as the request body.');
    const highName = req.get('x-image-variant-of');
    const saved = highName
      ? describeImageVariant(req.body, highName)
      : describeImage(req.body, { progressive: req.get('x-image-renditions') === 'progressive' });
    if (!saved) throw bad(highName ? 'The compact rendition must be WebP and match a high-quality upload.' : 'Only WebP, PNG, JPEG or GIF images are accepted.', 'unsupported_image');
    const key = `broadcast/${saved.name}`;
    try {
      await r2.putObject(key, saved.data, { contentType: saved.type, cacheControl: 'public, max-age=31536000, immutable' });
    } catch (e) {
      throw new HttpError(502, 'r2_upload_failed', `Could not upload the broadcast photo to Cloudflare R2${e?.statusCode ? ` (HTTP ${e.statusCode})` : ''}. Check the R2 credentials and try again.`, { cause: e });
    }
    const publicPath = `r2-assets/${key}`;
    await log(req, highName ? 'upload.broadcast_image.variant' : 'upload.broadcast_image', publicPath, { bytes: saved.bytes });
    res.status(201).json({ path: publicPath, bytes: saved.bytes, type: saved.type, ...(highName ? { variant: 'low' } : {}) });
  }));
  // Subtitle upload (.vtt or .srt; converted to WebVTT).
  router.post('/uploads/subtitle', express.raw({ type: () => true, limit: '2mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Send the .vtt or .srt file as the request body.');
    const saved = describeSubtitle(req.body); if (!saved) throw bad('That does not look like a WebVTT (.vtt) or SubRip (.srt) subtitle file.', 'unsupported_subtitle');
    await keepUpload(saved);
    await log(req, 'upload.subtitle', saved.path, { cues: saved.cues });
    res.status(201).json({ path: saved.path, cues: saved.cues, bytes: saved.bytes });
  }));
  /** Presigned PUT so the browser sends a big video straight to the private R2 bucket (never through this server). */
  // Returns a presigned URL so the browser uploads the big video file straight to R2 (it never passes through this server).
  router.post('/uploads/video', wrap(async (req, res) => {
    if (!r2.configured) throw new HttpError(503, 'storage_not_configured', 'Video storage (R2) is not configured on this server. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.');
    const k = videoKey(req.body?.filename, req.body?.slug, req.body?.contentType);
    if (!k) throw bad(`Unsupported file${req.body?.filename ? ` “${String(req.body.filename).slice(0, 80)}”` : ''}. Please select a valid video file.`, 'unsupported_video');
    const size = Number(req.body?.size);
    if (Number.isFinite(size) && size <= 0) throw bad('The selected video file is empty (0 bytes).', 'empty_video');
    if (Number.isFinite(size) && size > 5 * 1024 ** 3) throw bad('Single uploads are limited to 5 GB — split or compress the video.');
    await log(req, 'upload.video', k.key, { size: size || undefined });
    res.status(201).json({ key: k.key, format: k.format, contentType: k.contentType, uploadUrl: r2.presignPut(k.key, { ttl: 6 * 3600 }), expiresInSeconds: 6 * 3600 });
  }));

  // More admin endpoints (analytics, refund requests, notifications, support tickets, errors ...) live in admin-extra.js.
  adminExtraRoutes({ router, db, billing, catalog, push, mailer, campaigns, unsubscribeUrlFor, log, logger, siteUrl: siteUrl || billing.config.siteUrl, sms });
  // Credit & referrals (Admin → Promotions). Without a promos collaborator the section is simply absent,
  // exactly like the other optional features — the console hides it when /admin/promos answers 404.
  if (promos) adminPromoRoutes({ router, db, promos, log });
  // Maintenance mode (Admin → Maintenance). The console stays reachable while the switch is on, so this is
  // how an operator ends the window — see server/src/maintenance.js for the allow-list.
  if (maintenance) adminMaintenanceRoutes({ router, maintenance, log, siteUrl: siteUrl || billing.config.siteUrl || '' });
  return router;
}
