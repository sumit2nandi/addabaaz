import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDuplicate } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { PLANS } from './plans.js';

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
  paymentProvider = process.env.PAYMENT_PROVIDER || 'mock',
  contactWebhook = process.env.CONTACT_WEBHOOK_URL || '',
  rate = true,
} = {}) {
  if (!db) throw new Error('createApp: a database (createDb()) is required');
  const production = process.env.NODE_ENV === 'production';
  if (production && !jwtSecret) throw new Error('JWT_SECRET must be set in production');
  if (!jwtSecret) console.warn('[auth] JWT_SECRET not set — using an insecure development secret. Set JWT_SECRET before deploying.');
  const secret = jwtSecret || 'insecure-development-secret';
  const catalogPath = path.join(ROOT, 'data/catalog.json');
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
  api.use(express.json({ limit: '50kb' }));

  /* ---------- public ---------- */
  api.get('/health', wrap(async (_req, res) => {                 // liveness + discovery: always 200; `db` reports the database state
    const dbUp = await db.ping().then(() => true, () => false);
    res.json({ ok: true, service: 'addabaaz', version: VERSION, db: dbUp ? 'up' : 'down', time: new Date().toISOString() });
  }));
  api.get('/health/ready', wrap(async (_req, res) => {           // readiness for load balancers / orchestrators: 503 when MySQL is unreachable
    const dbUp = await db.ping().then(() => true, () => false);
    res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? 'up' : 'down' });
  }));
  api.get('/catalog', (req, res) => { res.set('Cache-Control', 'public, max-age=60'); res.json(cat()); });
  api.get('/plans', (_req, res) => res.json({ plans: PLANS }));

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
    catch (e) { if (isDuplicate(e)) throw new HttpError(409, 'email_taken', 'An account with this email already exists.'); throw e; }
    res.status(201).json({ token: signToken(user.id, secret), user: publicUser(user), profiles: [profile] });
  }));
  api.post('/auth/login', authLimit, wrap(async (req, res) => {
    const { email = '', password = '' } = req.body || {};
    const user = await db.users.byEmail(String(email).trim().toLowerCase());
    // Always run a hash to keep timing similar whether or not the user exists.
    const ok = user ? verifyPassword(String(password), user.passwordHash) : (verifyPassword(String(password), 'scrypt$00$00'), false);
    if (!ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
    res.json({ token: signToken(user.id, secret), user: publicUser(user) });
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

  /* ---------- authenticated ---------- */
  api.use(wrap(async (req, _res, next) => {
    const h = req.headers.authorization || '';
    const payload = h.startsWith('Bearer ') ? verifyToken(h.slice(7), secret) : null;
    const user = payload && await db.users.byId(String(payload.sub));
    if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    req.user = user; next();
  }));
  const ownProfile = async (req) => {
    const p = await db.profiles.get(req.params.pid, req.user.id);
    if (!p) throw new HttpError(404, 'not_found', 'Profile not found.');
    return p;
  };

  api.get('/me', wrap(async (req, res) => res.json({ user: publicUser(req.user), profiles: await db.profiles.list(req.user.id), subscription: await db.subscriptions.get(req.user.id) })));
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

  /* subscription — `mock` provider activates instantly (demo). Wire Razorpay/Stripe/Play Billing/StoreKit here. */
  api.get('/subscription', wrap(async (req, res) => res.json({ subscription: await db.subscriptions.get(req.user.id) })));
  api.post('/subscription', wrap(async (req, res) => {
    const plan = PLANS.find((p) => p.id === req.body?.planId);
    if (!plan) throw bad('Unknown plan.', 'unknown_plan');
    if (plan.id === 'free') { await db.subscriptions.set(req.user.id, { planId: 'free' }); return res.json({ subscription: await db.subscriptions.get(req.user.id) }); }
    if (paymentProvider !== 'mock') throw new HttpError(501, 'payments_not_configured', `Payment provider "${paymentProvider}" is not implemented yet.`);
    await db.subscriptions.set(req.user.id, { planId: plan.id, provider: 'mock', demo: true });
    res.status(201).json({ subscription: await db.subscriptions.get(req.user.id) });
  }));
  api.delete('/subscription', wrap(async (req, res) => { await db.subscriptions.set(req.user.id, { planId: 'free' }); res.json({ subscription: await db.subscriptions.get(req.user.id) }); }));

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
    if (status >= 500) console.error(err);
    res.status(status).json({ error: { code: err.code || 'server_error', message: status >= 500 ? 'Something went wrong.' : err.message } });
  });
  app.db = db;
  return app;
}
