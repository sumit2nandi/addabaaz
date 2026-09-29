import crypto from 'node:crypto';
import { HttpError, bad, wrap, rateLimit } from './http.js';
import { isDuplicate } from './db.js';
import { hashPassword, verifyPassword, signToken } from './auth.js';
import { endpointHash } from './push.js';
import * as mail from './emails.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const HOUR = 3600_000;
const passwordOk = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 128;
const noop = (_q, _s, n) => n();

/**
 * Account safety (password reset, email verification, change password, sign-out-everywhere, parental PIN),
 * viewing (ratings, comments, playback sessions / device limit, analytics), push subscriptions, refund requests and
 * the client error log. `public(api)` registers routes that need no sign-in; `authed(api)` those behind the session check.
 */
export function createFeatures({ db, secret, mailer, push, catalog, siteUrl, rate = true, publicUser, notDisabled, userFromRequest, plans = [], options = {} }) {
  const cfg = {
    streamLimit: options.streamLimit ?? (Number(process.env.STREAM_LIMIT) || 2),
    heartbeatWindowSec: options.heartbeatWindowSec ?? 90,
    refundWindowDays: options.refundWindowDays ?? (process.env.REFUND_WINDOW_DAYS === undefined ? 7 : Number(process.env.REFUND_WINDOW_DAYS)),
    reportsToHide: options.reportsToHide ?? 3,
    commentsPer10Min: options.commentsPer10Min ?? 5,
    requireVerifiedForActions: options.requireVerified ?? mailer.provider === 'smtp',    // without SMTP nobody could ever verify
  };
  const limit = (name, max, ms) => (rate ? rateLimit(name, max, ms) : noop);
  const authLimit = limit('auth2', 20, 60_000);
  const devLog = (msg) => { if (mailer.provider === 'none' && process.env.NODE_ENV !== 'production') console.log(`[mail:dev] ${msg}`); };
  const sendMail = (to, built, note) => { devLog(note); mailer.send({ to, ...built }).catch((e) => console.warn('[mail] send failed:', e.message)); };
  const sessionFor = (user, sv = user.sessionVersion || 0) => ({ token: signToken(user.id, secret, undefined, sv), user: publicUser(user) });

  async function sendVerification(user) {
    if (user.emailVerifiedAt) return false;
    const token = newToken();
    await db.authTokens.issue(user.id, 'verify', sha256(token), 3 * 24 * HOUR);
    const url = `${siteUrl}/verify?token=${token}`;
    sendMail(user.email, mail.verifyEmailEmail({ name: user.name, url, supportEmail: process.env.SUPPORT_EMAIL || '' }), `verify link for ${user.email}: ${url}`);
    return true;
  }

  const requireVerified = (user) => { if (cfg.requireVerifiedForActions && !user.emailVerifiedAt) throw new HttpError(403, 'email_unverified', 'Please confirm your email address first — we sent you a link. You can resend it from Account.'); };

  /** Server-checked parental PIN with lock-out. Used by the /me/pin endpoints and by profile changes (header X-Parental-Pin). */
  async function checkPin(user, pin) {
    const st = await db.accounts.pin(user.id);
    if (!st?.hash) return true;
    if (st.lockedUntil && st.lockedUntil > new Date()) throw new HttpError(429, 'pin_locked', `Too many wrong PINs. Try again in ${Math.ceil((st.lockedUntil - Date.now()) / 60_000)} minute(s).`);
    if (typeof pin === 'string' && /^\d{4,6}$/.test(pin) && verifyPassword(pin, st.hash)) { if (st.failed) await db.accounts.pinOk(user.id); return true; }
    await db.accounts.pinFailed(user.id, 5, 15 * 60_000);
    throw new HttpError(403, 'pin_invalid', 'Incorrect PIN.');
  }
  const requirePin = async (req) => { if (req.user.hasPin) { if (!req.get('x-parental-pin')) throw new HttpError(403, 'pin_required', 'Enter your parental PIN.'); await checkPin(req.user, req.get('x-parental-pin')); } };

  const deviceOf = (req) => {
    const id = String(req.get('x-device-id') || '').replace(/[^\w.-]/g, '').slice(0, 64) || `ip-${sha256(req.ip).slice(0, 16)}`;
    const ua = String(req.get('user-agent') || '');
    const label = String(req.get('x-device-label') || '').trim().slice(0, 80) || (/iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows PC' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Browser');
    return { id, label };
  };

  return {
    cfg, sendVerification, requireVerified, requirePin, checkPin, deviceOf,

    /** Registered by app.js after the sign-in step of signup: sends the confirmation email. */
    public(api) {
      api.post('/auth/forgot', authLimit, wrap(async (req, res) => {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!EMAIL.test(email) || email.length > 254) throw bad('Please enter a valid email address.', 'invalid_email');
        const user = await db.users.byEmail(email);
        if (user && !user.disabledAt) {
          const last = await db.authTokens.lastIssuedAt(user.id, 'reset');
          if (!last || Date.now() - last.getTime() > 60_000) {        // one email a minute per account
            const token = newToken();
            await db.authTokens.issue(user.id, 'reset', sha256(token), HOUR);
            const url = `${siteUrl}/reset?token=${token}`;
            sendMail(user.email, mail.resetPasswordEmail({ name: user.name, url, supportEmail: process.env.SUPPORT_EMAIL || '' }), `reset link for ${user.email}: ${url}`);
          }
        }
        res.status(202).json({ ok: true });                            // same answer whether or not the account exists
      }));
      api.post('/auth/reset', authLimit, wrap(async (req, res) => {
        const { token, password } = req.body || {};
        if (!passwordOk(password)) throw bad('Password must be 8–128 characters.', 'weak_password');
        const uid = typeof token === 'string' && token.length >= 20 && token.length <= 200 ? await db.authTokens.consume(sha256(token), 'reset') : null;
        if (!uid) throw new HttpError(400, 'invalid_token', 'This reset link is invalid or has expired. Please request a new one.');
        const user = await db.users.byId(uid); if (!user) throw new HttpError(400, 'invalid_token', 'This reset link is invalid or has expired.');
        notDisabled(user);
        const sv = await db.accounts.setPassword(uid, hashPassword(password), { verify: true });      // signs out every other device
        sendMail(user.email, mail.passwordChangedEmail({ name: user.name, siteUrl, supportEmail: process.env.SUPPORT_EMAIL || '' }), `password changed for ${user.email}`);
        res.json({ ...sessionFor({ ...user, emailVerifiedAt: user.emailVerifiedAt || new Date().toISOString() }, sv), profiles: await db.profiles.list(uid) });
      }));
      api.post('/auth/verify', authLimit, wrap(async (req, res) => {
        const token = req.body?.token;
        const uid = typeof token === 'string' && token.length >= 20 && token.length <= 200 ? await db.authTokens.consume(sha256(token), 'verify') : null;
        if (!uid) throw new HttpError(400, 'invalid_token', 'This confirmation link is invalid or has expired. Sign in and request a new one from Account.');
        await db.accounts.markVerified(uid);
        res.json({ verified: true });
      }));

      /* analytics (aggregate counters only — no personal data) */
      api.post('/events/play', limit('events', 120, 60_000), wrap(async (req, res) => {
        const { videoId, event, seconds } = req.body || {};
        const v = typeof videoId === 'string' ? await catalog.video(videoId) : null;
        if (!v || !['start', 'progress'].includes(event)) return res.sendStatus(204);
        const secs = Math.min(Math.max(Number(seconds) || 0, 0), Math.min(v.duration || 600, 600));    // a single report can't claim more than the video's length (or 10 min)
        await db.playStats.record(v.id, v.showId, { play: event === 'start', seconds: event === 'progress' ? secs : 0 });
        res.sendStatus(204);
      }));
      api.post('/client-errors', limit('clienterr', 20, 60_000), wrap(async (req, res) => {
        const b = req.body || {};
        if (typeof b.message === 'string' && b.message) await db.errors.add({ source: 'client', message: b.message, stack: b.stack, url: b.url, userAgent: req.get('user-agent') });
        res.sendStatus(204);
      }));

      /* ratings & comments: public reads */
      api.get('/ratings/:type/:id', wrap(async (req, res) => {
        if (!['show', 'video'].includes(req.params.type)) throw new HttpError(404, 'not_found', 'Unknown item.');
        res.set('Cache-Control', 'public, max-age=30'); res.json(await db.ratings.counts(req.params.type, req.params.id));
      }));
      api.get('/videos/:id/comments', wrap(async (req, res) => {
        if (!(await catalog.video(req.params.id))) throw new HttpError(404, 'not_found', 'Unknown video.');
        const before = req.query.before ? Date.parse(String(req.query.before)) : null;
        const [items, total] = await Promise.all([db.comments.list(req.params.id, { limit: 30, before: Number.isNaN(before) ? null : before }), db.comments.count(req.params.id)]);
        const me = await userFromRequest(req).catch(() => null);
        res.set('Cache-Control', 'no-store');
        res.json({ total, comments: items.map((c) => ({ id: c.id, author: c.author, body: c.body, createdAt: c.createdAt, ...(me && c.userId === me.id ? { mine: true } : {}) })) });
      }));

      /* push config */
      api.get('/push/config', (_req, res) => res.json({ enabled: push.configured, publicKey: push.publicKey || null }));
    },

    authed(api) {
      /* --- account --- */
      api.post('/me/verify/resend', authLimit, wrap(async (req, res) => {
        if (req.user.emailVerifiedAt) return res.json({ verified: true });
        const last = await db.authTokens.lastIssuedAt(req.user.id, 'verify');
        if (last && Date.now() - last.getTime() < 60_000) throw new HttpError(429, 'too_soon', 'We just sent one — please wait a minute before asking again.');
        await sendVerification(req.user); res.status(202).json({ ok: true });
      }));
      api.post('/me/password', authLimit, wrap(async (req, res) => {
        const { currentPassword, newPassword } = req.body || {};
        if (!passwordOk(newPassword)) throw bad('Password must be 8–128 characters.', 'weak_password');
        if (req.user.passwordHash && !verifyPassword(String(currentPassword || ''), req.user.passwordHash)) throw new HttpError(403, 'invalid_credentials', 'Your current password is incorrect.');
        const sv = await db.accounts.setPassword(req.user.id, hashPassword(newPassword));
        sendMail(req.user.email, mail.passwordChangedEmail({ name: req.user.name, siteUrl, supportEmail: process.env.SUPPORT_EMAIL || '' }), `password changed for ${req.user.email}`);
        res.json(sessionFor(req.user, sv));
      }));
      api.post('/me/sessions/revoke', authLimit, wrap(async (req, res) => { const sv = await db.accounts.bumpSessions(req.user.id); res.json(sessionFor(req.user, sv)); }));

      /* --- parental PIN --- */
      api.put('/me/pin', authLimit, wrap(async (req, res) => {
        const { pin, currentPin } = req.body || {};
        if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) throw bad('The PIN must be 4–6 digits.', 'invalid_pin');
        if (req.user.hasPin) await checkPin(req.user, currentPin);
        await db.accounts.setPin(req.user.id, hashPassword(pin)); res.sendStatus(204);
      }));
      api.post('/me/pin/verify', authLimit, wrap(async (req, res) => { await checkPin(req.user, req.body?.pin); res.json({ ok: true }); }));
      api.delete('/me/pin', authLimit, wrap(async (req, res) => { await checkPin(req.user, req.body?.pin); await db.accounts.setPin(req.user.id, null); res.sendStatus(204); }));

      /* --- devices & playback sessions --- */
      api.get('/me/devices', wrap(async (req, res) => res.json({ devices: (await db.playback.devices(req.user.id, cfg.heartbeatWindowSec)).map((d) => ({ ...d, current: d.deviceId === deviceOf(req).id })), streamLimit: cfg.streamLimit })));
      api.delete('/me/devices/:id', wrap(async (req, res) => { await db.playback.forget(req.user.id, req.params.id); res.sendStatus(204); }));
      api.post('/playback/heartbeat', limit('hb', 30, 60_000), wrap(async (req, res) => {
        const v = typeof req.body?.videoId === 'string' ? await catalog.video(req.body.videoId) : null;
        if (!v) throw new HttpError(404, 'not_found', 'Unknown video.');
        const d = deviceOf(req);
        const r = await db.playback.touch(req.user.id, d.id, d.label, v.id, { limit: cfg.streamLimit, windowSec: cfg.heartbeatWindowSec });
        if (!r.ok) throw new HttpError(429, 'stream_limit', `Your plan allows ${cfg.streamLimit} screens at once. Stop playback on another device to continue.`);
        res.json({ ok: true });
      }));
      api.post('/playback/stop', wrap(async (req, res) => { await db.playback.stop(req.user.id, deviceOf(req).id); res.sendStatus(204); }));

      /* --- ratings --- */
      const profileOf = async (req) => { const p = await db.profiles.get(req.params.pid, req.user.id); if (!p) throw new HttpError(404, 'not_found', 'Profile not found.'); return p; };
      api.get('/profiles/:pid/ratings', wrap(async (req, res) => { const p = await profileOf(req); res.json({ ratings: await db.ratings.mine(p.id) }); }));
      api.put('/profiles/:pid/ratings/:type/:id', wrap(async (req, res) => {
        const p = await profileOf(req), { type, id } = req.params, value = req.body?.value;
        if (!['show', 'video'].includes(type) || ![1, -1].includes(value)) throw bad('value must be 1 (like) or -1 (dislike).');
        if (!(await catalog.exists(type, id))) throw new HttpError(404, 'not_found', 'Unknown title.');
        await db.ratings.set(p.id, type, id, value); res.json(await db.ratings.counts(type, id));
      }));
      api.delete('/profiles/:pid/ratings/:type/:id', wrap(async (req, res) => { const p = await profileOf(req); await db.ratings.clear(p.id, req.params.type, req.params.id); res.json(await db.ratings.counts(req.params.type, req.params.id)); }));

      /* --- comments (signed in; verified email when email is configured) --- */
      api.post('/videos/:id/comments', limit('comment', 30, 10 * 60_000), wrap(async (req, res) => {
        if (!(await catalog.video(req.params.id))) throw new HttpError(404, 'not_found', 'Unknown video.');
        requireVerified(req.user);
        const body = String(req.body?.body ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
        if (!body || body.length > 1000) throw bad('Write a comment of 1–1000 characters.', 'invalid_comment');
        if ((body.match(/https?:\/\/|www\./gi) || []).length > 1) throw bad('Please keep links out of comments.', 'links_not_allowed');
        if ((await db.comments.recentBy(req.user.id, 600)) >= cfg.commentsPer10Min) throw new HttpError(429, 'rate_limited', 'You’re commenting very quickly — please wait a few minutes.');
        let author = req.user.name.split(/\s+/)[0].slice(0, 24);
        if (req.body?.profileId) { const p = await db.profiles.get(String(req.body.profileId), req.user.id); if (p) { if (p.kids) throw new HttpError(403, 'kids_profile', 'Comments are turned off on kids profiles.'); author = p.name; } }
        const c = { id: crypto.randomUUID(), videoId: req.params.id, userId: req.user.id, author, body };
        await db.comments.add(c);
        res.status(201).json({ comment: { id: c.id, author, body, createdAt: new Date().toISOString(), mine: true } });
      }));
      api.delete('/comments/:id', wrap(async (req, res) => {
        const c = await db.comments.byId(req.params.id);
        if (!c || c.userId !== req.user.id) throw new HttpError(404, 'not_found', 'Comment not found.');
        await db.comments.remove(c.id); res.sendStatus(204);
      }));
      api.post('/comments/:id/report', limit('report', 20, 60_000), wrap(async (req, res) => {
        const c = await db.comments.byId(req.params.id); if (!c || c.status !== 'visible') throw new HttpError(404, 'not_found', 'Comment not found.');
        if (c.userId === req.user.id) throw bad('You can’t report your own comment.');
        res.json(await db.comments.report(c.id, req.user.id, cfg.reportsToHide));
      }));

      /* --- push subscriptions --- */
      api.post('/push/subscribe', wrap(async (req, res) => {
        if (!push.configured) throw new HttpError(501, 'push_not_configured', 'Notifications aren’t enabled on this server.');
        const s = req.body?.subscription, prefs = req.body?.prefs || {};
        if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000 || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') throw bad('Invalid push subscription.');
        await db.push.upsert(req.user.id, { endpoint: s.endpoint, hash: endpointHash(s.endpoint), p256dh: s.keys.p256dh.slice(0, 200), auth: s.keys.auth.slice(0, 100) }, prefs);
        res.status(201).json({ ok: true });
      }));
      api.post('/push/status', wrap(async (req, res) => { res.json({ prefs: typeof req.body?.endpoint === 'string' ? await db.push.get(req.user.id, endpointHash(req.body.endpoint)) : null }); }));
      api.patch('/push/prefs', wrap(async (req, res) => {
        if (typeof req.body?.endpoint !== 'string') throw bad('endpoint is required.');
        await db.push.setPrefs(req.user.id, endpointHash(req.body.endpoint), req.body); res.sendStatus(204);
      }));
      api.post('/push/unsubscribe', wrap(async (req, res) => { if (typeof req.body?.endpoint === 'string') await db.push.remove(req.user.id, endpointHash(req.body.endpoint)); res.sendStatus(204); }));

      /* --- refund requests: the customer asks, an admin decides (admin console → Payments → Refund requests) --- */
      api.post('/payments/:id/refund-request', limit('refreq', 10, 60 * 60_000), wrap(async (req, res) => {
        const p = await db.payments.byId(req.params.id);
        if (!p || p.userId !== req.user.id) throw new HttpError(404, 'not_found', 'Payment not found.');
        if (p.status !== 'paid' || p.provider !== 'razorpay' || p.amountPaise <= 0) throw new HttpError(409, 'not_refundable', 'Only real, paid purchases can be refunded.');
        if (p.refundedPaise >= p.amountPaise) throw new HttpError(409, 'already_refunded', 'This payment has already been refunded.');
        const days = (Date.now() - Date.parse(p.paidAt)) / 86_400_000;
        if (!(cfg.refundWindowDays > 0) || days > cfg.refundWindowDays) throw new HttpError(409, 'outside_window', cfg.refundWindowDays > 0 ? `Refunds can be requested within ${cfg.refundWindowDays} days of purchase. Please contact us if you need help.` : 'Refund requests are turned off. Please contact us.');
        if (await db.refundRequests.pendingFor(p.id)) throw new HttpError(409, 'already_requested', 'You already asked for a refund on this payment — we’ll email you the outcome.');
        const reason = String(req.body?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 500);
        const id = crypto.randomUUID();
        await db.refundRequests.create({ id, paymentId: p.id, userId: req.user.id, reason });
        const planName = plans.find((x) => x.id === p.planId)?.name || p.planId;
        const support = process.env.SUPPORT_EMAIL;
        if (support) sendMail(support, mail.refundRequestEmail({ email: req.user.email, amountPaise: p.amountPaise, planName, paidAt: p.paidAt, reason, siteUrl }), `refund request from ${req.user.email}`);
        sendMail(req.user.email, mail.refundRequestReceivedEmail({ name: req.user.name, planName, amountPaise: p.amountPaise, supportEmail: support || '' }), `refund request received for ${req.user.email}`);
        res.status(201).json({ request: { id, status: 'pending' } });
      }));
      api.get('/refund-requests', wrap(async (req, res) => res.json({ requests: await db.refundRequests.forUser(req.user.id), windowDays: cfg.refundWindowDays })));
    },
  };
}
