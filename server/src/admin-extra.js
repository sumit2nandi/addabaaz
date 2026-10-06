import { HttpError, bad, wrap } from './http.js';
import * as mail from './emails.js';
import { TICKET_CATEGORIES, emailTemplates } from './routes/support.js';
import { notificationPayload } from './push.js';
import { normalizePhone, generateOtp, maskPhone } from './sms.js';

// Reads `limit` / `offset` from the query string.
const asPage = (req, dflt = 50, max = 200) => ({ limit: Math.min(Math.max(Number(req.query.limit) || dflt, 1), max), offset: Math.max(Number(req.query.offset) || 0, 0) });

/**
 * Admin routes for analytics, refund requests, push notifications, support tickets and the error log.
 * Mounted by createAdminRouter (so they sit behind the same admin sign-in, rate limit and audit log).
 */
export function adminExtraRoutes({ router, db, billing, catalog, push, mailer, campaigns = null, unsubscribeUrlFor = null, log, logger = console, siteUrl, sms = null, email = mail.campaignEmail }) {
  // Notifications and e-mail images are rendered by the viewer's device: a site-relative path has to be
  // absolute before it leaves the server, or the image will not load.
  const absoluteUrl = (v) => (/^https?:/i.test(v) ? v : `${String(siteUrl || '').replace(/\/+$/, '')}${String(v).startsWith('/') ? '' : '/'}${v}`);
  /* ---------- badges for the sidebar ---------- */
  // Counts shown as badges in the admin sidebar: pending refund requests, recent errors and open support tickets.
  router.get('/inbox', wrap(async (_req, res) => {
    const [refunds, errors, tickets] = await Promise.all([db.refundRequests.pendingCount(), db.errors.count24h(), db.tickets.awaitingCount().catch((e) => { logger.warn('[admin] ticket inbox count failed:', e); return 0; })]);
    res.json({ refunds, errors, tickets });
  }));

  /* ---------- email delivery diagnostic ---------- */
  // Send a real message to the signed-in administrator. This catches SMTP credentials, network/port
  // restrictions and sender configuration that the setup checklist cannot detect from the presence of SMTP_URL alone.
  router.post('/email/test', wrap(async (req, res) => {
    if (req.admin.via !== 'session') throw new HttpError(400, 'email_test_requires_session', 'Sign in with an administrator account to test email delivery.');
    if (mailer?.provider !== 'smtp') throw new HttpError(503, 'email_not_configured', 'Email delivery is not configured. Set SMTP_URL and MAIL_FROM, then restart the service.');
    try {
      const result = await mailer.send({
        to: req.admin.email,
        subject: 'ADDABAAZ email delivery test',
        text: 'This test message confirms that ADDABAAZ can send email through its configured SMTP provider.',
      });
      if (!result?.sent) throw new Error('The mailer did not send the test message.');
    } catch (e) {
      const code = typeof e.code === 'string' ? e.code.replace(/[^\w.-]/g, '').slice(0, 40) : '';
      throw new HttpError(503, 'email_send_failed', `The SMTP test email could not be sent${code ? ` (${code})` : ''}. Check the server runtime logs and SMTP settings.`, { cause: e });
    }
    await log(req, 'email.test', req.admin.email);
    res.json({ sent: true, to: req.admin.email });
  }));

  /* ---------- SMS delivery diagnostic ---------- */
  // Sends the same kind of 6-digit code a viewer gets to a number the administrator types, so MSG91, the
  // DLT-approved template and the number format can be checked before viewers depend on it. The code is
  // never stored, shown or logged — only the masked number reaches the audit log.
  router.post('/sms/test', wrap(async (req, res) => {
    if (req.admin.via !== 'session') throw new HttpError(400, 'sms_test_requires_session', 'Sign in with an administrator account to test SMS delivery.');
    if (sms?.provider !== 'msg91') throw new HttpError(503, 'sms_not_configured', 'Real SMS is not configured. Set MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID, restart the service and try again (docs/MSG91.md).');
    const phone = normalizePhone(req.body?.to, sms.countryCode);
    if (!phone) throw bad('Enter the phone number with its country code, for example +91 98123 45678.');
    try {
      await sms.send({ phone, code: generateOtp(6), minutes: 10 });
    } catch (e) {
      const code = typeof e.code === 'string' ? e.code.replace(/[^\w.-]/g, '').slice(0, 40) : '';
      throw new HttpError(e.status === 502 || e.status === 503 ? e.status : 502, code || 'sms_send_failed', `${e.message || 'The test SMS could not be sent.'} Check MSG91 (auth key, template, DLT header) and the server log.`, { cause: e });
    }
    await log(req, 'sms.test', maskPhone(phone));
    res.json({ sent: true, to: maskPhone(phone) });
  }));

  /* ---------- analytics ---------- */
  // Analytics page: watch statistics (counted by us) joined with catalog titles, plus business numbers from the dashboard queries.
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

  /* ---------- refund requests ---------- */
  // Customers' refund requests, with the payment each refers to.
  router.get('/refund-requests', wrap(async (req, res) => {
    const status = ['pending', 'approved', 'declined', 'all'].includes(req.query.status) ? req.query.status : 'pending';
    const out = await db.refundRequests.list({ status, ...asPage(req) });
    const items = await Promise.all(out.items.map(async (r) => { const p = await db.payments.byId(r.paymentId); return { ...r, payment: p && { id: p.id, planId: p.planId, amountPaise: p.amountPaise, refundedPaise: p.refundedPaise, paidAt: p.paidAt } }; }));
    res.json({ total: out.total, requests: items });
  }));
  const requestOr404 = async (id) => { const r = await db.refundRequests.get(String(id)); if (!r) throw new HttpError(404, 'not_found', 'Unknown refund request.'); return r; };
  // Approve: first mark it decided (so two admins cannot both act), then refund through the payment provider. If the provider refuses, put the request back to pending so it can be retried.
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
  // Decline with an optional note; the customer is e-mailed when SMTP is configured.
  router.post('/refund-requests/:id/decline', wrap(async (req, res) => {
    const r = await requestOr404(req.params.id), note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
    if (!(await db.refundRequests.decide(r.id, 'declined', req.admin.email, note))) throw new HttpError(409, 'already_decided', `This request was already ${r.status === 'pending' ? 'decided' : r.status}.`);
    const [user, pay] = await Promise.all([db.users.byId(r.userId), db.payments.byId(r.paymentId)]);
    if (user && mailer?.provider === 'smtp') mailer.send({ to: user.email, ...mail.refundDeclinedEmail({ name: user.name, planName: pay?.planId || 'your plan', note, supportEmail: billing.config.supportEmail, siteUrl }) }).catch((e) => logger.warn('[refund] decline e-mail failed:', e));
    await log(req, 'refund_request.decline', r.id, { paymentId: r.paymentId, note });
    res.sendStatus(204);
  }));

  /* ---------- broadcast notifications: app push + e-mail (Admin → Notifications) ---------- */
  // Everything the Broadcast page needs: which channels are configured, how many devices/accounts each
  // audience reaches, the people a campaign can be sent to, and the recent broadcasts with their progress.
  const EMAIL_AUDIENCES = [
    { id: 'all', label: 'All accounts' },
    { id: 'paid', label: 'Active subscribers' },
    { id: 'free', label: 'Free accounts' },
    { id: 'expiring', label: 'Expiring within 7 days' },
    { id: 'expired', label: 'Expired subscriptions' },
  ];
  const pushConfigured = () => !!(push?.configured || push?.nativeConfigured);
  const mailConfigured = () => mailer?.provider === 'smtp';
  router.get('/notifications', wrap(async (_req, res) => {
    const snap = await catalog.get({ all: true });
    const [webSubscribers, nativeDevices, optedOut] = await Promise.all([db.push.count(), db.devices.count(), db.adminUsers.emailOptOutCount()]);
    const emailAudiences = await Promise.all(EMAIL_AUDIENCES.map(async (a) => ({ ...a, count: await db.adminUsers.emailAudienceCount(a.id) })));
    const recent = (await db.campaigns.list({ limit: 25 })).map((c) => ({ ...c, at: c.createdAt }));
    res.json({
      // Channel status: push (web + native apps) and e-mail.
      push: { configured: pushConfigured(), web: !!push?.configured, native: !!push?.nativeConfigured, webSubscribers, nativeDevices, publicKey: push?.publicKey || '' },
      email: { configured: mailConfigured(), from: mailer?.from || '', optedOut, audiences: emailAudiences },
      // Legacy keys (older admin builds / scripts read these).
      configured: pushConfigured(), publicKey: push?.publicKey || '', subscribers: webSubscribers,
      audiences: [{ id: 'news', label: 'Announcements — everyone whose announcements are on (the default)' }, { id: 'all', label: 'Everyone who turned notifications on' },
        ...snap.catalog.shows.map((s) => ({ id: `show:${s.id}`, label: `Followers of ${s.titleEn || s.title}` })), ...snap.catalog.upcoming.map((u) => ({ id: `launch:${u.id}`, label: `Reminders for ${u.titleEn || u.title}` }))],
      history: recent, campaigns: recent,
    });
  }));
  // Send a broadcast (push or e-mail). Title/body/link are length-limited; the link must be a site path or
  // https URL; the audience is validated against the catalog (push) or the user filters (e-mail).
  // Sending happens in the background: the reply carries the campaign id, the console polls its progress.
  router.post('/notifications/send', wrap(async (req, res) => {
    const b = req.body || {}, str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const channel = b.channel === 'email' ? 'email' : 'push';
    if (!campaigns) throw new HttpError(503, 'not_available', 'Broadcasts are not available on this server.');
    if (channel === 'push' && !pushConfigured()) throw new HttpError(503, 'push_not_configured', 'Push notifications are not configured on this server. See docs/ENGAGEMENT.md and docs/MOBILE.md.');
    if (channel === 'email' && !mailConfigured()) throw new HttpError(503, 'email_not_configured', 'E-mail is not configured on this server. Set SMTP_URL and MAIL_FROM.');
    const limit = channel === 'email' ? { title: 120, body: 4000 } : { title: 80, body: 180 };
    const title = str(b.title, limit.title), body = str(b.body, limit.body), url = str(b.url, 300) || '/', button = str(b.button, 40);
    const imageUrl = normalizeImage(b.imageUrl), imageAlt = str(b.imageAlt, 200);
    if (!title || !body) throw bad('A title and a message are required.');
    if (b.imageUrl && !imageUrl) throw bad('The image must be an https:// URL or a local path under /uploads/, /media/ or /r2-assets/broadcast/.', 'invalid_image');
    if (!/^\/(?!\/)/.test(url) && !/^https:\/\//.test(url)) throw bad('The link must start with / (a page on this site) or https://.');
    const a = String(b.audience || (channel === 'email' ? 'all' : 'news'));
    const snap = await catalog.get({ all: true });
    // Push audiences reach followers/opt-ins; e-mail audiences reuse the Users page filters (see db-admin.js).
    const pushAudience = (id) => {
      if (id === 'news') return { kind: 'news' };
      if (id === 'all') return { kind: 'all' };
      if (id.startsWith('show:')) { const sid = id.slice(5); if (!snap.showIds.has(sid)) throw bad('Unknown show.'); return { kind: 'episodes', showId: sid, videoIds: snap.catalog.videos.filter((v) => v.showId === sid).map((v) => v.id) }; }
      if (id.startsWith('launch:')) { const uid = id.slice(7); if (!snap.upcomingIds.has(uid)) throw bad('Unknown coming-soon title.'); return { kind: 'launches', upcomingId: uid }; }
      throw bad('Unknown audience.');
    };
    if (channel === 'push') pushAudience(a);
    else if (!EMAIL_AUDIENCES.some((x) => x.id === a)) throw bad('Unknown audience.');
    const campaign = await campaigns.start(
      { channel, audience: a, title, body, url, button: button || null, imageUrl: imageUrl || null, imageAlt: imageAlt || null, by: req.admin.email },
      { resolveAudience: pushAudience, unsubscribeUrlFor, siteUrl },
    );
    await log(req, 'notification.send', a, { channel, title, campaign: campaign.id, status: campaign.status });
    res.status(202).json(campaign);
  }));
  // Progress of one broadcast (polled by the console while it sends).
  router.get('/notifications/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    const c = await db.campaigns.get(id);
    if (!c) throw new HttpError(404, 'not_found', 'Unknown broadcast.');
    const deliveryCounts = await db.campaigns.deliveryCounts?.(id) || {};
    res.json({ ...c, deliveryCounts, at: c.createdAt, done: ['sent', 'partial', 'failed', 'cancelled'].includes(c.status) });
  }));
  // Per-recipient outcomes (including device-level rows for app/browser push), filtered and paged for large audiences.
  router.get('/notifications/:id/deliveries', wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!(await db.campaigns.get(id))) throw new HttpError(404, 'not_found', 'Unknown broadcast.');
    if (typeof db.campaigns.deliveries !== 'function') return res.json({ total: 0, limit: 50, offset: 0, deliveries: [] });
    const { limit, offset } = asPage(req, 50, 100);
    const status = ['pending', 'sent', 'failed', 'skipped'].includes(req.query.status) ? req.query.status : 'all';
    const search = String(req.query.q || '').trim().slice(0, 100);
    res.json(await db.campaigns.deliveries(id, { status, search, limit, offset }));
  }));
  // Send one test message to the signed-in administrator (push: their own devices; e-mail: their address).
  router.post('/notifications/test', wrap(async (req, res) => {
    if (req.admin.via !== 'session') throw new HttpError(400, 'test_requires_session', 'Sign in with an administrator account to send a test.');
    if (!campaigns) throw new HttpError(503, 'not_available', 'Broadcasts are not available on this server.');
    const b = req.body || {}, str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const channel = b.channel === 'email' ? 'email' : 'push';
    const title = str(b.title, 120), body = str(b.body, channel === 'push' ? 180 : 4000), url = str(b.url, 300) || '/', button = str(b.button, 40);
    const imageUrl = normalizeImage(b.imageUrl), imageAlt = str(b.imageAlt, 200);
    if (!title || !body) throw bad('A title and a message are required.');
    const me = await db.users.byId(req.admin.id || req.admin.userId);
    if (!me) throw new HttpError(404, 'not_found', 'Admin account not found.');
    const r = await campaigns.sendTest({ channel, to: me.email, userId: me.id, name: me.name, title, body, url, button: button || null, imageUrl: imageUrl || null, imageAlt: imageAlt || null, siteUrl, unsubscribeUrlFor });
    if (!r.ok) throw new HttpError(409, 'test_failed', r.error || 'The test could not be sent.');
    await log(req, 'notification.test', channel, { title, to: me.email });
    res.json({ ok: true });
  }));

  /* ---------- support tickets (Admin → Support) ---------- */
  // The queue behind the public Support page: filters, the full conversation, triage (status/priority),
  // replies that are e-mailed to the viewer, and delete.
  router.get('/tickets', wrap(async (req, res) => {
    const { limit, offset } = asPage(req, 25, 100);
    const status = ['open', 'pending', 'resolved', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'all';
    const category = TICKET_CATEGORIES.includes(req.query.category) ? req.query.category : 'all';
    const search = String(req.query.q || '').trim().slice(0, 80);
    const userId = String(req.query.user || '').trim() || null;
    res.json(await db.tickets.list({ status, category, search, userId, limit, offset }));
  }));
  router.get('/tickets/:id', wrap(async (req, res) => {
    const ticket = await db.tickets.get(String(req.params.id));
    if (!ticket) throw new HttpError(404, 'not_found', 'Unknown support ticket.');
    const replies = await db.tickets.replies(ticket.id);
    // The account behind the ticket (if any) helps the admin see the plan/verification state at a glance.
    const account = ticket.userId ? await db.users.byId(ticket.userId).catch((e) => { logger.warn('[admin] support ticket account lookup failed:', e); return null; }) : null;
    res.json({ ticket, replies, account: account ? { id: account.id, email: account.email, name: account.name, disabled: !!account.disabledAt, phone: account.phone || null } : null });
  }));
  router.patch('/tickets/:id', wrap(async (req, res) => {
    const b = req.body || {};
    const status = ['open', 'pending', 'resolved', 'closed'].includes(b.status) ? b.status : null;
    const priority = ['low', 'normal', 'high'].includes(b.priority) ? b.priority : null;
    const adminNote = typeof b.adminNote === 'string' ? b.adminNote.trim().slice(0, 300) : undefined;
    if (!status && !priority && adminNote === undefined) throw bad('Nothing to update.');
    const ok = await db.tickets.update(String(req.params.id), { status, priority, adminNote, handledBy: req.admin.email });
    if (!ok) throw new HttpError(404, 'not_found', 'Unknown support ticket.');
    await log(req, 'ticket.update', req.params.id, { status, priority });
    res.json({ ticket: await db.tickets.get(String(req.params.id)) });
  }));
  // An admin reply: stored in the thread, status moves to pending (waiting on the viewer) and the answer
  // is e-mailed to the address on the ticket. Without SMTP the reply is still stored — the console says so.
  router.post('/tickets/:id/replies', wrap(async (req, res) => {
    const ticket = await db.tickets.get(String(req.params.id));
    if (!ticket) throw new HttpError(404, 'not_found', 'Unknown support ticket.');
    const body = String(req.body?.body || '').replace(/\u0000/g, '').trim().slice(0, 5000);
    if (body.length < 2) throw bad('Write a reply first.');
    const status = ['open', 'pending', 'resolved', 'closed'].includes(req.body?.status) ? req.body.status : 'pending';
    await db.tickets.addReply({ id: crypto.randomUUID(), ticketId: ticket.id, author: 'admin', authorName: req.admin.name || req.admin.email, authorId: req.admin.id, body, status });
    let emailed = false;
    if (mailer?.provider === 'smtp') {
      try {
        const built = emailTemplates.adminAnswered({ body, ref: `ADD-${ticket.id.slice(0, 8).toUpperCase()}`, subject: ticket.subject, supportEmail: billing?.config?.supportEmail || '', siteUrl });
        const r = await mailer.send({ to: ticket.email, ...built });
        emailed = !!r?.sent;
      } catch (e) { logger.warn('[support] reply e-mail failed:', e); }
    }
    await log(req, 'ticket.reply', ticket.id, { status, emailed });
    res.status(201).json({ ok: true, emailed, ticket: await db.tickets.get(ticket.id), replies: await db.tickets.replies(ticket.id) });
  }));
  router.delete('/tickets/:id', wrap(async (req, res) => {
    const done = await db.tickets.remove(String(req.params.id));
    if (!done) throw new HttpError(404, 'not_found', 'Unknown support ticket.');
    await log(req, 'ticket.delete', req.params.id);
    res.sendStatus(204);
  }));

  /* ---------- broadcast preview (Admin → Broadcast) ---------- */
  // Renders exactly what a broadcast would look like WITHOUT sending it: the browser/app notification
  // (same payload builder the sender uses) and the e-mail (the same template the campaign uses, including
  // the unsubscribe footer). Nothing is written to the database and no message leaves the server.
  router.post('/notifications/preview', wrap(async (req, res) => {
    const b = req.body || {}, str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const channel = b.channel === 'email' ? 'email' : 'push';
    const title = str(b.title, channel === 'email' ? 120 : 80), body = str(b.body, channel === 'email' ? 4000 : 180);
    const url = str(b.url, 300) || '/', button = str(b.button, 40);
    const imageUrl = normalizeImage(b.imageUrl);
    if (!title && !body) throw bad('Write a title or a message to preview.');
    if (channel === 'push') {
      // The same helper the real send uses, so the preview cannot drift from what viewers receive.
      const payload = notificationPayload({ title, body, url, image: imageUrl ? absoluteUrl(imageUrl) : null });
      res.json({ channel, push: { ...payload, appBadge: 1 }, image: imageUrl ? absoluteUrl(imageUrl) : null, note: 'This is how the notification appears on a phone. Nothing has been sent.' });
    } else {
      const built = email({ name: 'Priya', email: 'priya@example.com', subject: title || '(no subject)', body, button: button ? { label: button, url } : null, siteUrl, unsubscribeUrl: `${siteUrl || ''}/api/v1/notifications/unsubscribe?u=preview&t=preview`, image: imageUrl ? absoluteUrl(imageUrl) : null, imageAlt: str(b.imageAlt, 200) });
      res.json({ channel, email: built, note: 'This is the e-mail viewers receive. Nothing has been sent.' });
    }
  }));

  /* ---------- clear client caches (Admin → Client cache) ---------- */
  // Every browser and installed app asks for the current cache version when it starts; bumping the
  // version makes each of them drop its cached files and fetch fresh ones. `scope: 'all'` also clears the
  // local data those clients keep (never the sign-in token on the web — that would sign everyone out).
  router.get('/cache', wrap(async (_req, res) => res.json(await cacheState())));
  router.post('/cache/purge', wrap(async (req, res) => {
    const scope = req.body?.scope === 'all' ? 'all' : 'assets';
    const version = await db.settings.bump('client_cache_version');
    await db.settings.set('client_cache_scope', scope);
    await log(req, 'cache.purge', scope, { version });
    res.json({ ...(await cacheState()), purged: true });
  }));

  /** Current client-cache state (version + scope + when it last changed). */
  async function cacheState() {
    const [version, scope] = await Promise.all([db.settings.get('client_cache_version', '1'), db.settings.get('client_cache_scope', 'assets')]);
    return { version: String(version), scope: scope === 'all' ? 'all' : 'assets', checkedAt: new Date().toISOString() };
  }

  /* ---------- error log ---------- */
  // Error log: recent browser, server, background and process failures; records are paged and filterable.
  router.get('/errors', wrap(async (req, res) => {
    const source = ['server', 'client'].includes(req.query.source) ? req.query.source : '';
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    res.json(await db.errors.list({ ...asPage(req, 50, 200), source, search }));
  }));
  router.delete('/errors', wrap(async (req, res) => { await db.errors.clear(); await log(req, 'errors.clear'); res.sendStatus(204); }));
}

// Broadcast images may be an admin upload (/uploads/…, /media/…), a private-R2 broadcast image URL,
// or a full https URL. Anything else is dropped (notification images are fetched by viewer devices).
export function normalizeImage(value) {
  const v = typeof value === 'string' ? value.trim().slice(0, 500) : '';
  if (!v) return '';
  if (/^https:\/\/[^\s]+$/.test(v)) return v;
  // The legacy upload endpoint returns `uploads/<hash>.<ext>` (no leading slash); accept both forms.
  const localPath = v.startsWith('/') ? v.slice(1) : v;
  if (/^(uploads|media)\/[A-Za-z0-9._/-]+$/.test(localPath)
    || /^r2-assets\/broadcast\/[0-9a-f]{24}\.(?:webp|png|jpg|gif)$/.test(localPath)) return `/${localPath}`;
  return '';
}
