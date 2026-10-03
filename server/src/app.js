// The HTTP application: builds the Express app that serves the JSON API under /api/v1, the admin console,
// and the static website (with server-rendered SEO tags).
//
// This is the HTTP composition root, not a feature implementation:
//   1. validate configuration and create domain/provider collaborators
//   2. install cross-cutting middleware and register focused route modules in auth-safe order
//   3. mount web/SEO delivery and the final error boundary
// Route behavior lives under routes/, in features.js, and in the dedicated admin router.
//
// `createApp()` receives its collaborators (database, mailer, payments, R2 ...) as options so tests can
// inject fakes; the defaults read real settings from environment variables (see .env.example).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertProductionSecret } from './auth.js';
import { createFeatures } from './features.js';
import { pushFromEnv } from './push.js';
import { fcmFromEnv } from './fcm.js';
import { campaignEmail } from './emails.js';
import { createCampaigns } from './campaigns.js';
import { createR2 } from './r2.js';
import { socialFromEnv } from './social.js';
import { PLANS } from './plans.js';
import { paymentsFromEnv } from './payments.js';
import { mailerFromEnv } from './mailer.js';
import { createBilling, billingConfigFromEnv } from './billing.js';
import { createPromos, promosConfigFromEnv } from './promos.js';
import { HttpError, bad, wrap, rateLimit, safeErrorUrl } from './http.js';
import { createCatalogStore } from './catalog.js';
import { createYouTubeFeed } from './youtube-feed.js';
import { installSecurityMiddleware } from './middleware/security.js';
import { createAdminRouter } from './admin.js';
import { createSessionResolver, sessionForRequest } from './sessions.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerContactRoutes } from './routes/contact.js';
import { registerPaymentWebhook } from './routes/payment-webhook.js';
import { registerUnsubscribeRoute } from './routes/unsubscribe.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerOtpRoutes } from './routes/otp.js';
import { registerSupportRoutes, emailTemplates as supportEmails } from './routes/support.js';
import { registerPromoRoutes } from './routes/promos.js';
import { smsFromEnv, isPhoneEmail } from './sms.js';
import { mountWebsite } from './web.js';

// Repository root (two folders above server/src).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// App version, taken from package.json and reported by /health.
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
// Each account may create up to 5 profiles; PALETTE is the number of avatar colours.
const MAX_PROFILES = 5, PALETTE = 8;

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
  sms = smsFromEnv(),                                         // phone sign-in (MSG91); 'console' in development, 'none' in production without keys
  mailer = mailerFromEnv(),                                   // SMTP (receipts, refunds, reminders); no-op without SMTP_URL
  billing: billingOption = null,                              // defaults to createBilling() below (promos need the db first)
  promos: promosOption = null,                                // promotional credit + referrals (server/src/promos.js)
  adminToken = process.env.ADMIN_TOKEN || '',                 // optional shared secret for scripts (≥24 chars); admin ACCOUNTS (users.is_admin) need no token
  sessionHours = Number(process.env.ADMIN_SESSION_HOURS) || 12, // admin sessions are shorter than viewer sessions
  uploadDir = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),   // local cache of admin uploads (the real copies are stored in MySQL)
  contactWebhook = process.env.CONTACT_WEBHOOK_URL || '',
  youtubeFeed = createYouTubeFeed(),                         // fetched only after an administrator explicitly previews uploads
  rate = true,
  catalogPath = path.join(ROOT, 'data/catalog.json'),
  studioPath = path.join(path.dirname(catalogPath), 'studio.json'),
  r2 = createR2(),                                            // Cloudflare R2 (private storage for video files)
  social = socialFromEnv(),                                   // { config, verifiers: { google?, facebook? } }
  publicApiUrl = process.env.PUBLIC_API_URL || '',            // absolute base for HLS URLs when behind a proxy
  streamTtl = Number(process.env.STREAM_URL_TTL) || 6 * 3600, // seconds a signed video URL stays valid
  push = pushFromEnv(db, process.env, { fcm: fcmFromEnv() }), // Web Push (VAPID) + native app push (FCM); tests inject a fake sender
  features: featureOptions = {},                              // limits: { streamLimit, refundWindowDays, reportsToHide … } (env defaults)
  seo = {},                                                    // search-engine options: { siteUrl, indexable, compress, googleVerification, bingVerification } (env defaults below)
} = {}) {
  // Fail fast on a bad setup.
  if (!db) throw new Error('createApp: a database (createDb()) is required');
  // Promotions are created first: billing spends the credit they hand out.
  const promos = promosOption || createPromos({ db, config: promosConfigFromEnv(), mailer, siteUrl: process.env.PUBLIC_SITE_URL || '' });
  const billing = billingOption || createBilling({ db, payments, mailer, config: billingConfigFromEnv(), promos });   // coupons, GST invoices, refunds
  promos.siteUrl = promos.siteUrl || billing.config.siteUrl || '';    // share links and e-mails use the public URL
  // In production require a strong, non-example session key; development may use the warning-only fallback.
  const production = process.env.NODE_ENV === 'production';
  if (production) assertProductionSecret(jwtSecret);
  if (!jwtSecret) console.warn('[auth] JWT_SECRET not set — using an insecure development secret. Set JWT_SECRET before deploying.');
  const secret = jwtSecret || 'insecure-development-secret';
  // The catalog store reads shows/videos from MySQL (seeded once from data/catalog.json) with a small in-memory cache.
  const catalog = createCatalogStore({ db, catalogPath, studioPath });     // MySQL-backed (seeded once from the JSON files), edited in /admin
  // True if a catalog item of that type/id exists (used to validate My List and progress writes).
  const exists = (type, id) => catalog.exists(type, id);
  const userFromRequest = createSessionResolver({ db, secret });

  // Now build the Express app itself.
  const app = express();
  app.disable('x-powered-by');
  const seoCfg = installSecurityMiddleware(app, { corsOrigins, production, seo });
  // All JSON endpoints hang off this router, mounted at /api/v1 near the bottom.
  const api = express.Router();
  api.use(express.json({ limit: '50kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));   // rawBody: payment webhooks are signed over the exact bytes

  registerSystemRoutes(api, { db, catalog, payments, billing, r2, version: VERSION });
  // Rate limit for sign-up/login endpoints: 20 requests per minute per IP (disabled in tests with rate:false).
  const authLimit = rate ? rateLimit('auth', 20, 60_000) : (_q, _s, n) => n();
  // The user fields that are safe to send to the browser (no password hash).
  // `phone` lets the app show the number a phone-first account signed up with; `emailIsPlaceholder` marks
  // the internal address such accounts carry (never a real inbox — see sms.js).
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, emailVerified: !!u.emailVerifiedAt, ...(u.phone ? { phone: u.phone, phoneVerified: !!u.phoneVerifiedAt } : {}), ...(isPhoneEmail(u.email) ? { emailIsPlaceholder: true } : {}), ...(u.isAdmin ? { isAdmin: true } : {}) });
  // Blocks accounts an admin has disabled.
  const notDisabled = (u) => { if (u.disabledAt) throw new HttpError(403, 'account_disabled', 'This account has been disabled. Please contact support.'); return u; };
  // Optional engagement/security features (password reset, PIN, ratings, comments, push, ...) live in features.js.
  const features = createFeatures({ db, secret, mailer, push, catalog, siteUrl: billing.config.siteUrl, rate, publicUser, notDisabled, userFromRequest, plans: PLANS, promos, options: { supportEmail: billing.config.supportEmail, ...featureOptions } });

  /* ---------- broadcast campaigns (Admin → Notifications: push / e-mail) — see server/src/campaigns.js ---------- */
  // Signed one-click unsubscribe link put in the footer of every campaign e-mail; the audience queries skip
  // anyone who used it. Transactional mail (receipts, resets) is unaffected.
  const siteUrl = billing.config.siteUrl || '';
  const unsubSig = (userId) => crypto.createHmac('sha256', secret).update(`unsub:${userId}`).digest('base64url').slice(0, 32);
  const unsubscribeUrlFor = (u) => (siteUrl ? `${siteUrl}/api/v1/notifications/unsubscribe?u=${encodeURIComponent(u.id)}&t=${unsubSig(u.id)}` : '');
  const campaigns = createCampaigns({ db, push, mailer, email: campaignEmail, log: console });

  registerAuthRoutes(api, { db, secret, social, features, mailer, authLimit, publicUser, notDisabled, sms, promos });
  // Phone sign-in (SMS OTP). With no MSG91 keys the routes answer 503 and the sign-in page keeps offering
  // email + password — the site never breaks because payments/SMS are missing.
  registerOtpRoutes(api, { db, sms, secret, publicUser, notDisabled, authLimit, promos });
  features.public(api);           // password reset, email verification, analytics, public ratings/comments
  // Support tickets (the Support page). Guests can write in too; signing in links the ticket to the account.
  registerSupportRoutes(api, { db, userFromRequest, mailer, email: supportEmails, supportEmail: billing.config.supportEmail, siteUrl: billing.config.siteUrl || '', rate, log: console });
  // Promotional credit & referrals: the public offer, the viewer's balance/ledger and invite codes. The
  // routes decide for themselves what needs a session, so they sit before the auth middleware.
  registerPromoRoutes(api, { db, promos, userFromRequest, rate });

  registerUnsubscribeRoute(api, { db, unsubscribeSignature: unsubSig });
  /* ---------- Cloudflare R2 video streaming ---------- */
  registerMediaRoutes(api, { db, secret, publicApiUrl, streamTtl, r2, catalog, features, userFromRequest });
  registerContactRoutes(api, { db, rate, contactWebhook });
  registerPaymentWebhook(api, { db, billing, payments });
  /* ---------- admin console API (admin accounts, or ADMIN_TOKEN for scripts) — see server/src/admin.js ---------- */
  // Mount the admin console API. It does its own authentication (admin role or ADMIN_TOKEN).
  api.use('/admin', createAdminRouter({ db, billing, catalog, youtubeFeed, r2, payments, mailer, push, campaigns, unsubscribeUrlFor, social, adminToken, secret, sessionHours, uploadDir, mediaDir: path.join(ROOT, 'media'), rate, sms, promos, siteUrl: billing.config.siteUrl || '' }));

  /* ---------- authenticated ---------- */
  // AUTH MIDDLEWARE: every route registered after this line requires a valid session token whose session version still matches.
  api.use(wrap(async (req, _res, next) => {
    const session = await sessionForRequest(req, { db, secret });
    if (!session) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    notDisabled(session.user);
    req.user = session.user; next();
  }));
  features.authed(api);           // account security, PIN, devices, ratings, comments, push, refund requests
  registerAccountRoutes(api, { db, publicUser, features, exists, maxProfiles: MAX_PROFILES, palette: PALETTE });
  registerBillingRoutes(api, { db, billing, payments, features, rate });
  // Anything under /api/v1 not handled above is a JSON 404 (not the website).
  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Unknown endpoint.')));
  app.use('/api/v1', api);

  mountWebsite(app, { serveStatic, ROOT, db, catalog, PLANS, uploadDir, billing, corsOrigins, seoCfg });
  // FINAL ERROR HANDLER: turns any thrown error into `{ error: { code, message } }`. Unexpected (500) errors are logged and hidden from the client.
  // Only errors that were *authored* for the client are ever shown — HttpError, PaymentError, BillingError
  // (integer status + string code). Library/driver messages and everything else are replaced with a plain,
  // user-appropriate sentence; the technical detail stays in the server log / error report.
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = bad('Invalid JSON body.', 'invalid_json');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'too_large', 'Request too large.');
    const status = err.status || 500;
    if (status >= 500 && !(err instanceof HttpError)) { console.error(err); try { app.locals.captureError?.(err, req); } catch { /* monitoring must never break error handling */ } db.errors.add({ source: 'server', message: `${req.method} ${safeErrorUrl(req.path)}: ${err.message}`, stack: err.stack, url: safeErrorUrl(req.originalUrl), userAgent: req.get('user-agent') }).catch(() => {}); }   // expected 5xx (provider down, storage off) are not logged as crashes
    const authored = err instanceof HttpError || (Number.isInteger(err?.status) && typeof err?.code === 'string');
    const message = authored && err.message ? err.message : (status >= 500 ? 'Something went wrong.' : 'That request couldn’t be completed.');
    const code = authored && typeof err.code === 'string' ? err.code : (status >= 500 ? 'server_error' : 'bad_request');
    res.status(status).json({ error: { code, message } });
  });
  // Expose internals for tests and for index.js (background jobs).
  app.db = db;
  app.locals.push = push;
  app.locals.campaigns = campaigns;
  app.locals.features = features;
  app.locals.catalog = catalog;
  app.locals.billing = billing;          // exposed for jobs (expiry reminders) and tests
  app.locals.sms = sms;                  // phone sign-in state (the console shows whether SMS is configured)
  app.locals.supportEmails = supportEmails;
  app.locals.promos = promos;            // background jobs (expiry sweep) and tests
  return app;
}
