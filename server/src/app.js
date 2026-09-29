import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDuplicate } from './db.js';
import { hashPassword, verifyPassword, signToken, signJwt, verifyToken } from './auth.js';
import { createR2 } from './r2.js';
import { socialFromEnv, SocialError } from './social.js';
import { PLANS, paidPlan } from './plans.js';
import { paymentsFromEnv } from './payments.js';
import { mailerFromEnv } from './mailer.js';
import { createBilling, billingConfigFromEnv } from './billing.js';
import { STATES } from './gst.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const MAX_PROFILES = 5, PALETTE = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const bad = (msg, code = 'bad_request') => new HttpError(400, code, msg);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Sliding-window in-memory rate limiter (per IP + bucket). Use Redis/edge limits when running multiple nodes. */
function rateLimit(bucket, max, windowMs) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = `${bucket}:${req.ip}`; const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return next(new HttpError(429, 'rate_limited', 'Too many requests — please try again shortly.'));
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    next();
  };
}

/**
 * @param {object} opts
 * @param {object} opts.db  MySQL data layer from createDb() (required; run migrate() first)
 */
export function createApp({
  db,
  jwtSecret = process.env.JWT_SECRET,
  corsOrigins = process.env.CORS_ORIGINS || '*',
  serveStatic = true,
  payments = paymentsFromEnv(),                               // { provider: 'razorpay' | 'mock' | 'none' }
  mailer = mailerFromEnv(),                                   // SMTP (receipts, refunds, reminders); no-op without SMTP_URL
  billing = createBilling({ db, payments, mailer, config: billingConfigFromEnv() }),   // coupons, GST invoices, refunds
  adminToken = process.env.ADMIN_TOKEN || '',                 // enables /admin/* (≥24 chars); unset = admin API is off
  contactWebhook = process.env.CONTACT_WEBHOOK_URL || '',
  rate = true,
  catalogPath = path.join(ROOT, 'data/catalog.json'),
  r2 = createR2(),                                            // Cloudflare R2 (private bucket for premium video)
  social = socialFromEnv(),                                   // { config, verifiers: { google?, facebook? } }
  publicApiUrl = process.env.PUBLIC_API_URL || '',            // absolute base for HLS URLs when behind a proxy
  streamTtl = Number(process.env.STREAM_URL_TTL) || 6 * 3600, // seconds a signed video URL stays valid
} = {}) {
  if (!db) throw new Error('createApp: a database (createDb()) is required');
  const production = process.env.NODE_ENV === 'production';
  if (production && !jwtSecret) throw new Error('JWT_SECRET must be set in production');
  if (!jwtSecret) console.warn('[auth] JWT_SECRET not set — using an insecure development secret. Set JWT_SECRET before deploying.');
  const secret = jwtSecret || 'insecure-development-secret';
  const loadCatalog = () => JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  let catalog = loadCatalog(); let catalogMtime = fs.statSync(catalogPath).mtimeMs;
  const cat = () => { const m = fs.statSync(catalogPath).mtimeMs; if (m !== catalogMtime) { catalog = loadCatalog(); catalogMtime = m; } return catalog; };
  const exists = (type, id) => {
    const c = cat();
    return type === 'show' ? c.shows.some((s) => s.id === id) : type === 'video' ? c.videos.some((v) => v.id === id) : type === 'upcoming' ? c.upcoming.some((u) => u.id === id) : false;
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    const origin = req.headers.origin;
    if (origin && (corsOrigins === '*' || corsOrigins.split(',').map((s) => s.trim()).includes(origin))) {
      res.set({ 'Access-Control-Allow-Origin': corsOrigins === '*' ? '*' : origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '50kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));   // rawBody: payment webhooks are signed over the exact bytes

  /* ---------- public ---------- */
  api.get('/health', wrap(async (_req, res) => {                 // liveness + discovery: always 200; `db` reports the database state
    const dbUp = await db.ping().then(() => true, () => false);
    res.json({ ok: true, service: 'addabaaz', version: VERSION, db: dbUp ? 'up' : 'down', storage: r2.configured ? 'r2' : 'none', payments: payments.provider, time: new Date().toISOString() });
  }));
  api.get('/health/ready', wrap(async (_req, res) => {           // readiness for load balancers / orchestrators: 503 when MySQL is unreachable
    const dbUp = await db.ping().then(() => true, () => false);
    res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? 'up' : 'down' });
  }));
  api.get('/catalog', (req, res) => { res.set('Cache-Control', 'public, max-age=60'); res.json(cat()); });
  api.get('/plans', (_req, res) => res.json({
    plans: PLANS,
    payments: { provider: payments.provider, ...(payments.provider === 'razorpay' ? { keyId: payments.keyId } : {}), ...(payments.provider === 'mock' ? { demo: true } : {}) },
    billing: { gst: billing.config.gstEnabled, coupons: payments.provider === 'razorpay', states: STATES },
  }));

  const authLimit = rate ? rateLimit('auth', 20, 60_000) : (_q, _s, n) => n();
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

  api.post('/auth/signup', authLimit, wrap(async (req, res) => {
    const { name = '', email = '', password = '' } = req.body || {};
    if (typeof email !== 'string' || !EMAIL.test(email.trim()) || email.length > 254) throw bad('Please enter a valid email address.', 'invalid_email');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw bad('Password must be 8–128 characters.', 'weak_password');
    if (typeof name !== 'string' || !name.trim() || name.length > 60) throw bad('Please enter your name.', 'invalid_name');
    const user = { id: crypto.randomUUID(), email: email.trim().toLowerCase(), name: name.trim(), passwordHash: hashPassword(password) };
    const profile = { id: crypto.randomUUID(), name: user.name.split(/\s+/)[0].slice(0, 24), color: 0 };
    try { await db.users.createWithProfile(user, profile); }
    catch (e) {
      if (!isDuplicate(e)) throw e;
      const ex = await db.users.byEmail(user.email);
      throw new HttpError(409, 'email_taken', ex && !ex.passwordHash ? 'This email is already registered — use “Continue with Google/Facebook” to sign in.' : 'An account with this email already exists.');
    }
    res.status(201).json({ token: signToken(user.id, secret), user: publicUser(user), profiles: [profile] });
  }));
  api.post('/auth/login', authLimit, wrap(async (req, res) => {
    const { email = '', password = '' } = req.body || {};
    const user = await db.users.byEmail(String(email).trim().toLowerCase());
    // Always run a hash to keep timing similar whether or not the user exists.
    const ok = user?.passwordHash ? verifyPassword(String(password), user.passwordHash) : (verifyPassword(String(password), 'scrypt$00$00'), false);   // social-only accounts have no password
    if (!ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
    res.json({ token: signToken(user.id, secret), user: publicUser(user) });
  }));

  /* ---------- social sign-in ---------- */
  api.get('/auth/providers', (_req, res) => res.json({ password: true, ...social.config }));
  async function socialSignIn(provider, credential) {
    const verifier = social.verifiers?.[provider];
    if (!verifier) throw new HttpError(501, 'provider_not_configured', `${provider === 'google' ? 'Google' : 'Facebook'} sign-in isn’t enabled on this server.`);
    let claims;
    try { claims = await verifier(credential); }
    catch (e) { if (e instanceof SocialError) throw new HttpError(e.code === 'provider_unavailable' ? 503 : 401, e.code, e.message); throw e; }
    const ident = { provider, subject: claims.subject, email: claims.email };
    let user = await db.identities.userFor(provider, claims.subject), isNew = false;
    if (!user) {
      if (!claims.email) throw bad(`${provider === 'google' ? 'Google' : 'Facebook'} didn’t share an email address. Please sign up with email instead.`, 'email_required');
      if (!claims.emailVerified) throw bad('Your email address isn’t verified with the provider.', 'email_unverified');
      user = await db.users.byEmail(claims.email);
      if (user) await db.identities.link(user.id, ident);              // same verified email → same person: link the provider
      else {
        const name = (claims.name || claims.email.split('@')[0]).trim().slice(0, 60);
        const fresh = { id: crypto.randomUUID(), email: claims.email, name };
        const profile = { id: crypto.randomUUID(), name: name.split(/\s+/)[0].slice(0, 24), color: 0 };
        try { await db.identities.createUser(fresh, profile, ident); user = fresh; isNew = true; }
        catch (e) {
          if (!isDuplicate(e)) throw e;                                   // lost a race with a parallel request: use the winner
          user = (await db.identities.userFor(provider, claims.subject)) || (await db.users.byEmail(claims.email));
          if (user) await db.identities.link(user.id, ident);
        }
      }
    }
    if (!user) throw new HttpError(500, 'server_error', 'Something went wrong.');
    await db.identities.touch(provider, claims.subject);
    return { token: signToken(user.id, secret), user: publicUser(user), profiles: await db.profiles.list(user.id), isNew };
  }
  api.post('/auth/google', authLimit, wrap(async (req, res) => res.json(await socialSignIn('google', req.body?.idToken))));
  api.post('/auth/facebook', authLimit, wrap(async (req, res) => res.json(await socialSignIn('facebook', req.body?.accessToken))));

  /* ---------- premium video (Cloudflare R2) ---------- */
  const userFromRequest = async (req) => {
    const h = req.headers.authorization || '';
    const payload = h.startsWith('Bearer ') ? verifyToken(h.slice(7), secret) : null;
    return payload && !payload.aud && payload.sub ? db.users.byId(String(payload.sub)) : null;      // media/other scoped tokens are not sessions
  };
  const findVideo = (id) => cat().videos.find((v) => v.id === id);
  const originOf = (req) => (publicApiUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const r2Format = (src) => src.format || (/\.m3u8$/i.test(src.key) ? 'hls' : 'mp4');
  /** Returns a playable URL for a video hosted in R2. Premium titles need a signed-in account with an active paid plan. */
  api.post('/videos/:id/stream', wrap(async (req, res) => {
    const v = findVideo(req.params.id);
    if (!v) throw new HttpError(404, 'not_found', 'Unknown video.');
    if (v.source?.type !== 'r2') throw new HttpError(400, 'not_hosted', 'This video is not hosted in R2.');
    if (v.access === 'premium') {
      const user = await userFromRequest(req);
      if (!user) throw new HttpError(401, 'login_required', 'Please sign in to watch premium videos.');
      if ((await db.subscriptions.get(user.id)).planId === 'free') throw new HttpError(402, 'subscription_required', 'Subscribe to ADDABAAZ Plus to watch this video.');   // premium = signed in AND paid
      req.user = user;
    }
    if (!r2.configured) throw new HttpError(503, 'storage_not_configured', 'Video storage is not configured on this server.');
    const format = r2Format(v.source), expiresAt = new Date(Date.now() + streamTtl * 1000).toISOString();
    res.set('Cache-Control', 'no-store');
    if (format === 'hls') {   // segments can't be pre-signed one by one, so playback goes through the token gateway below
      const token = signJwt({ aud: 'media', vid: v.id, sub: req.user?.id || null }, secret, streamTtl);
      return res.json({ type: 'hls', url: `${originOf(req)}/api/v1/media/${token}/${encodeURIComponent(v.source.key.split('/').pop())}`, expiresAt });
    }
    res.json({ type: 'mp4', url: r2.presignGet(v.source.key, { ttl: streamTtl }), expiresAt });
  }));
  /** HLS gateway: playlists are proxied (so relative URLs stay on this gateway); media segments are redirected to short-lived R2 URLs. */
  api.get('/media/:token/*', wrap(async (req, res) => {
    const claims = verifyToken(req.params.token, secret);
    if (!claims || claims.aud !== 'media') throw new HttpError(401, 'invalid_token', 'This playback link has expired.');
    const v = findVideo(claims.vid);
    if (!v || v.source?.type !== 'r2' || r2Format(v.source) !== 'hls') throw new HttpError(404, 'not_found', 'Unknown video.');
    if (!r2.configured) throw new HttpError(503, 'storage_not_configured', 'Video storage is not configured on this server.');
    const dir = path.posix.dirname(v.source.key);
    const rest = req.params[0];                                  // Express has already URL-decoded it once
    const target = path.posix.normalize(`${dir}/${rest}`);
    if (rest.includes('\0') || rest.startsWith('/') || !target.startsWith(dir === '.' ? '' : dir + '/') || target.split('/').includes('..')) throw new HttpError(404, 'not_found', 'Not found.');
    if (/\.m3u8$/i.test(target)) {
      const text = await r2.getText(target);
      if (text == null) throw new HttpError(404, 'not_found', 'Not found.');
      return res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }).send(text);
    }
    res.set('Cache-Control', 'no-store').redirect(302, r2.presignGet(target, { ttl: 900 }));
  }));

  api.post('/contact', rate ? rateLimit('contact', 5, 10 * 60_000) : (_q, _s, n) => n(), wrap(async (req, res) => {
    const { name = '', email = '', phone = '', message = '', website = '' } = req.body || {};
    if (website) return res.status(202).json({ ok: true });          // honeypot
    if (!String(name).trim() || !EMAIL.test(String(email).trim()) || !String(message).trim()) throw bad('Name, a valid email and a message are required.');
    if (String(message).length > 5000 || String(name).length > 100 || String(phone).length > 40 || String(email).length > 254) throw bad('One of the fields is too long.');
    const entry = { id: crypto.randomUUID(), name: String(name).trim(), email: String(email).trim(), phone: String(phone).trim(), message: String(message).trim(), at: new Date().toISOString() };
    await db.contacts.add(entry);
    if (contactWebhook) fetch(contactWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch((e) => console.warn('[contact] webhook failed', e.message));
    res.status(202).json({ ok: true });
  }));

  /** Razorpay → us. Public but signed: activates the plan even if the buyer closed the tab after paying. */
  api.post('/payments/webhook', wrap(async (req, res) => {
    if (payments.provider !== 'razorpay') return res.sendStatus(404);
    if (!payments.verifyWebhook(req.rawBody, req.headers['x-razorpay-signature'])) throw bad('Bad signature.', 'invalid_signature');
    const ev = req.body?.event, pe = req.body?.payload?.payment?.entity, re = req.body?.payload?.refund?.entity;
    if ((ev === 'payment.captured' || ev === 'order.paid') && pe?.order_id && pe?.id && (pe.status === 'captured' || ev === 'order.paid')) {
      const pay = await db.payments.byOrder('razorpay', pe.order_id);
      if (pay && pay.amountPaise === pe.amount && pe.currency === 'INR') await billing.settle(pay, pe.id);
      else console.warn('[payments] webhook for unknown order or amount mismatch', pe.order_id);
    } else if (ev === 'payment.failed') await billing.onPaymentFailed(pe);
    else if (/^refund\.(created|processed|failed)$/.test(ev || '')) await billing.onRefundEvent(re);
    res.json({ ok: true });                                               // always 200 for valid signatures so Razorpay doesn't retry forever
  }));

  /* ---------- admin API (ADMIN_TOKEN) — refunds, coupons, accounting export ---------- */
  const adminOn = adminToken.length >= 24;
  if (adminToken && !adminOn) console.warn('[admin] ADMIN_TOKEN is shorter than 24 characters — the admin API stays disabled.');
  const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
  const adminAuth = (req, _res, next) => {
    if (!adminOn) return next(new HttpError(404, 'not_found', 'Unknown endpoint.'));
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!crypto.timingSafeEqual(digest(got), digest(adminToken))) return next(new HttpError(401, 'unauthorized', 'Invalid admin token.'));
    next();
  };
  const admin = express.Router();
  admin.use(rate ? rateLimit('admin', 60, 60_000) : (_q, _s, n) => n(), adminAuth);
  const asInt = (v, what) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 0) throw bad(`${what} must be a whole number.`); return n; };
  const asDate = (v, what) => { if (v === undefined || v === null || v === '') return null; const t = Date.parse(v); if (Number.isNaN(t)) throw bad(`${what} must be an ISO date.`); return new Date(t); };
  admin.get('/payments', wrap(async (req, res) => res.json({ payments: await db.payments.listRecent({ email: typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : null, limit: Math.min(Number(req.query.limit) || 50, 200) }) })));
  admin.post('/payments/:id/refund', wrap(async (req, res) => {
    const b = req.body || {};
    const rec = await billing.refund({ paymentId: req.params.id, amountPaise: b.amountPaise === undefined ? undefined : Number(b.amountPaise), reason: typeof b.reason === 'string' ? b.reason.trim() : '', revokeAccess: b.revokeAccess === true });
    res.status(201).json({ refund: rec.refund, creditNote: rec.creditNote && { id: rec.creditNote.id, number: rec.creditNote.number }, accessRevoked: rec.revoked });
  }));
  admin.get('/coupons', wrap(async (_req, res) => res.json({ coupons: await db.coupons.list() })));
  admin.post('/coupons', wrap(async (req, res) => {
    const b = req.body || {}, code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw bad('Code must be 3–30 characters: letters, digits, "-" or "_".');
    if (!['percent', 'flat'].includes(b.kind)) throw bad('kind must be "percent" or "flat".');
    const value = asInt(b.value, 'value');
    if (b.kind === 'percent' ? !(value >= 1 && value <= 100) : !(value >= 100)) throw bad(b.kind === 'percent' ? 'A percent coupon must be 1–100.' : 'A flat coupon is in paise, at least 100 (₹1).');
    const planIds = Array.isArray(b.planIds) && b.planIds.length ? b.planIds.map(String) : null;
    if (planIds?.some((id) => !paidPlan(id))) throw bad('planIds must be paid plan ids.');
    const perUserLimit = asInt(b.perUserLimit ?? 1, 'perUserLimit'); if (!(perUserLimit >= 1)) throw bad('perUserLimit must be at least 1.');
    try {
      res.status(201).json({ coupon: await db.coupons.create({ code, description: typeof b.description === 'string' ? b.description.slice(0, 120) : null, kind: b.kind, value, planIds, maxRedemptions: asInt(b.maxRedemptions, 'maxRedemptions'), perUserLimit, startsAt: asDate(b.startsAt, 'startsAt'), expiresAt: asDate(b.expiresAt, 'expiresAt') }) });
    } catch (e) { if (isDuplicate(e)) throw new HttpError(409, 'exists', 'A coupon with that code already exists.'); throw e; }
  }));
  admin.patch('/coupons/:code', wrap(async (req, res) => {
    const code = String(req.params.code).toUpperCase(), b = req.body || {};
    if (!(await db.coupons.get(code))) throw new HttpError(404, 'not_found', 'Unknown coupon.');
    const patch = {};
    if (b.active !== undefined) patch.active = !!b.active;
    if ('expiresAt' in b) patch.expiresAt = asDate(b.expiresAt, 'expiresAt');
    if ('startsAt' in b) patch.startsAt = asDate(b.startsAt, 'startsAt');
    if ('maxRedemptions' in b) patch.maxRedemptions = asInt(b.maxRedemptions, 'maxRedemptions');
    if (b.perUserLimit !== undefined) { patch.perUserLimit = asInt(b.perUserLimit, 'perUserLimit'); if (!(patch.perUserLimit >= 1)) throw bad('perUserLimit must be at least 1.'); }
    if (typeof b.description === 'string') patch.description = b.description.slice(0, 120);
    res.json({ coupon: await db.coupons.update(code, patch) });
  }));
  /** Sales register as CSV. from/to are IST calendar dates (inclusive); default = the current calendar month. */
  admin.get('/invoices.csv', wrap(async (req, res) => {
    const ist = (d) => new Date(Date.parse(`${d}T00:00:00+05:30`));
    const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(ist(d).getTime());
    const now = new Date(Date.now() + 5.5 * 3600_000), monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const from = req.query.from === undefined ? monthStart : req.query.from, to = req.query.to === undefined ? now.toISOString().slice(0, 10) : req.query.to;
    if (!ok(from) || !ok(to)) throw bad('from and to must be dates like 2026-04-01.');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales-register-${from}_${to}.csv"` });
    res.send(await billing.registerCsv(ist(from), new Date(ist(to).getTime() + 86_400_000)));
  }));
  admin.get('/invoices/:id/pdf', wrap(async (req, res) => { const f = await billing.adminInvoicePdf(req.params.id); res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'private, no-store' }); res.send(f.content); }));
  api.use('/admin', admin);

  /* ---------- authenticated ---------- */
  api.use(wrap(async (req, _res, next) => {
    const h = req.headers.authorization || '';
    const payload = h.startsWith('Bearer ') ? verifyToken(h.slice(7), secret) : null;
    const user = payload && !payload.aud && await db.users.byId(String(payload.sub));
    if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    req.user = user; next();
  }));
  const ownProfile = async (req) => {
    const p = await db.profiles.get(req.params.pid, req.user.id);
    if (!p) throw new HttpError(404, 'not_found', 'Profile not found.');
    return p;
  };

  api.get('/me', wrap(async (req, res) => res.json({ user: publicUser(req.user), hasPassword: !!req.user.passwordHash, providers: await db.identities.providersOf(req.user.id), profiles: await db.profiles.list(req.user.id), subscription: await db.subscriptions.get(req.user.id) })));
  api.patch('/me', wrap(async (req, res) => {
    const n = req.body?.name; if (typeof n !== 'string' || !n.trim() || n.length > 60) throw bad('Please enter your name.');
    await db.users.rename(req.user.id, n.trim()); res.json({ user: publicUser({ ...req.user, name: n.trim() }) });
  }));
  api.delete('/me', wrap(async (req, res) => {           // required by Apple App Store guideline 5.1.1(v) & Google Play policy
    await db.users.remove(req.user.id);                   // FK cascades remove profiles, library and subscription
    res.sendStatus(204);
  }));

  /* profiles */
  const cleanProfile = (b, partial = false) => {
    const out = {};
    if (!partial || b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 24) throw bad('Profile name must be 1–24 characters.'); out.name = b.name.trim(); }
    if (b.color !== undefined) { if (!Number.isInteger(b.color) || b.color < 0 || b.color >= PALETTE) throw bad('Invalid colour.'); out.color = b.color; }
    return out;
  };
  api.get('/profiles', wrap(async (req, res) => res.json({ profiles: await db.profiles.list(req.user.id) })));
  api.post('/profiles', wrap(async (req, res) => {
    const { name } = cleanProfile(req.body || {});
    const profile = await db.profiles.create(req.user.id, { id: crypto.randomUUID(), name }, MAX_PROFILES, PALETTE);
    if (!profile) throw new HttpError(409, 'profile_limit', `You can have up to ${MAX_PROFILES} profiles.`);
    res.status(201).json({ profile });
  }));
  api.patch('/profiles/:pid', wrap(async (req, res) => {
    const p = await ownProfile(req); res.json({ profile: await db.profiles.update(p.id, cleanProfile(req.body || {}, true)) });
  }));
  api.delete('/profiles/:pid', wrap(async (req, res) => {
    const p = await ownProfile(req);
    if (!(await db.profiles.remove(p.id, req.user.id))) throw new HttpError(409, 'last_profile', 'At least one profile is required.');
    res.sendStatus(204);
  }));

  /* library: My List, progress, reminders */
  api.get('/profiles/:pid/library', wrap(async (req, res) => { const p = await ownProfile(req); res.json(await db.library.get(p.id)); }));
  api.put('/profiles/:pid/list/:type/:id', wrap(async (req, res) => {
    const p = await ownProfile(req); const { type, id } = req.params;
    if (!exists(type, id)) throw new HttpError(404, 'not_found', 'Unknown title.');
    await db.library.addListItem(p.id, type, id); res.sendStatus(204);
  }));
  api.delete('/profiles/:pid/list/:type/:id', wrap(async (req, res) => {
    const p = await ownProfile(req); await db.library.removeListItem(p.id, req.params.type, req.params.id); res.sendStatus(204);
  }));
  api.put('/profiles/:pid/progress/:videoId', wrap(async (req, res) => {
    const p = await ownProfile(req); const { position, duration } = req.body || {};
    if (!exists('video', req.params.videoId)) throw new HttpError(404, 'not_found', 'Unknown video.');
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration ?? 0) || (duration ?? 0) < 0) throw bad('position and duration must be non-negative numbers.');
    await db.library.saveProgress(p.id, req.params.videoId, Math.min(Math.floor(position), 4_294_967_295), Math.min(Math.floor(duration || 0), 4_294_967_295));
    res.sendStatus(204);
  }));
  api.delete('/profiles/:pid/progress/:videoId', wrap(async (req, res) => { const p = await ownProfile(req); await db.library.removeProgress(p.id, req.params.videoId); res.sendStatus(204); }));
  api.put('/profiles/:pid/reminders/:id', wrap(async (req, res) => {
    const p = await ownProfile(req); if (!exists('upcoming', req.params.id)) throw new HttpError(404, 'not_found', 'Unknown title.');
    await db.library.addReminder(p.id, req.params.id); res.sendStatus(204);
  }));
  api.delete('/profiles/:pid/reminders/:id', wrap(async (req, res) => { const p = await ownProfile(req); await db.library.removeReminder(p.id, req.params.id); res.sendStatus(204); }));

  /* ---------- subscription & payments ---------- */
  api.get('/subscription', wrap(async (req, res) => res.json({ subscription: await db.subscriptions.get(req.user.id) })));
  const payLimit = rate ? rateLimit('pay', 20, 60_000) : (_q, _s, n) => n();

  /** Price preview: applies a coupon (and tells the viewer why it doesn't work). */
  api.post('/payments/quote', payLimit, wrap(async (req, res) => {
    if (payments.provider !== 'razorpay') throw new HttpError(501, 'payments_not_configured', 'Coupons need live payments.');
    res.json({ quote: billing.quoteView(await billing.quote(req.user.id, req.body?.planId, req.body?.couponCode)) });
  }));

  /** Step 1: start a purchase. Razorpay → returns the order for Checkout (coupon + GST billing details applied). Demo provider → activates immediately. */
  api.post('/payments/checkout', payLimit, wrap(async (req, res) => {
    const plan = paidPlan(req.body?.planId);
    if (!plan) throw bad('Choose a paid plan.', 'unknown_plan');
    if (payments.provider === 'none') throw new HttpError(501, 'payments_not_configured', 'Payments are not configured on this server.');
    if (payments.provider === 'mock') {
      await db.subscriptions.activateDemo(req.user.id, plan.id, plan.days);
      return res.status(201).json({ provider: 'mock', demo: true, subscription: await db.subscriptions.get(req.user.id) });
    }
    res.status(201).json(await billing.checkout({ user: req.user, planId: plan.id, couponCode: req.body?.couponCode, billing: req.body?.billing }));
  }));

  /** Step 3: the browser reports a finished payment. Nothing is granted unless the signature is valid for OUR order. */
  api.post('/payments/verify', payLimit, wrap(async (req, res) => {
    if (payments.provider !== 'razorpay') throw new HttpError(501, 'payments_not_configured', 'Payments are not configured on this server.');
    const { orderId, paymentId, signature } = req.body || {};
    const pay = typeof orderId === 'string' ? await db.payments.byOrder('razorpay', orderId) : null;
    if (!pay || pay.userId !== req.user.id) throw new HttpError(404, 'not_found', 'Unknown order.');            // also blocks using someone else's order
    if (!payments.verifyPayment({ orderId, paymentId, signature })) throw new HttpError(400, 'invalid_signature', 'Payment could not be verified. If money was deducted it will be reversed automatically, or contact support.');
    await billing.settle(pay, paymentId);                                                                          // idempotent; issues the invoice
    res.json({ subscription: await db.subscriptions.get(req.user.id) });
  }));

  /* ---------- billing history & documents ---------- */
  api.get('/billing', wrap(async (req, res) => res.json({ payments: await billing.history(req.user.id) })));
  api.get('/invoices/:id/pdf', wrap(async (req, res) => {
    const f = await billing.invoicePdf(req.user.id, req.params.id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'private, no-store' }); res.send(f.content);
  }));
  api.post('/invoices/:id/email', payLimit, wrap(async (req, res) => { await billing.emailInvoice(req.user, req.params.id); res.sendStatus(204); }));

  /** Cancelling only applies to demo plans: real plans are prepaid, don't renew and simply run out. */
  api.delete('/subscription', wrap(async (req, res) => {
    const sub = await db.subscriptions.get(req.user.id);
    if (sub.planId !== 'free' && !sub.demo) throw new HttpError(409, 'not_cancellable', `Your plan is prepaid and doesn’t renew automatically — it stays active until ${new Date(sub.expiresAt).toDateString()}.`);
    await db.subscriptions.clear(req.user.id);
    res.json({ subscription: await db.subscriptions.get(req.user.id) });
  }));

  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Unknown endpoint.')));
  app.use('/api/v1', api);

  /* ---------- static site (same origin => the web app auto-detects this API) ---------- */
  if (serveStatic) {
    const opts = (maxAge) => ({ maxAge, index: false, dotfiles: 'ignore' });
    app.get(['/', '/index.html'], (_q, res) => res.sendFile(path.join(ROOT, 'index.html')));
    app.get('/manifest.webmanifest', (_q, res) => res.sendFile(path.join(ROOT, 'manifest.webmanifest')));
    app.get('/sw.js', (_q, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(ROOT, 'sw.js')); });
    app.use('/app', express.static(path.join(ROOT, 'app'), { ...opts(0), etag: true }));
    app.use('/data', express.static(path.join(ROOT, 'data'), opts(60_000)));
    app.use('/media', express.static(path.join(ROOT, 'media'), opts(86_400_000)));
  }

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = bad('Invalid JSON body.', 'invalid_json');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'too_large', 'Request too large.');
    const status = err.status || 500;
    if (status >= 500 && !(err instanceof HttpError)) console.error(err);   // expected 5xx (provider down, storage off) are not logged as crashes
    res.status(status).json({ error: { code: err.code || 'server_error', message: status === 500 ? 'Something went wrong.' : err.message } });
  });
  app.db = db;
  app.locals.billing = billing;          // exposed for jobs (expiry reminders) and tests
  return app;
}
