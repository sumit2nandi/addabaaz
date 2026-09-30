// The HTTP application: builds the Express app that serves the JSON API under /api/v1, the admin console,
// and the static website (with server-rendered SEO tags).
//
// How the file is organised (top to bottom):
//   1. configuration and security headers
//   2. public endpoints (health, catalog, plans, sign-up / login / social login)
//   3. premium video streaming (Cloudflare R2), contact form, payment webhook
//   4. the admin router, then authentication middleware: everything below it needs a signed-in user
//   5. account, profiles, library, subscription and payment endpoints
//   6. static files, SEO pages and the final error handler
//
// `createApp()` receives its collaborators (database, mailer, payments, R2 ...) as options so tests can
// inject fakes; the defaults read real settings from environment variables (see .env.example).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDuplicate } from './db.js';
import { hashPassword, verifyPassword, signToken, signJwt, verifyToken, sessionValid } from './auth.js';
import { createFeatures } from './features.js';
import { pushFromEnv } from './push.js';
import { createR2 } from './r2.js';
import { socialFromEnv, SocialError } from './social.js';
import { PLANS, paidPlan } from './plans.js';
import { paymentsFromEnv } from './payments.js';
import { mailerFromEnv } from './mailer.js';
import { createBilling, billingConfigFromEnv } from './billing.js';
import { STATES } from './gst.js';
import { HttpError, bad, wrap, rateLimit } from './http.js';
import { createCatalogStore } from './catalog.js';
import { createSeo } from './seo.js';
import compression from 'compression';
import { createAdminRouter } from './admin.js';

// Repository root (two folders above server/src).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// App version, taken from package.json and reported by /health.
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
// Each account may create up to 5 profiles; PALETTE is the number of avatar colours.
const MAX_PROFILES = 5, PALETTE = 8;
// A deliberately simple e-mail check (something@something.tld); real verification is the e-mail link.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  adminToken = process.env.ADMIN_TOKEN || '',                 // optional shared secret for scripts (≥24 chars); admin ACCOUNTS (users.is_admin) need no token
  sessionHours = Number(process.env.ADMIN_SESSION_HOURS) || 12, // admin sessions are shorter than viewer sessions
  uploadDir = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),   // admin image uploads (mount a persistent volume in production)
  contactWebhook = process.env.CONTACT_WEBHOOK_URL || '',
  rate = true,
  catalogPath = path.join(ROOT, 'data/catalog.json'),
  studioPath = path.join(path.dirname(catalogPath), 'studio.json'),
  r2 = createR2(),                                            // Cloudflare R2 (private bucket for premium video)
  social = socialFromEnv(),                                   // { config, verifiers: { google?, facebook? } }
  publicApiUrl = process.env.PUBLIC_API_URL || '',            // absolute base for HLS URLs when behind a proxy
  streamTtl = Number(process.env.STREAM_URL_TTL) || 6 * 3600, // seconds a signed video URL stays valid
  push = pushFromEnv(db),                                     // Web Push (VAPID keys from env; tests inject a fake sender)
  features: featureOptions = {},                              // limits: { streamLimit, refundWindowDays, reportsToHide … } (env defaults)
  seo = {},                                                    // search-engine options: { siteUrl, indexable, compress, googleVerification, bingVerification } (env defaults below)
} = {}) {
  // Fail fast on a bad setup.
  if (!db) throw new Error('createApp: a database (createDb()) is required');
  // In production a real JWT secret is mandatory; in development a fixed insecure one is used with a warning.
  const production = process.env.NODE_ENV === 'production';
  if (production && !jwtSecret) throw new Error('JWT_SECRET must be set in production');
  if (!jwtSecret) console.warn('[auth] JWT_SECRET not set — using an insecure development secret. Set JWT_SECRET before deploying.');
  const secret = jwtSecret || 'insecure-development-secret';
  // The catalog store reads shows/videos from MySQL (seeded once from data/catalog.json) with a small in-memory cache.
  const catalog = createCatalogStore({ db, catalogPath, studioPath });     // MySQL-backed (seeded once from the JSON files), edited in /admin
  // True if a catalog item of that type/id exists (used to validate My List and progress writes).
  const exists = (type, id) => catalog.exists(type, id);

  // Now build the Express app itself.
  const app = express();
  app.disable('x-powered-by');
  // Search-engine settings. Indexing is off unless explicitly allowed so staging copies never compete with the real site.
  const seoCfg = {
    siteUrl: seo.siteUrl ?? process.env.PUBLIC_SITE_URL ?? '',     // https://addabaaz.in — canonical URLs, sitemap and structured data use it
    // Only the real production site should be indexed: staging/preview copies would compete with it (duplicate content).
    indexable: seo.indexable ?? (process.env.ALLOW_INDEXING ? /^(1|true|yes)$/i.test(process.env.ALLOW_INDEXING) : production),
    compress: seo.compress ?? !/^(1|true|yes)$/i.test(process.env.DISABLE_COMPRESSION || ''),
    google: seo.googleVerification ?? process.env.GOOGLE_SITE_VERIFICATION ?? '',
    bing: seo.bingVerification ?? process.env.BING_SITE_VERIFICATION ?? '',
    ga4: seo.ga4 ?? process.env.GA4_MEASUREMENT_ID ?? '',          // optional Google Analytics 4 — loads only after the visitor accepts analytics
  };
  // gzip responses (but never server-sent-event streams, which must flush immediately).
  if (seoCfg.compress) app.use(compression({ filter: (req, res) => !/event-stream/.test(res.getHeader('Content-Type') || '') && compression.filter(req, res) }));
  // Behind nginx / a load balancer the real client IP comes from X-Forwarded-For; needed for rate limits.
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false);
  // Keep API, admin and raw data files out of Google.
  app.use(['/api', '/admin', '/data'], (_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });   // machine endpoints and the admin console never belong in search results
  // Security headers on every response, then CORS: only origins listed in CORS_ORIGINS (or * ) may call the API from a browser.
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    const origin = req.headers.origin;
    if (origin && (corsOrigins === '*' || corsOrigins.split(',').map((s) => s.trim()).includes(origin))) {
      // X-Device-* / X-Parental-Pin are sent by the site AND the Android app WebView (origin app.addabaaz.in):
      // without them in the allow-list the preflight fails and every API call looks "offline" in the app.
      res.set({ 'Access-Control-Allow-Origin': corsOrigins === '*' ? '*' : origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Id, X-Device-Label, X-Parental-Pin', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // All JSON endpoints hang off this router, mounted at /api/v1 near the bottom.
  const api = express.Router();
  api.use(express.json({ limit: '50kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));   // rawBody: payment webhooks are signed over the exact bytes

  // Endpoints below need no sign-in.
  /* ---------- public ---------- */
  api.get('/health', wrap(async (_req, res) => {                 // liveness + discovery: always 200; `db` reports the database state
    const dbUp = await db.ping().then(() => true, () => false);
    res.json({ ok: true, service: 'addabaaz', version: VERSION, db: dbUp ? 'up' : 'down', storage: r2.configured ? 'r2' : 'none', payments: payments.provider, time: new Date().toISOString() });
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
  // Plans, plus how payments are configured so the front end knows which checkout UI to show (never secrets).
  api.get('/plans', (_req, res) => res.json({
    plans: PLANS,
    payments: { provider: payments.provider, ...(payments.provider === 'razorpay' ? { keyId: payments.keyId } : {}), ...(payments.provider === 'mock' ? { demo: true } : {}) },
    billing: { gst: billing.config.gstEnabled, coupons: payments.provider === 'razorpay', states: STATES },
  }));

  // Rate limit for sign-up/login endpoints: 20 requests per minute per IP (disabled in tests with rate:false).
  const authLimit = rate ? rateLimit('auth', 20, 60_000) : (_q, _s, n) => n();
  // The user fields that are safe to send to the browser (no password hash).
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, emailVerified: !!u.emailVerifiedAt, ...(u.isAdmin ? { isAdmin: true } : {}) });
  // Blocks accounts an admin has disabled.
  const notDisabled = (u) => { if (u.disabledAt) throw new HttpError(403, 'account_disabled', 'This account has been disabled. Please contact support.'); return u; };
  // Optional engagement/security features (password reset, PIN, ratings, comments, push, ...) live in features.js.
  const features = createFeatures({ db, secret, mailer, push, catalog, siteUrl: billing.config.siteUrl, rate, publicUser, notDisabled, userFromRequest: (req) => userFromRequest(req), plans: PLANS, options: { supportEmail: billing.config.supportEmail, ...featureOptions } });

  // Create an account with e-mail + password. Validates input, creates the user and first profile, sends a verification e-mail (best effort) and returns a session token.
  api.post('/auth/signup', authLimit, wrap(async (req, res) => {
    const { name = '', email = '', password = '' } = req.body || {};
    if (typeof email !== 'string' || !EMAIL.test(email.trim()) || email.length > 254) throw bad('Please enter a valid email address.', 'invalid_email');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw bad('Password must be 8–128 characters.', 'weak_password');
    if (typeof name !== 'string' || !name.trim() || name.length > 60) throw bad('Please enter your name.', 'invalid_name');
    // Passwords are hashed (scrypt) before they touch the database; e-mails are stored lower-case.
    const user = { id: crypto.randomUUID(), email: email.trim().toLowerCase(), name: name.trim(), passwordHash: hashPassword(password) };
    const profile = { id: crypto.randomUUID(), name: user.name.split(/\s+/)[0].slice(0, 24), color: 0 };
    // The unique e-mail index is the real duplicate check (safe against two simultaneous sign-ups).
    try { await db.users.createWithProfile(user, profile); }
    catch (e) {
      if (!isDuplicate(e)) throw e;
      const ex = await db.users.byEmail(user.email);
      throw new HttpError(409, 'email_taken', ex && !ex.passwordHash ? 'This email is already registered — use “Continue with Google/Facebook” to sign in.' : 'An account with this email already exists.');
    }
    features.sendVerification({ ...user, emailVerifiedAt: null }).catch((e) => console.warn('[auth] verification email failed:', e.message));
    res.status(201).json({ token: signToken(user.id, secret), user: publicUser(user), profiles: [profile] });
  }));
  // Log in with e-mail + password. Returns a session token.
  api.post('/auth/login', authLimit, wrap(async (req, res) => {
    const { email = '', password = '' } = req.body || {};
    const user = await db.users.byEmail(String(email).trim().toLowerCase());
    // Always run a hash to keep timing similar whether or not the user exists.
    const ok = user?.passwordHash ? verifyPassword(String(password), user.passwordHash) : (verifyPassword(String(password), 'scrypt$00$00'), false);   // social-only accounts have no password
    if (!ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
    notDisabled(user);
    res.json({ token: signToken(user.id, secret, undefined, user.sessionVersion), user: publicUser(user) });
  }));

  /* ---------- social sign-in ---------- */
  // Tells the front end which social buttons to show.
  api.get('/auth/providers', (_req, res) => res.json({ password: true, ...social.config }));
  const LABEL = { google: 'Google', facebook: 'Facebook', apple: 'Apple' };
  // Shared by Google, Facebook and Apple: verify the provider's token, then find or create our own account.
  // An existing account with the same *verified* e-mail is linked rather than duplicated.
  async function socialSignIn(provider, credential) {
    const verifier = social.verifiers?.[provider];
    if (!verifier) throw new HttpError(501, 'provider_not_configured', `${LABEL[provider]} sign-in isn’t enabled on this server.`);
    let claims;
    try { claims = await verifier(credential); }
    catch (e) { if (e instanceof SocialError) throw new HttpError(e.code === 'provider_unavailable' ? 503 : 401, e.code, e.message); throw e; }
    const ident = { provider, subject: claims.subject, email: claims.email };
    let user = await db.identities.userFor(provider, claims.subject), isNew = false;
    // First time we see this social identity.
    if (!user) {
      if (!claims.email) throw bad(`${LABEL[provider]} didn’t share an email address. Please sign up with email instead.`, 'email_required');
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
    // Should be unreachable; guards against an unexpected race.
    if (!user) throw new HttpError(500, 'server_error', 'Something went wrong.');
    notDisabled(user);
    await db.identities.touch(provider, claims.subject);
    if (!user.emailVerifiedAt) await db.accounts.markVerified(user.id);           // the provider already verified this address
    return { token: signToken(user.id, secret, undefined, user.sessionVersion), user: publicUser({ ...user, emailVerifiedAt: user.emailVerifiedAt || true }), profiles: await db.profiles.list(user.id), isNew };
  }
  // One endpoint per provider; the body carries the provider's ID token / access token.
  api.post('/auth/google', authLimit, wrap(async (req, res) => res.json(await socialSignIn('google', req.body?.idToken))));
  api.post('/auth/facebook', authLimit, wrap(async (req, res) => res.json(await socialSignIn('facebook', req.body?.accessToken))));
  api.post('/auth/apple', authLimit, wrap(async (req, res) => res.json(await socialSignIn('apple', { identityToken: req.body?.identityToken, name: req.body?.name }))));
  features.public(api);           // password reset, email verification, analytics, public ratings/comments

  /* ---------- premium video (Cloudflare R2) ---------- */
  // ---- Premium video (Cloudflare R2) ----
  // Reads the optional `Authorization: Bearer` token without failing when it is missing (free videos need no login).
  const userFromRequest = async (req) => {
    const h = req.headers.authorization || '';
    const payload = h.startsWith('Bearer ') ? verifyToken(h.slice(7), secret) : null;
    const u = payload && !payload.aud && payload.sub ? await db.users.byId(String(payload.sub)) : null; return u && !u.disabledAt && sessionValid(payload, u) ? u : null;      // media/other scoped tokens are not sessions
  };
  // Small helpers: catalog lookup, the public base URL for links we hand out, and mp4-vs-HLS detection.
  const findVideo = (id) => catalog.video(id);
  const originOf = (req) => (publicApiUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const r2Format = (src) => src.format || (/\.m3u8$/i.test(src.key) ? 'hls' : 'mp4');
  /** Returns a playable URL for a video hosted in R2. Premium titles need a signed-in account with an active paid plan. */
  api.post('/videos/:id/stream', wrap(async (req, res) => {
    const v = await findVideo(req.params.id);
    if (!v) throw new HttpError(404, 'not_found', 'Unknown video.');
    if (v.source?.type !== 'r2') throw new HttpError(400, 'not_hosted', 'This video is not hosted in R2.');
    // Premium gate: must be signed in (401), have a paid plan (402) and be within the simultaneous-screens limit (429). Free videos skip all of this.
    if (v.access === 'premium') {
      const user = await userFromRequest(req);
      if (!user) throw new HttpError(401, 'login_required', 'Please sign in to watch premium videos.');
      if ((await db.subscriptions.get(user.id)).planId === 'free') throw new HttpError(402, 'subscription_required', 'Subscribe to ADDABAAZ Plus to watch this video.');   // premium = signed in AND paid
      const dev = features.deviceOf(req);                                  // screens-at-once limit (premium playback only)
      const seat = await db.playback.touch(user.id, dev.id, dev.label, v.id, { limit: features.cfg.streamLimit, windowSec: features.cfg.heartbeatWindowSec });
      if (!seat.ok) throw new HttpError(429, 'stream_limit', `Your plan allows ${features.cfg.streamLimit} screens at once. Stop playback on another device to continue.`);
      req.user = user;
    }
    // Only after the access checks: is storage set up at all?
    if (!r2.configured) throw new HttpError(503, 'storage_not_configured', 'Video storage is not configured on this server.');
    const format = r2Format(v.source), expiresAt = new Date(Date.now() + streamTtl * 1000).toISOString();
    res.set('Cache-Control', 'no-store');
    // HLS: return a short-lived token URL that points at our own gateway (below).
    if (format === 'hls') {   // segments can't be pre-signed one by one, so playback goes through the token gateway below
      const token = signJwt({ aud: 'media', vid: v.id, sub: req.user?.id || null }, secret, streamTtl);
      return res.json({ type: 'hls', url: `${originOf(req)}/api/v1/media/${token}/${encodeURIComponent(v.source.key.split('/').pop())}`, expiresAt });
    }
    // Plain MP4: a time-limited signed R2 link the browser can play directly.
    res.json({ type: 'mp4', url: r2.presignGet(v.source.key, { ttl: streamTtl }), expiresAt });
  }));
  /** HLS gateway: playlists are proxied (so relative URLs stay on this gateway); media segments are redirected to short-lived R2 URLs. */
  api.get('/media/:token/*', wrap(async (req, res) => {
    const claims = verifyToken(req.params.token, secret);
    if (!claims || claims.aud !== 'media') throw new HttpError(401, 'invalid_token', 'This playback link has expired.');
    const v = await findVideo(claims.vid);
    if (!v || v.source?.type !== 'r2' || r2Format(v.source) !== 'hls') throw new HttpError(404, 'not_found', 'Unknown video.');
    if (!r2.configured) throw new HttpError(503, 'storage_not_configured', 'Video storage is not configured on this server.');
    // Only files in the same folder (or below) as the video's master playlist may be requested; anything else is rejected as a path-traversal attempt.
    const dir = path.posix.dirname(v.source.key);
    const rest = req.params[0];                                  // Express has already URL-decoded it once
    const target = path.posix.normalize(`${dir}/${rest}`);
    if (rest.includes('\0') || rest.startsWith('/') || !target.startsWith(dir === '.' ? '' : dir + '/') || target.split('/').includes('..')) throw new HttpError(404, 'not_found', 'Not found.');
    // Playlists are fetched from R2 and rewritten/proxied by us; everything else (video segments) is a 15-minute signed redirect straight to R2.
    if (/\.m3u8$/i.test(target)) {
      const text = await r2.getText(target);
      if (text == null) throw new HttpError(404, 'not_found', 'Not found.');
      return res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }).send(text);
    }
    res.set('Cache-Control', 'no-store').redirect(302, r2.presignGet(target, { ttl: 900 }));
  }));

  // Public contact form: rate limited (5 per 10 min), with a hidden `website` field as a spam trap (bots fill it in).
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
    // Razorpay sends several event types; each one is routed to the billing module.
    const ev = req.body?.event, pe = req.body?.payload?.payment?.entity, re = req.body?.payload?.refund?.entity;
    // Payment succeeded: match our order, check amount and currency, then grant access (idempotent, so retries are harmless).
    if ((ev === 'payment.captured' || ev === 'order.paid') && pe?.order_id && pe?.id && (pe.status === 'captured' || ev === 'order.paid')) {
      const pay = await db.payments.byOrder('razorpay', pe.order_id);
      if (pay && pay.amountPaise === pe.amount && pe.currency === 'INR') await billing.settle(pay, pe.id);
      else console.warn('[payments] webhook for unknown order or amount mismatch', pe.order_id);
    } else if (ev === 'payment.failed') await billing.onPaymentFailed(pe);
    else if (/^refund\.(created|processed|failed)$/.test(ev || '')) await billing.onRefundEvent(re);
    res.json({ ok: true });                                               // always 200 for valid signatures so Razorpay doesn't retry forever
  }));

  /* ---------- admin console API (admin accounts, or ADMIN_TOKEN for scripts) — see server/src/admin.js ---------- */
  // Mount the admin console API. It does its own authentication (admin role or ADMIN_TOKEN).
  api.use('/admin', createAdminRouter({ db, billing, catalog, r2, payments, mailer, push, social, adminToken, secret, sessionHours, uploadDir, mediaDir: path.join(ROOT, 'media'), rate }));

  /* ---------- authenticated ---------- */
  // AUTH MIDDLEWARE: every route registered after this line requires a valid session token whose session version still matches.
  api.use(wrap(async (req, _res, next) => {
    const h = req.headers.authorization || '';
    const payload = h.startsWith('Bearer ') ? verifyToken(h.slice(7), secret) : null;
    const user = payload && !payload.aud && await db.users.byId(String(payload.sub));
    if (!user || !sessionValid(payload, user)) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    notDisabled(user);
    req.user = user; next();
  }));
  features.authed(api);           // account security, PIN, devices, ratings, comments, push, refund requests
  // Loads a profile only if it belongs to the signed-in user (prevents reading someone else's data).
  const ownProfile = async (req) => {
    const p = await db.profiles.get(req.params.pid, req.user.id);
    if (!p) throw new HttpError(404, 'not_found', 'Profile not found.');
    return p;
  };

  // ---- Account ----
  api.get('/me', wrap(async (req, res) => res.json({ user: publicUser(req.user), hasPassword: !!req.user.passwordHash, hasPin: !!req.user.hasPin, providers: await db.identities.providersOf(req.user.id), profiles: await db.profiles.list(req.user.id), subscription: await db.subscriptions.get(req.user.id) })));
  api.patch('/me', wrap(async (req, res) => {
    const n = req.body?.name; if (typeof n !== 'string' || !n.trim() || n.length > 60) throw bad('Please enter your name.');
    await db.users.rename(req.user.id, n.trim()); res.json({ user: publicUser({ ...req.user, name: n.trim() }) });
  }));
  // Self-service account deletion.
  api.delete('/me', wrap(async (req, res) => {           // required by Apple App Store guideline 5.1.1(v) & Google Play policy
    await db.users.remove(req.user.id);                   // FK cascades remove profiles, library and subscription
    res.sendStatus(204);
  }));

  /* profiles */
  // Validates profile input; with `partial` only supplied fields are checked (used by PATCH).
  const cleanProfile = (b, partial = false) => {
    const out = {};
    if (!partial || b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 24) throw bad('Profile name must be 1–24 characters.'); out.name = b.name.trim(); }
    if (b.kids !== undefined) { if (typeof b.kids !== 'boolean') throw bad('kids must be true or false.'); out.kids = b.kids; }
    if (b.color !== undefined) { if (!Number.isInteger(b.color) || b.color < 0 || b.color >= PALETTE) throw bad('Invalid colour.'); out.color = b.color; }
    return out;
  };
  api.get('/profiles', wrap(async (req, res) => res.json({ profiles: await db.profiles.list(req.user.id) })));
  // Adding, editing or deleting a profile asks for the parental PIN if one is set.
  api.post('/profiles', wrap(async (req, res) => {
    await features.requirePin(req);
    const { name, kids } = cleanProfile(req.body || {});
    const profile = await db.profiles.create(req.user.id, { id: crypto.randomUUID(), name, kids }, MAX_PROFILES, PALETTE);
    if (!profile) throw new HttpError(409, 'profile_limit', `You can have up to ${MAX_PROFILES} profiles.`);
    res.status(201).json({ profile });
  }));
  api.patch('/profiles/:pid', wrap(async (req, res) => {
    await features.requirePin(req);
    const p = await ownProfile(req); res.json({ profile: await db.profiles.update(p.id, cleanProfile(req.body || {}, true)) });
  }));
  api.delete('/profiles/:pid', wrap(async (req, res) => {
    await features.requirePin(req);
    const p = await ownProfile(req);
    if (!(await db.profiles.remove(p.id, req.user.id))) throw new HttpError(409, 'last_profile', 'At least one profile is required.');
    res.sendStatus(204);
  }));

  /* library: My List, progress, reminders */
  api.get('/profiles/:pid/library', wrap(async (req, res) => { const p = await ownProfile(req); res.json(await db.library.get(p.id)); }));
  // My List. Adding validates the title exists; PUT/DELETE are idempotent.
  api.put('/profiles/:pid/list/:type/:id', wrap(async (req, res) => {
    const p = await ownProfile(req); const { type, id } = req.params;
    if (!(await exists(type, id))) throw new HttpError(404, 'not_found', 'Unknown title.');
    await db.library.addListItem(p.id, type, id); res.sendStatus(204);
  }));
  api.delete('/profiles/:pid/list/:type/:id', wrap(async (req, res) => {
    const p = await ownProfile(req); await db.library.removeListItem(p.id, req.params.type, req.params.id); res.sendStatus(204);
  }));
  // Continue-watching position, saved every few seconds by the player.
  api.put('/profiles/:pid/progress/:videoId', wrap(async (req, res) => {
    const p = await ownProfile(req); const { position, duration } = req.body || {};
    if (!(await exists('video', req.params.videoId))) throw new HttpError(404, 'not_found', 'Unknown video.');
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration ?? 0) || (duration ?? 0) < 0) throw bad('position and duration must be non-negative numbers.');
    await db.library.saveProgress(p.id, req.params.videoId, Math.min(Math.floor(position), 4_294_967_295), Math.min(Math.floor(duration || 0), 4_294_967_295));
    res.sendStatus(204);
  }));
  api.delete('/profiles/:pid/progress/:videoId', wrap(async (req, res) => { const p = await ownProfile(req); await db.library.removeProgress(p.id, req.params.videoId); res.sendStatus(204); }));
  // "Remind me" for upcoming releases.
  api.put('/profiles/:pid/reminders/:id', wrap(async (req, res) => {
    const p = await ownProfile(req); if (!(await exists('upcoming', req.params.id))) throw new HttpError(404, 'not_found', 'Unknown title.');
    await db.library.addReminder(p.id, req.params.id); res.sendStatus(204);
  }));
  api.delete('/profiles/:pid/reminders/:id', wrap(async (req, res) => { const p = await ownProfile(req); await db.library.removeReminder(p.id, req.params.id); res.sendStatus(204); }));

  /* ---------- subscription & payments ---------- */
  api.get('/subscription', wrap(async (req, res) => res.json({ subscription: await db.subscriptions.get(req.user.id) })));
  // Payment endpoints are rate limited too (20 per minute per IP).
  const payLimit = rate ? rateLimit('pay', 20, 60_000) : (_q, _s, n) => n();

  /** Price preview: applies a coupon (and tells the viewer why it doesn't work). */
  api.post('/payments/quote', payLimit, wrap(async (req, res) => {
    if (payments.provider !== 'razorpay') throw new HttpError(501, 'payments_not_configured', 'Coupons need live payments.');
    res.json({ quote: billing.quoteView(await billing.quote(req.user.id, req.body?.planId, req.body?.couponCode)) });
  }));

  /** Step 1: start a purchase. Razorpay → returns the order for Checkout (coupon + GST billing details applied). Demo provider → activates immediately. */
  api.post('/payments/checkout', payLimit, wrap(async (req, res) => {
    features.requireVerified(req.user);
    const plan = paidPlan(req.body?.planId);
    if (!plan) throw bad('Choose a paid plan.', 'unknown_plan');
    if (payments.provider === 'none') throw new HttpError(501, 'payments_not_configured', 'Payments are not configured on this server.');
    // Development only: no real payment, activate the plan immediately ("demo" subscription).
    if (payments.provider === 'mock') {
      await db.subscriptions.activateDemo(req.user.id, plan.id, plan.days);
      return res.status(201).json({ provider: 'mock', demo: true, subscription: await db.subscriptions.get(req.user.id) });
    }
    res.status(201).json(await billing.checkout({ user: req.user, planId: plan.id, couponCode: req.body?.couponCode, billing: req.body?.billing }));
  }));

  /** Step 3: the browser reports a finished payment. Nothing is granted unless the signature is valid for OUR order. */
  api.post('/payments/verify', payLimit, wrap(async (req, res) => {
    if (payments.provider !== 'razorpay') throw new HttpError(501, 'payments_not_configured', 'Payments are not configured on this server.');
    // The signature proves Razorpay (not the browser) says this payment happened.
    const { orderId, paymentId, signature } = req.body || {};
    const pay = typeof orderId === 'string' ? await db.payments.byOrder('razorpay', orderId) : null;
    if (!pay || pay.userId !== req.user.id) throw new HttpError(404, 'not_found', 'Unknown order.');            // also blocks using someone else's order
    if (!payments.verifyPayment({ orderId, paymentId, signature })) throw new HttpError(400, 'invalid_signature', 'Payment could not be verified. If money was deducted it will be reversed automatically, or contact support.');
    await billing.settle(pay, paymentId);                                                                          // idempotent; issues the invoice
    res.json({ subscription: await db.subscriptions.get(req.user.id) });
  }));

  /* ---------- billing history & documents ---------- */
  // Payment history and downloadable GST invoices / credit notes.
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

  // Anything under /api/v1 not handled above is a JSON 404 (not the website).
  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Unknown endpoint.')));
  app.use('/api/v1', api);

  /* ---------- static site (same origin => the web app auto-detects this API) ---------- */
  // ---- Website ----
  // Static files, plus server-rendered HTML for every page so search engines see real titles and content.
  if (serveStatic) {
    // Common options for express.static: no directory index, ignore dotfiles.
    const opts = (maxAge) => ({ maxAge, index: false, dotfiles: 'ignore' });
    const seoSvc = createSeo({ catalog, root: ROOT, plans: PLANS, origin: seoCfg.siteUrl, indexable: seoCfg.indexable, verification: { google: seoCfg.google, bing: seoCfg.bing, ga4: seoCfg.ga4 } });
    // robots.txt and sitemap.xml are generated (they depend on the catalog and on whether indexing is allowed).
    app.get('/robots.txt', (req, res) => res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(seoSvc.robotsTxt(req)));
    app.get('/sitemap.xml', wrap(async (req, res) => { res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(await seoSvc.sitemapXml(req)); }));
    // The web app manifest: on this server the app uses real URLs, so an installed app should open on "/" rather than "/#/".
    app.get('/manifest.webmanifest', (_q, res) => {
      try { const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')); m.start_url = '/'; m.scope = '/'; res.type('application/manifest+json').send(JSON.stringify(m)); }
      catch { res.sendFile(path.join(ROOT, 'manifest.webmanifest')); }
    });
    // The service worker must never be cached hard, or updates would not reach users.
    app.get('/sw.js', (_q, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(ROOT, 'sw.js')); });
    // Static asset folders. Longer cache times for rarely-changing ones.
    app.use('/app', express.static(path.join(ROOT, 'app'), { ...opts(0), etag: true }));
    app.use('/data', express.static(path.join(ROOT, 'data'), opts(60_000)));
    app.use('/media', express.static(path.join(ROOT, 'media'), opts(7 * 86_400_000)));
    app.use('/uploads', express.static(uploadDir, { maxAge: '365d', immutable: true, index: false, dotfiles: 'ignore' }));   // admin-uploaded images (content-hash names)
    // The admin console: its own page + scripts, never cached, locked down with a strict CSP (no inline script, no framing).
    const adminHeaders = (_q, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }); next(); };
    // Admin console page + its scripts.
    app.get(['/admin', '/admin/'], adminHeaders, (_q, res) => res.sendFile(path.join(ROOT, 'admin/index.html')));
    app.use('/admin', adminHeaders, express.static(path.join(ROOT, 'admin'), { index: false, dotfiles: 'ignore', etag: true }));

    // Every other GET is a page of the web app (/, /show/shahid …). Unknown pages get a REAL 404 status (with the app shell, so
    // people still see the site) — otherwise search engines index every mistyped URL as a "soft 404".
    app.get('*', async (req, res, next) => {
      if (req.path !== '/index.html' && (/^\/(api|app|data|media|uploads|admin)(\/|$)/.test(req.path) || /\.[a-z0-9]{1,8}$/i.test(req.path))) return res.status(404).type('text/plain').send('Not found');
      // Render the requested page (or redirect, or a real 404 status for unknown URLs).
      try {
        const r = await seoSvc.render(req);
        if (r.redirect) return res.redirect(r.status || 301, r.redirect);
        res.status(r.status).set(r.headers).send(r.body);
      } catch (e) {
        console.error('[seo] page render failed:', e.message);
        res.status(503).set({ 'Cache-Control': 'no-store', 'Retry-After': '30' }).sendFile(path.join(ROOT, 'index.html'));   // 503, not 200: never let a crawler index a broken page
      }
    });
  }

  // FINAL ERROR HANDLER: turns any thrown error into `{ error: { code, message } }`. Unexpected (500) errors are logged and hidden from the client.
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = bad('Invalid JSON body.', 'invalid_json');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'too_large', 'Request too large.');
    const status = err.status || 500;
    if (status >= 500 && !(err instanceof HttpError)) { console.error(err); try { app.locals.captureError?.(err, req); } catch { /* monitoring must never break error handling */ } db.errors.add({ source: 'server', message: `${req.method} ${req.path}: ${err.message}`, stack: err.stack, url: req.originalUrl, userAgent: req.get('user-agent') }).catch(() => {}); }   // expected 5xx (provider down, storage off) are not logged as crashes
    res.status(status).json({ error: { code: err.code || 'server_error', message: status === 500 ? 'Something went wrong.' : err.message } });
  });
  // Expose internals for tests and for index.js (background jobs).
  app.db = db;
  app.locals.push = push;
  app.locals.features = features;
  app.locals.catalog = catalog;
  app.locals.billing = billing;          // exposed for jobs (expiry reminders) and tests
  return app;
}
