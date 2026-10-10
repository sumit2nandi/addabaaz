// Admin API for credit and referrals (Admin → Promotions).
//
//   GET   /promos                 → the running offer, headline numbers, top referrers, recent activity
//   PATCH /promos                 → change the offer (amounts, hold rule, caps, expiry, on/off) — audited
//   GET   /credits                → the credit ledger across all accounts (filter by account or kind)
//   POST  /credits/grant          → goodwill credit for one account — audited, e-mails the viewer
//   GET   /referrals              → who invited whom, with status
//
// Mounted from admin.js, after the admin authentication middleware, so `req.admin` is always set.
// The business rules live in server/src/promos.js; this file only validates input and writes the audit trail.
import { HttpError, bad, wrap } from './http.js';

const asPage = (req, dflt = 25, max = 100) => ({ limit: Math.min(Math.max(Number(req.query.limit) || dflt, 1), max), offset: Math.max(Number(req.query.offset) || 0, 0) });

export function adminPromoRoutes({ router, db, promos, log, emailTemplate = null }) {
  /* ---------- the offer + its numbers ---------- */
  router.get('/promos', wrap(async (_req, res) => res.json(await promos.overview())));

  router.patch('/promos', wrap(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    for (const [from, to] of [['signupPaise', 'signupPaise'], ['referralPaise', 'referralPaise'], ['maxReferrals', 'maxReferrals'], ['expiryDays', 'expiryDays'], ['redeemDays', 'redeemDays']])
      if (b[from] !== undefined) patch[to] = Number(b[from]);
    if (b.hold !== undefined) patch.hold = String(b.hold);
    if (!Object.keys(patch).length) throw bad('Nothing to change.', 'nothing_to_update');
    const config = await promos.updateSettings(patch);
    await log(req, 'promo.update', null, { ...patch });
    res.json({ config: { ...config, defaults: undefined }, ok: true });
  }));

  /* ---------- the ledger ---------- */
  router.get('/credits', wrap(async (req, res) => {
    const kind = ['signup', 'referral_join', 'referral_invite', 'admin', 'spend', 'refund'].includes(req.query.kind) ? req.query.kind : null;
    let userId = null;
    if (req.query.user) {
      // A user id or an e-mail address, so the console can filter from either.
      const byId = await db.users.byId(String(req.query.user));
      const user = byId || await db.users.byEmail(String(req.query.user).trim().toLowerCase());
      if (!user) throw new HttpError(404, 'not_found', 'No account matches that id or e-mail.');
      userId = user.id;
    }
    const q = String(req.query.q || '').trim().slice(0, 80);
    const page = await db.credits.list({ userId, kind, ...asPage(req) });
    const items = q ? page.items.filter((r) => `${r.userEmail || ''} ${r.userName || ''} ${r.reason || ''}`.toLowerCase().includes(q.toLowerCase())) : page.items;
    res.json({ total: page.total, items });
  }));

  /** Goodwill credit: the viewer is e-mailed, the action is audited, the balance updates immediately. */
  router.post('/credits/grant', wrap(async (req, res) => {
    const b = req.body || {};
    const target = String(b.user || '').trim();
    const user = (await db.users.byId(target)) || (target ? await db.users.byEmail(target.toLowerCase()) : null);
    if (!user) throw new HttpError(404, 'not_found', 'No account matches that id or e-mail.');
    const paise = b.amountPaise !== undefined ? Math.round(Number(b.amountPaise)) : Math.round(Number(b.amountINR || 0) * 100);
    const row = await promos.grantManual({ userId: user.id, amountPaise: paise, reason: String(b.reason || '').trim().slice(0, 200), actor: req.admin.email });
    await log(req, 'credit.grant', user.id, { amountPaise: row.amountPaise, reason: row.reason });
    const balances = await db.credits.summary(user.id);
    res.status(201).json({ ok: true, credit: row, balancePaise: balances.availablePaise, email: user.email });
  }));

  /** Revokes a still-untouched grant (a mistake, a fraud report). Only available value can be removed. */
  router.post('/credits/:id/revoke', wrap(async (req, res) => {
    const removed = await db.credits.revoke(String(req.params.id), { reason: `Removed by ${req.admin.email}` });
    if (!removed) throw new HttpError(409, 'not_revocable', 'That credit has already been spent or was already removed.');
    await log(req, 'credit.revoke', req.params.id, { removedPaise: removed });
    res.json({ ok: true, removedPaise: removed });
  }));

  /** Credit + referrals for one account — shown at the top of the user page. */
  router.get('/credits/user/:id', wrap(async (req, res) => {
    const user = await db.users.byId(String(req.params.id));
    if (!user) throw new HttpError(404, 'not_found', 'Unknown account.');
    const [balances, ledger, invited, referred, payments] = await Promise.all([
      db.credits.summary(user.id), db.credits.list({ userId: user.id, limit: 25 }),
      db.referrals.forInviter(user.id, { limit: 25 }), db.referrals.byInvitee(user.id),
      db.payments.listForUser(user.id, 5),
    ]);
    res.json({
      balancePaise: balances.availablePaise, pendingPaise: balances.pendingPaise, heldPaise: balances.heldPaise || 0,
      expiringPaise: balances.expiringPaise, nextExpiryAt: balances.nextExpiryAt,
      code: user.referralCode || null,
      ledger: ledger.items,
      invited: invited.items, invitedTotal: invited.total,
      referredBy: referred,
      spendMs: payments.reduce((n, p) => n + (p.creditAppliedPaise || 0), 0),
    });
  }));

  /* ---------- referrals ---------- */
  router.get('/referrals', wrap(async (req, res) => {
    const status = ['pending', 'completed', 'void'].includes(req.query.status) ? req.query.status : null;
    const [page, stats, top] = await Promise.all([db.referrals.list({ status, ...asPage(req) }), db.referrals.stats(), db.referrals.leaderboard(10)]);
    res.json({ total: page.total, items: page.items, stats, top });
  }));

  /** Void a referral and remove the rewards it created while they are still untouched. */
  router.post('/referrals/:id/void', wrap(async (req, res) => {
    const row = await db.referrals.byId(String(req.params.id));
    if (!row) throw new HttpError(404, 'not_found', 'Unknown referral.');
    const credit = await db.credits.revokeByRef('referral', row.id, { reason: `Referral cancelled by ${req.admin.email}` });
    await db.referrals.void(row.id);
    await log(req, 'referral.void', row.id, { removedPaise: credit });
    res.json({ ok: true, removedPaise: credit });
  }));

  void emailTemplate;                 // the grant e-mail is sent by promos.js (never blocks the request)
}
