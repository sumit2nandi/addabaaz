import { HttpError, bad, wrap } from './http.js';
import * as mail from './emails.js';

const asPage = (req, dflt = 50, max = 200) => ({ limit: Math.min(Math.max(Number(req.query.limit) || dflt, 1), max), offset: Math.max(Number(req.query.offset) || 0, 0) });

/**
 * Admin routes for the engagement features: analytics, comment moderation, refund requests, push notifications, error log.
 * Mounted by createAdminRouter (so they sit behind the same admin sign-in, rate limit and audit log).
 */
export function adminExtraRoutes({ router, db, billing, catalog, push, mailer, log, siteUrl }) {
  /* ---------- badges for the sidebar ---------- */
  router.get('/inbox', wrap(async (_req, res) => {
    const [comments, refunds, errors] = await Promise.all([db.comments.reviewCount(), db.refundRequests.pendingCount(), db.errors.count24h()]);
    res.json({ comments, refunds, errors });
  }));

  /* ---------- analytics ---------- */
  router.get('/analytics', wrap(async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const [watch, business, snap] = await Promise.all([db.playStats.overview(days), db.stats.overview(), catalog.get({ all: true })]);
    const shows = new Map(snap.catalog.shows.map((s) => [s.id, s]));
    const title = (id) => { const v = snap.videoById.get(id); return v ? (v.shortTitle || v.title) : id; };
    res.json({
      days, totals: watch.totals, daily: watch.daily,
      shows: watch.shows.map((s) => ({ ...s, title: shows.get(s.showId)?.titleEn || shows.get(s.showId)?.title || s.showId || '(no show)' })),
      videos: watch.videos.map((v) => ({ ...v, title: title(v.videoId), show: shows.get(v.showId)?.titleEn || shows.get(v.showId)?.title || null })),
      business: { days: (business.days || []).slice(-Math.min(days, 30)), revenue: business.revenue },
      note: 'Plays and watch time are counted by ADDABAAZ itself when a video is played on this site (YouTube’s own view counts are separate).',
    });
  }));

  /* ---------- comments ---------- */
  router.get('/comments', wrap(async (req, res) => {
    const filter = ['review', 'hidden', 'all'].includes(req.query.filter) ? req.query.filter : 'review';
    const out = await db.comments.adminList({ filter, q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '', ...asPage(req) });
    const snap = await catalog.get({ all: true });
    res.json({ total: out.total, comments: out.items.map((c) => ({ ...c, videoTitle: snap.videoById.get(c.videoId)?.title || c.videoId })) });
  }));
  const commentOr404 = async (id) => { const c = await db.comments.byId(String(id)); if (!c) throw new HttpError(404, 'not_found', 'Unknown comment.'); return c; };
  router.post('/comments/:id/approve', wrap(async (req, res) => { await commentOr404(req.params.id); await db.comments.setStatus(req.params.id, 'visible'); await log(req, 'comment.approve', req.params.id); res.sendStatus(204); }));
  router.post('/comments/:id/hide', wrap(async (req, res) => { await commentOr404(req.params.id); await db.comments.setStatus(req.params.id, 'hidden', 'admin'); await log(req, 'comment.hide', req.params.id); res.sendStatus(204); }));
  router.delete('/comments/:id', wrap(async (req, res) => { await commentOr404(req.params.id); await db.comments.remove(req.params.id); await log(req, 'comment.delete', req.params.id); res.sendStatus(204); }));

  /* ---------- refund requests ---------- */
  router.get('/refund-requests', wrap(async (req, res) => {
    const status = ['pending', 'approved', 'declined', 'all'].includes(req.query.status) ? req.query.status : 'pending';
    const out = await db.refundRequests.list({ status, ...asPage(req) });
    const items = await Promise.all(out.items.map(async (r) => { const p = await db.payments.byId(r.paymentId); return { ...r, payment: p && { id: p.id, planId: p.planId, amountPaise: p.amountPaise, refundedPaise: p.refundedPaise, paidAt: p.paidAt } }; }));
    res.json({ total: out.total, requests: items });
  }));
  const requestOr404 = async (id) => { const r = await db.refundRequests.get(String(id)); if (!r) throw new HttpError(404, 'not_found', 'Unknown refund request.'); return r; };
  router.post('/refund-requests/:id/approve', wrap(async (req, res) => {
    const r = await requestOr404(req.params.id); if (r.status !== 'pending') throw new HttpError(409, 'already_decided', `This request was already ${r.status}.`);
    const b = req.body || {}, note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : '';
    // decide first (only one admin can win), then refund; if the provider refuses, the request goes back to pending
    if (!(await db.refundRequests.decide(r.id, 'approved', req.admin.email, note))) throw new HttpError(409, 'already_decided', 'Someone else just decided this request.');
    try {
      const rec = await billing.refund({ paymentId: r.paymentId, amountPaise: b.amountPaise === undefined ? undefined : Number(b.amountPaise), reason: r.reason || 'Refund requested by customer', revokeAccess: b.revokeAccess !== false });
      await log(req, 'refund_request.approve', r.id, { paymentId: r.paymentId, amountPaise: rec.refund?.amountPaise });
      res.json({ refund: rec.refund, accessRevoked: rec.revoked });
    } catch (e) { await db.refundRequests.reopen(r.id); throw e; }
  }));
  router.post('/refund-requests/:id/decline', wrap(async (req, res) => {
    const r = await requestOr404(req.params.id), note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
    if (!(await db.refundRequests.decide(r.id, 'declined', req.admin.email, note))) throw new HttpError(409, 'already_decided', `This request was already ${r.status === 'pending' ? 'decided' : r.status}.`);
    const [user, pay] = await Promise.all([db.users.byId(r.userId), db.payments.byId(r.paymentId)]);
    if (user && mailer?.provider === 'smtp') mailer.send({ to: user.email, ...mail.refundDeclinedEmail({ name: user.name, planName: pay?.planId || 'your plan', note, supportEmail: billing.config.supportEmail, siteUrl }) }).catch(() => {});
    await log(req, 'refund_request.decline', r.id, { paymentId: r.paymentId, note });
    res.sendStatus(204);
  }));

  /* ---------- push notifications ---------- */
  router.get('/notifications', wrap(async (_req, res) => {
    const snap = await catalog.get({ all: true });
    res.json({
      configured: !!push?.configured, publicKey: push?.publicKey || '', subscribers: await db.push.count(),
      audiences: [{ id: 'news', label: 'Announcements — people who opted in to news' }, { id: 'all', label: 'Everyone who turned notifications on' },
        ...snap.catalog.shows.map((s) => ({ id: `show:${s.id}`, label: `Followers of ${s.titleEn || s.title}` })), ...snap.catalog.upcoming.map((u) => ({ id: `launch:${u.id}`, label: `Reminders for ${u.titleEn || u.title}` }))],
      history: (await db.audit.list({ action: 'notification.send', limit: 15 })).map((a) => ({ at: a.at, by: a.actor, audience: a.target, ...a.meta })),
    });
  }));
  router.post('/notifications/send', wrap(async (req, res) => {
    if (!push?.configured) throw new HttpError(503, 'push_not_configured', 'Push notifications are not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (see docs/ENGAGEMENT.md).');
    const b = req.body || {}, str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const title = str(b.title, 80), body = str(b.body, 180), url = str(b.url, 300) || '/';
    if (!title || !body) throw bad('A title and a message are required.');
    if (!/^\/(?!\/)/.test(url) && !/^https:\/\//.test(url)) throw bad('The link must start with / (a page on this site) or https://.');
    const snap = await catalog.get({ all: true }), a = String(b.audience || 'news'); let audience;
    if (a === 'news') audience = { kind: 'news' }; else if (a === 'all') audience = { kind: 'all' };
    else if (a.startsWith('show:')) { const id = a.slice(5); if (!snap.showIds.has(id)) throw bad('Unknown show.'); audience = { kind: 'episodes', showId: id, videoIds: snap.catalog.videos.filter((v) => v.showId === id).map((v) => v.id) }; }
    else if (a.startsWith('launch:')) { const id = a.slice(7); if (!snap.upcomingIds.has(id)) throw bad('Unknown coming-soon title.'); audience = { kind: 'launches', upcomingId: id }; }
    else throw bad('Unknown audience.');
    const r = await push.notify(audience, { title, body, url, tag: `admin-${Date.now()}` });
    await log(req, 'notification.send', a, { title, sent: r.sent, failed: r.failed, removed: r.removed });
    res.json(r);
  }));

  /* ---------- error log ---------- */
  router.get('/errors', wrap(async (_req, res) => res.json(await db.errors.list())));
  router.delete('/errors', wrap(async (req, res) => { await db.errors.clear(); await log(req, 'errors.clear'); res.sendStatus(204); }));
}
