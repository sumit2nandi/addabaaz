import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError, bad, wrap, rateLimit } from './http.js';
import { isDuplicate } from './db.js';
import { verifyToken, sessionValid } from './auth.js';
import { PLANS, paidPlan } from './plans.js';
import { validate, TYPES } from './catalog-schema.js';
import { saveImage, videoKey } from './uploads.js';

const asInt = (v, what) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 0) throw bad(`${what} must be a whole number.`); return n; };
const asDate = (v, what) => { if (v === undefined || v === null || v === '') return null; const t = Date.parse(v); if (Number.isNaN(t)) throw bad(`${what} must be an ISO date.`); return new Date(t); };
const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
const page = (req, dflt = 25, max = 100) => ({ limit: Math.min(Math.max(Number(req.query.limit) || dflt, 1), max), offset: Math.max(Number(req.query.offset) || 0, 0) });

/**
 * The admin API (mounted at /api/v1/admin). Access = a signed-in ADMIN ACCOUNT (users.is_admin, granted with `npm run admin -- grant <email>`)
 * whose session is younger than `sessionHours`, or — for scripts — the shared ADMIN_TOKEN. Every change is written to the audit log.
 */
export function createAdminRouter({ db, billing, catalog, r2, payments, mailer, social, adminToken, secret, sessionHours = 12, uploadDir, mediaDir, rate = true, publicApiUrl = '', env = process.env }) {
  const tokenOn = adminToken.length >= 24;
  if (adminToken && !tokenOn) console.warn('[admin] ADMIN_TOKEN is shorter than 24 characters — the token is ignored (admin accounts still work).');
  const router = express.Router();

  router.use(rate ? rateLimit('admin', 600, 60_000) : (_q, _s, n) => n());
  router.use(wrap(async (req, _res, next) => {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!got) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    if (tokenOn && crypto.timingSafeEqual(digest(got), digest(adminToken))) { req.admin = { id: null, email: 'ADMIN_TOKEN', name: 'Admin token', via: 'token' }; return next(); }
    const payload = verifyToken(got, secret);
    if (!payload || payload.aud || !payload.sub) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    const user = await db.users.byId(String(payload.sub));
    if (!user || !sessionValid(payload, user)) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    if (user.disabledAt) throw new HttpError(403, 'account_disabled', 'This account is disabled.');
    if (!user.isAdmin) throw new HttpError(403, 'forbidden', 'This account is not an administrator.');
    if (Date.now() / 1000 - payload.iat > sessionHours * 3600) throw new HttpError(401, 'admin_session_expired', `For security, admin sessions last ${sessionHours} hours — please sign in again.`);
    req.admin = { id: user.id, email: user.email, name: user.name, via: 'session' };
    next();
  }));
  const log = (req, action, target = null, meta = null) => db.audit.add({ actorId: req.admin.id, actor: req.admin.email, action, target, meta, ip: req.ip }).catch((e) => console.error('[audit]', e.message));

  router.get('/session', (req, res) => res.json({ admin: req.admin, sessionHours, tokenEnabled: tokenOn }));

  /* ---------- dashboard & setup checklist ---------- */
  router.get('/stats', wrap(async (_req, res) => res.json(await db.stats.overview())));
  router.get('/health', wrap(async (_req, res) => {
    const dbUp = await db.ping().then(() => true, () => false);
    let uploads = false; try { fs.mkdirSync(uploadDir, { recursive: true }); fs.accessSync(uploadDir, fs.constants.W_OK); uploads = true; } catch { /* not writable */ }
    const prod = env.NODE_ENV === 'production';
    const indexing = env.ALLOW_INDEXING ? /^(1|true|yes)$/i.test(env.ALLOW_INDEXING) : prod;
    const item = (id, label, ok, detail, level = 'warn') => ({ id, label, ok, detail, level: ok ? 'ok' : level });
    res.json({ checks: [
      item('db', 'Database', dbUp, dbUp ? 'MySQL is reachable.' : 'MySQL is not reachable.', 'error'),
      item('jwt', 'Session secret', !!env.JWT_SECRET, env.JWT_SECRET ? 'JWT_SECRET is set.' : 'JWT_SECRET is not set — sessions use an insecure development secret.', prod ? 'error' : 'warn'),
      item('payments', 'Payments', payments.provider === 'razorpay', payments.provider === 'razorpay' ? 'Razorpay is connected.' : payments.provider === 'mock' ? 'Demo checkout — nobody is really charged.' : 'No payment provider: paid plans cannot be bought.'),
      item('gst', 'GST invoicing', billing.config.gstEnabled, billing.config.gstEnabled ? `Invoices are issued under GSTIN ${billing.config.gstin}.` : 'GSTIN is not set — purchases get plain receipts without GST.'),
      item('mail', 'Email', mailer.provider === 'smtp', mailer.provider === 'smtp' ? 'SMTP is configured.' : 'SMTP_URL is not set — receipts, refund and reminder emails are not sent.'),
      item('r2', 'Premium video storage (R2)', !!r2.configured, r2.configured ? `Bucket “${r2.bucket}” is configured.` : 'R2 is not configured — premium videos cannot play.'),
      item('google', 'Google sign-in', !!social.verifiers?.google, social.verifiers?.google ? 'Enabled.' : 'Not configured (optional).', 'info'),
      item('facebook', 'Facebook sign-in', !!social.verifiers?.facebook, social.verifiers?.facebook ? 'Enabled.' : 'Not configured (optional).', 'info'),
      item('uploads', 'Image uploads', uploads, uploads ? `Saved to ${uploadDir}${prod ? ' — make sure this folder is on a persistent volume.' : ''}` : `Cannot write to ${uploadDir}.`),
      item('site', 'Public site URL', !!env.PUBLIC_SITE_URL, env.PUBLIC_SITE_URL ? env.PUBLIC_SITE_URL : 'PUBLIC_SITE_URL is not set — links in emails, canonical URLs and the sitemap fall back to the address of each request. Set it to your https address (no trailing slash).', prod ? 'warn' : 'info'),
      item('indexing', 'Google indexing', indexing, indexing ? 'Search engines may index the site: robots.txt and /sitemap.xml are live.' : 'Search engines are told NOT to index this site (robots.txt disallows all). That is right for staging; on the live site set NODE_ENV=production or ALLOW_INDEXING=true.', prod ? 'warn' : 'info'),
      item('admins', 'Administrators', (await db.adminUsers.countAdmins()) > 0, `${await db.adminUsers.countAdmins()} admin account(s).`, 'warn'),
    ] });
  }));

  /* ---------- users ---------- */
  router.get('/users', wrap(async (req, res) => res.json(await db.adminUsers.list({ q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '', filter: String(req.query.filter || 'all'), ...page(req) }))));
  const userOr404 = async (id) => { const u = await db.adminUsers.get(String(id)); if (!u) throw new HttpError(404, 'not_found', 'Unknown user.'); return u; };
  router.get('/users/:id', wrap(async (req, res) => {
    const u = await userOr404(req.params.id);
    const [profiles, subscription, providers, pays] = await Promise.all([db.profiles.list(u.id), db.subscriptions.get(u.id), db.identities.providersOf(u.id), db.payments.listRecent({ userId: u.id, limit: 50 })]);
    res.json({ user: { ...u, providers }, profiles, subscription, payments: pays, spentPaise: pays.filter((p) => p.status === 'paid').reduce((n, p) => n + p.amountPaise - p.refundedPaise, 0) });
  }));
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
    const days = Number(b.days); if (!Number.isInteger(days) || days < 1 || days > 3650) throw bad('days must be a whole number from 1 to 3650.');
    const plan = paidPlan(b.planId || 'plus-monthly'); if (!plan) throw bad('Choose a paid plan.', 'unknown_plan');
    await db.subscriptions.extend(u.id, { planId: plan.id, days, provider: 'admin' });
    await log(req, 'user.grant', u.email, { days, planId: plan.id, note: typeof b.note === 'string' ? b.note.slice(0, 200) : undefined });
    res.json({ subscription: await db.subscriptions.get(u.id) });
  }));
  router.post('/users/:id/revoke-plan', wrap(async (req, res) => {
    const u = await userOr404(req.params.id);
    await db.subscriptions.clear(u.id); await log(req, 'user.revoke_plan', u.email);
    res.json({ subscription: await db.subscriptions.get(u.id) });
  }));
  router.delete('/users/:id', wrap(async (req, res) => {
    const u = await userOr404(req.params.id);
    if (req.admin.id === u.id) throw new HttpError(409, 'cannot_lock_yourself_out', 'You can’t delete your own account here — use the site’s Account page.');
    if (u.isAdmin && !u.disabledAt && (await db.adminUsers.countAdmins()) <= 1) throw new HttpError(409, 'last_admin', 'This is the last administrator.');
    await db.users.remove(u.id); await log(req, 'user.delete', u.email);
    res.sendStatus(204);
  }));

  /* ---------- payments, refunds, invoices ---------- */
  router.get('/payments', wrap(async (req, res) => {
    const f = { email: typeof req.query.email === 'string' && req.query.email.trim() ? req.query.email.trim().toLowerCase() : null, status: ['created', 'paid', 'failed'].includes(req.query.status) ? req.query.status : null };
    const { limit, offset } = page(req, 50, 200);
    res.json({ total: await db.payments.countAll(f), payments: await db.payments.listRecent({ ...f, limit, offset }) });
  }));
  router.post('/payments/:id/refund', wrap(async (req, res) => {
    const b = req.body || {};
    const rec = await billing.refund({ paymentId: req.params.id, amountPaise: b.amountPaise === undefined ? undefined : Number(b.amountPaise), reason: typeof b.reason === 'string' ? b.reason.trim() : '', revokeAccess: b.revokeAccess === true });
    await log(req, 'payment.refund', req.params.id, { amountPaise: rec.refund?.amountPaise, status: rec.refund?.status, revokeAccess: b.revokeAccess === true, reason: b.reason });
    res.status(201).json({ refund: rec.refund, creditNote: rec.creditNote && { id: rec.creditNote.id, number: rec.creditNote.number }, accessRevoked: rec.revoked });
  }));
  router.get('/invoices/:id/pdf', wrap(async (req, res) => { const f = await billing.adminInvoicePdf(req.params.id); res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'private, no-store' }); res.send(f.content); }));
  /** Sales register as CSV. from/to are IST calendar dates (inclusive); default = the current calendar month. */
  router.get('/invoices.csv', wrap(async (req, res) => {
    const ist = (d) => new Date(Date.parse(`${d}T00:00:00+05:30`));
    const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(ist(d).getTime());
    const now = new Date(Date.now() + 5.5 * 3600_000), monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const from = req.query.from === undefined ? monthStart : req.query.from, to = req.query.to === undefined ? now.toISOString().slice(0, 10) : req.query.to;
    if (!ok(from) || !ok(to)) throw bad('from and to must be dates like 2026-04-01.');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales-register-${from}_${to}.csv"` });
    res.send(await billing.registerCsv(ist(from), new Date(ist(to).getTime() + 86_400_000)));
  }));

  /* ---------- coupons ---------- */
  router.get('/coupons', wrap(async (_req, res) => res.json({ coupons: await db.coupons.list(), plans: PLANS.filter((p) => p.priceINR > 0).map((p) => ({ id: p.id, name: p.name, priceINR: p.priceINR })) })));
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
  router.delete('/coupons/:code', wrap(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!(await db.coupons.get(code))) throw new HttpError(404, 'not_found', 'Unknown coupon.');
    if (!(await db.coupons.remove(code))) throw new HttpError(409, 'coupon_used', 'This coupon has been used, so it is kept for the records — deactivate it instead.');
    await log(req, 'coupon.delete', code); res.sendStatus(204);
  }));

  /* ---------- contact messages ---------- */
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

  router.get('/audit', wrap(async (req, res) => res.json({ entries: await db.audit.list({ limit: Math.min(Number(req.query.limit) || 100, 300), before: Number(req.query.before) || null, action: typeof req.query.action === 'string' ? req.query.action.slice(0, 40) : null }) })));

  /* ---------- catalog (shows, videos, coming soon, gallery, studio) ---------- */
  const fileExists = (rel) => {
    const [top, ...rest] = rel.split('/'); const base = top === 'uploads' ? uploadDir : top === 'media' ? mediaDir : null;
    if (!base) return false;
    const file = path.resolve(base, ...rest); return file.startsWith(path.resolve(base) + path.sep) && fs.existsSync(file);
  };
  const ctxOf = (snap) => ({ fileExists, showIds: snap.showIds, upcomingIds: snap.upcomingIds });
  const kindOf = (req) => { if (!TYPES[req.params.type]) throw new HttpError(404, 'not_found', 'Unknown catalog section.'); return { key: req.params.type, type: TYPES[req.params.type] }; };
  const invalid = (errors) => new HttpError(400, 'invalid_item', errors.join(' '));

  router.get('/catalog', wrap(async (_req, res) => { const s = await catalog.get(); res.json({ ...s.catalog, studio: s.studio }); }));
  router.post('/catalog/:type', wrap(async (req, res) => {
    const { key, type } = kindOf(req), snap = await catalog.get();
    const { doc, errors } = validate(type, req.body, ctxOf(snap)); if (errors.length) throw invalid(errors);
    try { await db.catalog.put(key, doc.id, doc, { create: true }); } catch (e) { if (isDuplicate(e)) throw new HttpError(409, 'exists', `A ${type} with the id “${doc.id}” already exists.`); throw e; }
    catalog.invalidate(); await log(req, `catalog.${type}.create`, doc.id, { title: doc.title || doc.caption || doc.id });
    res.status(201).json({ item: doc });
  }));
  router.put('/catalog/:type/order', wrap(async (req, res) => {
    const { key, type } = kindOf(req); if (key === 'videos') throw bad('Videos are ordered by date and episode number.');
    const ids = req.body?.ids; if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) throw bad('ids must be a list of ids.');
    const order = await db.catalog.reorder(key, ids); catalog.invalidate(); await log(req, `catalog.${type}.reorder`, null, { count: order.length });
    res.json({ ids: order });
  }));
  router.put('/catalog/:type/:id', wrap(async (req, res) => {
    const { key, type } = kindOf(req), snap = await catalog.get();
    const body = { ...(req.body || {}) }; if (body.id === undefined) body.id = req.params.id;
    if (body.id !== req.params.id) throw bad('An id can’t be changed — create a new item instead.');
    const { doc, errors } = validate(type, body, ctxOf(snap)); if (errors.length) throw invalid(errors);
    if (!(await db.catalog.put(key, doc.id, doc))) throw new HttpError(404, 'not_found', `Unknown ${type}.`);
    catalog.invalidate(); await log(req, `catalog.${type}.update`, doc.id, { title: doc.title || doc.caption || doc.id });
    res.json({ item: doc });
  }));
  router.delete('/catalog/:type/:id', wrap(async (req, res) => {
    const { key, type } = kindOf(req), id = req.params.id, cascade = req.query.cascade === '1' || req.query.cascade === 'true';
    if (key === 'shows' && !cascade) { const n = await db.catalog.countVideosOf(id); if (n) throw new HttpError(409, 'has_videos', `This show has ${n} video(s). Delete them first, or delete the show together with its videos.`); }
    const out = await db.catalog.remove(key, id, { cascade }); if (!out) throw new HttpError(404, 'not_found', `Unknown ${type}.`);
    catalog.invalidate(); await log(req, `catalog.${type}.delete`, id, out.videos ? { videos: out.videos } : null);
    res.json({ ok: true, deletedVideos: out.videos });
  }));
  router.put('/studio', wrap(async (req, res) => {
    const { doc, errors } = validate('studio', req.body, { fileExists }); if (errors.length) throw invalid(errors);
    await db.catalog.putStudio(doc); catalog.invalidate(); await log(req, 'catalog.studio.update'); res.json({ studio: doc });
  }));

  /* ---------- uploads ---------- */
  router.post('/uploads/image', express.raw({ type: () => true, limit: '4mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Send the image file as the request body.');
    const saved = saveImage(req.body, uploadDir); if (!saved) throw bad('Only WebP, PNG, JPEG or GIF images are accepted.', 'unsupported_image');
    await log(req, 'upload.image', saved.path, { bytes: saved.bytes });
    res.status(201).json({ path: saved.path, bytes: saved.bytes, type: saved.type });
  }));
  /** Presigned PUT so the browser sends a big video straight to the private R2 bucket (never through this server). */
  router.post('/uploads/video', wrap(async (req, res) => {
    if (!r2.configured) throw new HttpError(503, 'storage_not_configured', 'Video storage (R2) is not configured on this server.');
    const k = videoKey(req.body?.filename, req.body?.slug); if (!k) throw bad('Upload an .mp4, .m4v or .webm file.', 'unsupported_video');
    const size = Number(req.body?.size); if (Number.isFinite(size) && size > 5 * 1024 ** 3) throw bad('Single uploads are limited to 5 GB — split or compress the video.');
    await log(req, 'upload.video', k.key, { size: size || undefined });
    res.status(201).json({ key: k.key, format: k.format, contentType: k.contentType, uploadUrl: r2.presignPut(k.key, { ttl: 6 * 3600 }), expiresInSeconds: 6 * 3600 });
  }));

  return router;
}
