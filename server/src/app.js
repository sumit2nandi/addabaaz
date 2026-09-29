import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Db } from './db.js';
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

export function createApp({
  dbFile = process.env.DB_FILE || path.join(ROOT, 'server/data/db.json'),
  jwtSecret = process.env.JWT_SECRET,
  corsOrigins = process.env.CORS_ORIGINS || '*',
  serveStatic = true,
  paymentProvider = process.env.PAYMENT_PROVIDER || 'mock',
  contactWebhook = process.env.CONTACT_WEBHOOK_URL || '',
  rate = true,
} = {}) {
  const db = new Db(dbFile);
  const secret = jwtSecret || db.data.meta.secret;
  if (process.env.NODE_ENV === 'production' && !jwtSecret) throw new Error('JWT_SECRET must be set in production');
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
  api.get('/health', (_req, res) => res.json({ ok: true, service: 'addabaaz', version: VERSION, time: new Date().toISOString() }));
  api.get('/catalog', (req, res) => { res.set('Cache-Control', 'public, max-age=60'); res.json(cat()); });
  api.get('/plans', (_req, res) => res.json({ plans: PLANS }));

  const authLimit = rate ? rateLimit('auth', 20, 60_000) : (_q, _s, n) => n();
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });
  const profilesOf = (userId) => db.data.profiles.filter((p) => p.userId === userId).map(({ id, name, color }) => ({ id, name, color }));
  const subOf = (userId) => db.data.subscriptions[userId] || { planId: 'free', status: 'active' };

  api.post('/auth/signup', authLimit, wrap((req, res) => {
    const { name = '', email = '', password = '' } = req.body || {};
    if (typeof email !== 'string' || !EMAIL.test(email.trim()) || email.length > 254) throw bad('Please enter a valid email address.', 'invalid_email');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw bad('Password must be 8–128 characters.', 'weak_password');
    if (typeof name !== 'string' || !name.trim() || name.length > 60) throw bad('Please enter your name.', 'invalid_name');
    const mail = email.trim().toLowerCase();
    if (db.data.users.some((u) => u.email === mail)) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
    const user = { id: crypto.randomUUID(), email: mail, name: name.trim(), passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
    db.data.users.push(user);
    db.data.profiles.push({ id: crypto.randomUUID(), userId: user.id, name: user.name.split(/\s+/)[0].slice(0, 24), color: 0 });
    db.save();
    res.status(201).json({ token: signToken(user.id, secret), user: publicUser(user), profiles: profilesOf(user.id) });
  }));
  api.post('/auth/login', authLimit, wrap((req, res) => {
    const { email = '', password = '' } = req.body || {};
    const user = db.data.users.find((u) => u.email === String(email).trim().toLowerCase());
    // Always run a hash to keep timing similar whether or not the user exists.
    const ok = user ? verifyPassword(String(password), user.passwordHash) : (verifyPassword(String(password), 'scrypt$00$00'), false);
    if (!ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
    res.json({ token: signToken(user.id, secret), user: publicUser(user) });
  }));

  api.post('/contact', rate ? rateLimit('contact', 5, 10 * 60_000) : (_q, _s, n) => n(), wrap(async (req, res) => {
    const { name = '', email = '', phone = '', message = '', website = '' } = req.body || {};
    if (website) return res.status(202).json({ ok: true });          // honeypot
    if (!String(name).trim() || !EMAIL.test(String(email).trim()) || !String(message).trim()) throw bad('Name, a valid email and a message are required.');
    if (String(message).length > 5000 || String(name).length > 100 || String(phone).length > 40) throw bad('One of the fields is too long.');
    const entry = { id: crypto.randomUUID(), name: String(name).trim(), email: String(email).trim(), phone: String(phone).trim(), message: String(message).trim(), at: new Date().toISOString() };
    db.data.contacts.push(entry); db.save();
    if (contactWebhook) fetch(contactWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch((e) => console.warn('[contact] webhook failed', e.message));
    res.status(202).json({ ok: true });
  }));

  /* ---------- authenticated ---------- */
  const requireAuth = (req, _res, next) => {
    const h = req.headers.authorization || '';
    const payload = h.startsWith('Bearer ') ? verifyToken(h.slice(7), secret) : null;
    const user = payload && db.data.users.find((u) => u.id === payload.sub);
    if (!user) return next(new HttpError(401, 'unauthorized', 'Please sign in.'));
    req.user = user; next();
  };
  const ownProfile = (req) => {
    const p = db.data.profiles.find((x) => x.id === req.params.pid && x.userId === req.user.id);
    if (!p) throw new HttpError(404, 'not_found', 'Profile not found.');
    return p;
  };
  api.use(requireAuth);

  api.get('/me', (req, res) => res.json({ user: publicUser(req.user), profiles: profilesOf(req.user.id), subscription: subOf(req.user.id) }));
  api.patch('/me', (req, res) => {
    const n = req.body?.name; if (typeof n !== 'string' || !n.trim() || n.length > 60) throw bad('Please enter your name.');
    req.user.name = n.trim(); db.save(); res.json({ user: publicUser(req.user) });
  });
  api.delete('/me', (req, res) => {           // required by Apple App Store guideline 5.1.1(v) & Google Play policy
    const ids = db.data.profiles.filter((p) => p.userId === req.user.id).map((p) => p.id);
    ids.forEach((id) => delete db.data.library[id]);
    db.data.profiles = db.data.profiles.filter((p) => p.userId !== req.user.id);
    db.data.users = db.data.users.filter((u) => u.id !== req.user.id);
    delete db.data.subscriptions[req.user.id]; db.save(); res.sendStatus(204);
  });

  /* profiles */
  const cleanProfile = (b, partial = false) => {
    const out = {};
    if (!partial || b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 24) throw bad('Profile name must be 1–24 characters.'); out.name = b.name.trim(); }
    if (b.color !== undefined) { if (!Number.isInteger(b.color) || b.color < 0 || b.color >= PALETTE) throw bad('Invalid colour.'); out.color = b.color; }
    return out;
  };
  api.get('/profiles', (req, res) => res.json({ profiles: profilesOf(req.user.id) }));
  api.post('/profiles', (req, res) => {
    if (profilesOf(req.user.id).length >= MAX_PROFILES) throw new HttpError(409, 'profile_limit', `You can have up to ${MAX_PROFILES} profiles.`);
    const p = { id: crypto.randomUUID(), userId: req.user.id, color: profilesOf(req.user.id).length % PALETTE, ...cleanProfile(req.body || {}) };
    db.data.profiles.push(p); db.save(); res.status(201).json({ profile: { id: p.id, name: p.name, color: p.color } });
  });
  api.patch('/profiles/:pid', (req, res) => {
    const p = ownProfile(req); Object.assign(p, cleanProfile(req.body || {}, true)); db.save(); res.json({ profile: { id: p.id, name: p.name, color: p.color } });
  });
  api.delete('/profiles/:pid', (req, res) => {
    const p = ownProfile(req);
    if (profilesOf(req.user.id).length <= 1) throw new HttpError(409, 'last_profile', 'At least one profile is required.');
    db.data.profiles = db.data.profiles.filter((x) => x.id !== p.id); delete db.data.library[p.id]; db.save(); res.sendStatus(204);
  });

  /* library: My List, progress, reminders */
  api.get('/profiles/:pid/library', (req, res) => { const p = ownProfile(req); res.json(db.lib(p.id)); });
  api.put('/profiles/:pid/list/:type/:id', (req, res) => {
    const p = ownProfile(req); const { type, id } = req.params;
    if (!exists(type, id)) throw new HttpError(404, 'not_found', 'Unknown title.');
    const lib = db.lib(p.id);
    if (!lib.list.some((x) => x.type === type && x.id === id)) lib.list.push({ type, id, addedAt: new Date().toISOString() });
    db.save(); res.sendStatus(204);
  });
  api.delete('/profiles/:pid/list/:type/:id', (req, res) => {
    const p = ownProfile(req); const lib = db.lib(p.id);
    lib.list = lib.list.filter((x) => !(x.type === req.params.type && x.id === req.params.id)); db.save(); res.sendStatus(204);
  });
  api.put('/profiles/:pid/progress/:videoId', (req, res) => {
    const p = ownProfile(req); const { position, duration } = req.body || {};
    if (!exists('video', req.params.videoId)) throw new HttpError(404, 'not_found', 'Unknown video.');
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration ?? 0) || (duration ?? 0) < 0) throw bad('position and duration must be non-negative numbers.');
    const lib = db.lib(p.id);
    lib.progress[req.params.videoId] = { position: Math.floor(position), duration: Math.floor(duration || 0), updatedAt: new Date().toISOString() };
    const keys = Object.keys(lib.progress);                        // cap history per profile
    if (keys.length > 500) keys.sort((a, b) => lib.progress[a].updatedAt.localeCompare(lib.progress[b].updatedAt)).slice(0, keys.length - 500).forEach((k) => delete lib.progress[k]);
    db.save(); res.sendStatus(204);
  });
  api.delete('/profiles/:pid/progress/:videoId', (req, res) => { const p = ownProfile(req); delete db.lib(p.id).progress[req.params.videoId]; db.save(); res.sendStatus(204); });
  api.put('/profiles/:pid/reminders/:id', (req, res) => {
    const p = ownProfile(req); if (!exists('upcoming', req.params.id)) throw new HttpError(404, 'not_found', 'Unknown title.');
    const lib = db.lib(p.id); if (!lib.reminders.includes(req.params.id)) lib.reminders.push(req.params.id); db.save(); res.sendStatus(204);
  });
  api.delete('/profiles/:pid/reminders/:id', (req, res) => { const p = ownProfile(req); const lib = db.lib(p.id); lib.reminders = lib.reminders.filter((x) => x !== req.params.id); db.save(); res.sendStatus(204); });

  /* subscription — `mock` provider activates instantly (demo). Wire Razorpay/Stripe/Play Billing/StoreKit here. */
  api.get('/subscription', (req, res) => res.json({ subscription: subOf(req.user.id) }));
  api.post('/subscription', (req, res) => {
    const plan = PLANS.find((p) => p.id === req.body?.planId);
    if (!plan) throw bad('Unknown plan.', 'unknown_plan');
    if (plan.id === 'free') { db.data.subscriptions[req.user.id] = { planId: 'free', status: 'active' }; db.save(); return res.json({ subscription: subOf(req.user.id) }); }
    if (paymentProvider !== 'mock') throw new HttpError(501, 'payments_not_configured', `Payment provider "${paymentProvider}" is not implemented yet.`);
    db.data.subscriptions[req.user.id] = { planId: plan.id, status: 'active', provider: 'mock', demo: true, startedAt: new Date().toISOString() };
    db.save(); res.status(201).json({ subscription: subOf(req.user.id) });
  });
  api.delete('/subscription', (req, res) => { db.data.subscriptions[req.user.id] = { planId: 'free', status: 'active' }; db.save(); res.json({ subscription: subOf(req.user.id) }); });

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
