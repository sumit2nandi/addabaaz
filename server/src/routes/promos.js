// Credit & referral endpoints for viewers (the browser and the apps).
//
//   GET  /promo          → the running offer, plus the viewer's balance and code when signed in
//   GET  /credits        → the viewer's credit balance and ledger (needs a session)
//   POST /promo/redeem   → { code } add a friend's invite code to an account created earlier
//
// These are registered before the auth middleware (like the support routes) so that signed-out visitors can
// still be told about the offer; the viewer-specific parts require a session and answer 401 without one.
//
// Amounts are integers in paise. Credit can only be spent on a plan (see server/src/promos.js and
// docs/PROMOS.md) — it is never cash and is never paid out.
import { HttpError, wrap, rateLimit } from '../http.js';

export function registerPromoRoutes(api, { db, promos, userFromRequest, rate = true }) {
  // A code can only be redeemed once per account, but the endpoint is cheap to hammer — keep it modest.
  const promoLimit = rate ? rateLimit('promo', 20, 60_000) : (_q, _s, n) => n();
  const me = async (req) => (userFromRequest ? await userFromRequest(req).catch(() => null) : null);
  // The viewer's own code is generated on first read, so `req.user` may not carry it yet.
  const withCode = async (user) => (user.referralCode ? user : { ...user, referralCode: await promos.ensureCode(user) });

  /** The public offer (and, signed in, everything the viewer's Credits page needs). */
  api.get('/promo', wrap(async (req, res) => {
    const user = await me(req);
    const offer = await promos.offer();
    if (!user) return res.json({ offer, viewer: null });
    res.json({ offer, viewer: await promos.summary(await withCode(user)) });
  }));

  /** Balance + ledger only — a small payload for the plans page and the account menu. */
  api.get('/credits', wrap(async (req, res) => {
    const user = await me(req);
    if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in to see your credit.');
    const [balances, ledger, offer] = await Promise.all([db.credits.summary(user.id), db.credits.ledger(user.id, { limit: 25 }), promos.offer()]);
    res.json({
      creditPaise: balances.availablePaise, pendingPaise: balances.pendingPaise, heldPaise: balances.heldPaise || 0,
      expiringPaise: balances.expiringPaise, nextExpiryAt: balances.nextExpiryAt,
      offer,
      ledger: ledger.items.map((r) => ({ id: r.id, kind: r.kind, amountPaise: r.amountPaise, status: r.status, reason: r.reason, expiresAt: r.expiresAt, createdAt: r.createdAt })),
    });
  }));

  /** Add a friend's invite code after signing up (once, inside the redeem window). */
  api.post('/promo/redeem', promoLimit, wrap(async (req, res) => {
    const user = await me(req);
    if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in to add an invite code.');
    const out = await promos.redeem({ user, code: req.body?.code });
    const balances = await db.credits.summary(user.id);
    res.json({
      ok: true,
      addedPaise: (out.inviteePaise || 0) + (out.welcomePaise || 0),
      inviterPaise: out.inviterPaise || 0,
      creditPaise: balances.availablePaise,
      message: out.inviteePaise ? `Invite accepted — ₹${out.inviteePaise / 100} of credit added.` : 'Invite accepted.',
    });
  }));

  /** A referrer's own link is worth nothing without a shareable URL, so expose it for the native apps too. */
  api.get('/promo/link', wrap(async (req, res) => {
    const user = await me(req);
    if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in to get your invite link.');
    const fresh = await withCode(user);
    res.json({ code: fresh.referralCode, link: promos.referralLink(promos.siteUrl || '', fresh.referralCode), share: `Join me on ADDABAAZ — we both get ₹${(await promos.offer()).referralPaise / 100} of credit` });
  }));
}
