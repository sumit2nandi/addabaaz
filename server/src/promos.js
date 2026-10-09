/**
 * Promotional credit and referrals: "new accounts get ₹100" and "invite a friend — you both get ₹100".
 *
 * ADDABAAZ credit is money the business gives away. It can only be spent on a plan (never withdrawn, never
 * transferred, never refunded to a card), which is what makes the offer safe: the most anyone can do with a
 * ₹100 bonus is watch a ₹99 month for free.
 *
 * How a bonus is earned
 *   1. Welcome bonus — granted once, the moment an account is created (`signup`).
 *   2. Referral — the invited friend is given `referral_join` at signup and the inviter `referral_invite`.
 *      The inviter's reward may be held (status `pending`) until the friend qualifies:
 *         hold = 'signup'    both sides are spendable immediately
 *         hold = 'verified'  the inviter is paid once the friend verifies their e-mail or phone  (default)
 *         hold = 'payment'   …or only after the friend buys their first plan
 *      A hold is what stops someone creating throwaway accounts to farm credit.
 *   3. Goodwill — an administrator can grant credit to any account (Admin → Promotions).
 *
 * Spending happens at checkout: billing.js asks `spendForOrder` for as much of the price as the balance can
 * cover, records exactly how much went in (payments.credit_applied_paise) and either charges the remainder
 * through Razorpay or grants the plan for free when the credit covered everything. The spend is written by
 * `db.credits.spend` under row locks, so two tabs cannot spend the same paise.
 *
 * Abuse controls (all configurable, see promosConfigFromEnv): one welcome bonus per account ever, one
 * referral per account ever (unique key on referrals.invitee_id), no self-referral, a cap on how many
 * rewards one person may earn, a window in which a code can still be added after signup, and optional
 * expiry so old bonuses do not pile up.
 *
 * Amounts are integers in paise (1 rupee = 100 paise).
 */
import crypto from 'node:crypto';
import { HttpError, bad } from './http.js';

/* ------------------------------------------------------------------ configuration */

/**
 * Promotional settings from the environment. These are the defaults; an administrator can override the
 * amounts, the hold rule and the caps in Admin → Promotions (stored in app_settings, no redeploy needed).
 */
export function promosConfigFromEnv(env = process.env) {
  const int = (v, dflt) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : dflt; };
  // PROMO_SIGNUP_CREDIT_INR=0 (or PROMO_ENABLED=false) switches an individual offer off.
  return {
    enabled: String(env.PROMO_ENABLED ?? 'true').toLowerCase() !== 'false',
    signupPaise: int(env.PROMO_SIGNUP_CREDIT_INR, 100) * 100,
    referralPaise: int(env.PROMO_REFERRAL_CREDIT_INR, 100) * 100,
    // When an invited friend's reward for the *inviter* becomes spendable.
    hold: ['signup', 'verified', 'payment'].includes(String(env.PROMO_REFERRAL_HOLD || '').toLowerCase())
      ? String(env.PROMO_REFERRAL_HOLD).toLowerCase() : 'verified',
    maxReferrals: int(env.PROMO_MAX_REFERRALS_PER_USER, 50),      // rewards one account may earn
    expiryDays: int(env.PROMO_CREDIT_EXPIRY_DAYS, 0),             // 0 = credit never expires
    redeemDays: int(env.PROMO_REDEEM_DAYS, 7),                    // how long after signup a code can still be added
    minSpendPaise: 100,                                           // credit never pays the last ₹1: the gateway minimum
  };
}

// Settings an administrator may change at runtime; everything else needs a restart.
export const PROMO_SETTING_KEYS = {
  promo_enabled: 'enabled',
  promo_signup_paise: 'signupPaise',
  promo_referral_paise: 'referralPaise',
  promo_referral_hold: 'hold',
  promo_max_referrals: 'maxReferrals',
  promo_expiry_days: 'expiryDays',
  promo_redeem_days: 'redeemDays',
};

/* ------------------------------------------------------------------ referral codes */

// No I/O/0/1: codes get read out loud and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{4,12}$/;

/** A new 8-character code (crypto-random; the unique index is the real guarantee). */
export const newReferralCode = () => Array.from(crypto.randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

/** Uppercases and strips the decoration people add when sharing a link or reading a code aloud. */
export const normalizeReferralCode = (value) => String(value || '').trim().toUpperCase().replace(/^#?\/?(?:SIGNUP|JOIN|REF)[=/]?/i, '').replace(/[^A-Z0-9]/g, '').slice(0, 12);
export const isValidReferralCode = (value) => CODE_RE.test(normalizeReferralCode(value));

/** The shareable link (`siteUrl/#/signup?ref=CODE`), or '' when no public URL is configured. */
export const referralLink = (siteUrl, code) => (siteUrl ? `${String(siteUrl).replace(/\/+$/, '')}/#/signup?ref=${encodeURIComponent(code)}` : '');

/**
 * Which grants a spend of `amountPaise` would consume, oldest-expiry-first. Mirrors db.credits.spend's SQL
 * ordering, so a quote (no writes) and the real spend agree. Returns [{ id, take }] and the total.
 */
export function allocateFifo(grants, amountPaise) {
  const want = Math.max(0, Math.floor(Number(amountPaise) || 0));
  const order = [...(grants || [])]
    .filter((g) => g && g.remainingPaise > 0 && g.status === 'available' && (!g.expiresAt || Date.parse(g.expiresAt) > Date.now()))
    .sort((a, b) => {
      const ae = a.expiresAt ? Date.parse(a.expiresAt) : Infinity, be = b.expiresAt ? Date.parse(b.expiresAt) : Infinity;
      if (ae !== be) return ae - be;                                    // soonest to expire first
      return Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0); // then oldest
    });
  const out = [];
  let left = want;
  for (const g of order) {
    if (left <= 0) break;
    const take = Math.min(left, g.remainingPaise);
    out.push({ id: g.id, take });
    left -= take;
  }
  return { appliedPaise: want - left, allocations: out };
}

/* ------------------------------------------------------------------ the service */

/**
 * @param {object} o
 * @param {object} o.db           the data layer (db.credits, db.referrals, db.users, db.settings)
 * @param {object} [o.config]     promosConfigFromEnv()
 * @param {object} [o.mailer]     mailer.js instance (welcome/referral e-mails; optional)
 * @param {string} [o.siteUrl]    public site URL, used in the share link and e-mails
 * @param {object} [o.log]
 */
export function createPromos({ db, config = promosConfigFromEnv(), mailer = null, siteUrl = '', log = console }) {
  // Settings are read often (every checkout); a short cache keeps that to one query every few seconds.
  let cache = null, cacheAt = 0;
  const TTL = 10_000;

  async function settings() {
    if (cache && Date.now() - cacheAt < TTL) return cache;
    let stored = {};
    try { stored = (await db.settings.all()) || {}; }
    catch (error) { log.warn?.('[promos] could not read promotion settings; using environment defaults:', error); }
    const merged = { ...config };
    for (const [key, field] of Object.entries(PROMO_SETTING_KEYS)) {
      if (stored[key] === undefined || stored[key] === null || stored[key] === '') continue;
      if (field === 'enabled') merged[field] = String(stored[key]) !== 'false' && String(stored[key]) !== '0';
      else if (field === 'hold') merged[field] = ['signup', 'verified', 'payment'].includes(String(stored[key])) ? String(stored[key]) : merged[field];
      else { const n = Number(stored[key]); if (Number.isFinite(n) && n >= 0) merged[field] = Math.round(n); }
    }
    cache = Object.freeze(merged); cacheAt = Date.now();
    return cache;
  }
  const invalidate = () => { cache = null; cacheAt = 0; };

  /** What the sign-in/plans/signup pages may show before anyone signs in. */
  async function offer() {
    const s = await settings();
    return { enabled: s.enabled, signupPaise: s.signupPaise, referralPaise: s.referralPaise, hold: s.hold, expiryDays: s.expiryDays, redeemDays: s.redeemDays };
  }

  /** Credentials and balances for one account, plus the people it invited. */
  async function summary(user) {
    const s = await settings();
    const [balances, ledger, invited, referred] = await Promise.all([
      db.credits.summary(user.id),
      db.credits.ledger(user.id, { limit: 25 }),
      db.referrals.forInviter(user.id, { limit: 25 }),
      db.referrals.byInvitee(user.id),
    ]);
    const code = await ensureCode(user);
    return {
      offer: { enabled: s.enabled, signupPaise: s.signupPaise, referralPaise: s.referralPaise, hold: s.hold, expiryDays: s.expiryDays, redeemDays: s.redeemDays },
      creditPaise: balances.availablePaise, pendingPaise: balances.pendingPaise, heldPaise: balances.heldPaise || 0,
      expiringPaise: balances.expiringPaise, nextExpiryAt: balances.nextExpiryAt,
      code, link: referralLink(siteUrl, code),
      invited: {
        total: invited.total, activeTotal: invited.activeTotal ?? invited.total,
        completed: invited.completed || 0, pending: invited.pending || 0,
        earnedPaise: invited.earnedPaise || 0, items: invited.items.map(inviteeView),
      },
      referredBy: referred && referred.status !== 'void' ? { status: referred.status, createdAt: referred.createdAt, completedAt: referred.completedAt, bonusPaise: referred.bonusPaise } : null,
      canRedeem: !referred && await canRedeem(user),
      ledger: ledger.items.map(ledgerView),
    };
  }

  const inviteeView = (r) => ({ id: r.id, name: r.inviteeName || 'Friend', email: maskEmail(r.inviteeEmail), status: r.status, bonusPaise: r.bonusPaise, joinedAt: r.createdAt, completedAt: r.completedAt });
  // The viewer may see who they invited; the address is masked so a shared screen does not leak it.
  const maskEmail = (email) => { const [user, domain] = String(email || '').split('@'); return domain ? `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}` : ''; };
  const ledgerView = (r) => ({
    id: r.id, kind: r.kind, amountPaise: r.amountPaise, status: r.status, reason: r.reason,
    expiresAt: r.expiresAt, createdAt: r.createdAt,
    label: CREDIT_LABELS[r.kind] || r.kind,
  });

  /** The viewer's own code, generated (and stored) the first time it is needed. */
  async function ensureCode(user) {
    if (user.referralCode) return user.referralCode;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = newReferralCode();
      try {
        const taken = await db.users.byReferralCode(code);
        if (taken) continue;
        await db.users.setReferralCode(user.id, code);
        user.referralCode = code;
        return code;
      } catch (e) {
        if (e?.code !== 'ER_DUP_ENTRY') { log.warn?.('[promos] could not store a referral code:', e); return code; }
      }
    }
    return '';
  }

  /* ---------- earning ---------- */

  const addDays = (days) => (days > 0 ? new Date(Date.now() + days * 86_400_000) : null);

  /**
   * Applies the welcome bonus, and the referral bonus on both sides when a code was used.
   * Called from signup (password and phone) and from `redeem` — it is safe to call twice: the welcome bonus
   * is granted once per account, and `referrals.invitee_id` is unique so a person is referred only once.
   * Never throws: a broken promotion must not stop somebody creating an account.
   */
  async function onSignup({ user, code = null, redeeming = false }) {
    const s = await settings();
    const out = { welcomePaise: 0, inviteePaise: 0, inviterPaise: 0, referralId: null, inviter: null, skipped: null };
    if (!s.enabled) { out.skipped = 'disabled'; return out; }
    try {
      if (s.signupPaise > 0 && !(await db.credits.hasKind(user.id, 'signup'))) {
        await db.credits.add({
          userId: user.id, kind: 'signup', amountPaise: s.signupPaise, status: 'available',
          reason: `Welcome offer: ₹${s.signupPaise / 100} to try ADDABAAZ Premium`, refType: 'user', refId: user.id,
          expiresAt: addDays(s.expiryDays),
        });
        out.welcomePaise = s.signupPaise;
      }
      const wanted = normalizeReferralCode(code);
      // A code is recorded even when the cash bonus is switched off: the invite still counts for the
      // inviter's own stats (and the hold rule can be turned on later).
      if (wanted) out.referralId = await applyReferral({ user, code: wanted, settings: s, out });
    } catch (e) {
      log.error?.('[promos] signup bonus failed:', e);
    }
    if (out.welcomePaise || out.inviteePaise) await notifyCredit(user, { welcomePaise: out.welcomePaise, inviteePaise: out.inviteePaise, inviter: out.inviter, settings: s });
    return out;
  }

  /** Records the referral and pays both sides (the inviter possibly on hold). */
  async function applyReferral({ user, code, settings: s, out }) {
    if (!isValidReferralCode(code)) { out.skipped = 'invalid_code'; return null; }
    const inviter = await db.users.byReferralCode(code);
    if (!inviter) { out.skipped = 'unknown_code'; return null; }
    if (inviter.id === user.id) { out.skipped = 'self'; return null; }            // no referring yourself
    if (inviter.disabledAt) { out.skipped = 'inviter_disabled'; return null; }
    if (await db.referrals.byInvitee(user.id)) { out.skipped = 'already_referred'; return null; }
    if ((await db.referrals.countForInviter(inviter.id)) >= s.maxReferrals) { out.skipped = 'inviter_limit'; return null; }
    let row;
    try {
      row = await db.referrals.create({ inviterId: inviter.id, inviteeId: user.id, code: normalizeReferralCode(code), bonusPaise: s.referralPaise, status: 'pending' });
    } catch (e) {
      if (e?.code === 'ER_DUP_ENTRY') { out.skipped = 'already_referred'; return null; }   // two requests at once
      throw e;
    }
    // The invited friend's reward is spendable right away (their account is new, they did nothing wrong).
    if (s.referralPaise > 0) {
      await db.credits.add({
        userId: user.id, kind: 'referral_join', amountPaise: s.referralPaise, status: 'available',
        reason: `${inviter.name || 'A friend'} invited you — welcome bonus`, refType: 'referral', refId: row.id,
        expiresAt: addDays(s.expiryDays),
      });
      out.inviteePaise = s.referralPaise;
    }
    // The inviter's reward may be held until the friend qualifies.
    if (s.referralPaise > 0) {
      const immediate = s.hold === 'signup';
      await db.credits.add({
        userId: inviter.id, kind: 'referral_invite', amountPaise: s.referralPaise, status: immediate ? 'available' : 'pending',
        reason: `You invited ${firstName(user.name)} — ₹${s.referralPaise / 100} ${immediate ? 'added' : s.hold === 'payment' ? 'unlocks after their first payment' : 'unlocks when they confirm their account'}`,
        refType: 'referral', refId: row.id, expiresAt: addDays(s.expiryDays),
      });
      if (immediate) { row = await db.referrals.complete(row.id); }
      out.inviterPaise = s.referralPaise;
      out.inviter = inviter;
      out.hold = immediate ? null : s.hold;
      await notifyReferral(inviter, user, { amountPaise: s.referralPaise, pending: !immediate, settings: s });
    }
    return row.id;
  }

  /** May this (existing) account still add a friend's code? */
  async function canRedeem(user) {
    const s = await settings();
    if (!s.enabled) return false;
    if (s.redeemDays <= 0) return false;
    if (await db.referrals.byInvitee(user.id)) return false;
    const created = Date.parse(user.createdAt || 0);
    return !!created && Date.now() - created <= s.redeemDays * 86_400_000;
  }

  /**
   * Adds a friend's code to an account created earlier (most people sign up without a link).
   * Allowed once, inside `redeemDays` of signup, and never when the account is already part of a referral.
   */
  async function redeem({ user, code }) {
    const s = await settings();
    if (!s.enabled) throw new HttpError(404, 'promo_disabled', 'There is no referral offer running right now.');
    if (!isValidReferralCode(code)) throw bad('That invite code isn’t valid.', 'invalid_code');
    if (await db.referrals.byInvitee(user.id)) throw new HttpError(409, 'already_referred', 'This account was already invited by someone.');
    if (!(await canRedeem(user))) throw new HttpError(409, 'redeem_window_closed', `Invite codes can be added within ${s.redeemDays} day${s.redeemDays === 1 ? '' : 's'} of signing up.`);
    const out = { welcomePaise: 0, inviteePaise: 0, inviterPaise: 0, referralId: null, inviter: null, skipped: null };
    out.referralId = await applyReferral({ user, code, settings: s, out });
    if (!out.referralId) {
      const why = { unknown_code: 'We couldn’t find that invite code.', self: 'You can’t use your own invite code.', already_referred: 'This account was already invited by someone.', inviter_limit: 'That account has reached its referral limit.', inviter_disabled: 'That invite code is no longer available.' };
      throw bad(why[out.skipped] || 'That invite code isn’t valid.', out.skipped || 'invalid_code');
    }
    if (out.inviteePaise) await notifyCredit(user, { welcomePaise: out.inviteePaise, inviteePaise: 0, inviter: out.inviter, settings: s, referral: true });
    return out;
  }

  /**
   * The invited friend qualified: their e-mail was verified, their phone was verified, or they paid.
   * Releases the inviter's held reward (and anyone else waiting on this account, i.e. the friend's own
   * pending rows — normally none).
   */
  async function qualify(user, { reason = 'verified' } = {}) {
    const s = await settings();
    if (!s.enabled) return { releasedPaise: 0, completed: 0 };
    let releasedPaise = 0, completed = 0;
    try {
      const referral = await db.referrals.byInvitee(user.id);
      if (referral && referral.status === 'pending') {
        const worth = reason === 'payment' ? true : s.hold === 'verified' || s.hold === 'signup';
        if (worth) {
          // Only THIS referral's reward is released — other friends who have not qualified keep waiting.
          releasedPaise += await db.credits.releasePendingRef(referral.inviterId, 'referral', referral.id);
          await db.referrals.complete(referral.id);
          completed = 1;
          const inviter = await db.users.byId(referral.inviterId);
          if (inviter) await notifyReferral(inviter, user, { amountPaise: referral.bonusPaise, pending: false, settings: s, completed: true });
        }
      }
      // Rows the account holds itself (e.g. an administrator put a bonus on hold).
      releasedPaise += await db.credits.releasePending(user.id);
    } catch (e) {
      log.error?.('[promos] releasing a referral failed:', e);
    }
    return { releasedPaise, completed };
  }

  /* ---------- spending at checkout ---------- */

  /**
   * How much credit can pay for an order whose price (after coupons) is `payablePaise`.
   * Never takes the order below the gateway minimum: if ₹1 of card charge would be left, one rupee of
   * credit is kept back so Razorpay can still create the order.
   */
  async function quoteTax(userId, payablePaise) {
    const s = await settings();
    if (!s.enabled) return 0;
    const price = Math.max(0, Math.floor(Number(payablePaise) || 0));
    if (price <= 0) return 0;
    const balance = await db.credits.balance(userId);
    if (balance <= 0) return 0;
    let applied = Math.min(balance, price);
    if (price - applied > 0 && price - applied < s.minSpendPaise) applied -= (s.minSpendPaise - (price - applied));
    return Math.max(0, applied);
  }

  /**
   * Reserves `amountPaise` of credit for an order. `status: 'pending'` (the default) is a hold that an unpaid
   * order keeps and maintenance returns; `status: 'available'` means the credit is spent for good — used when
   * the credit itself paid (no gateway payment is coming).
   */
  async function spendForOrder({ userId, amountPaise, paymentId, status = 'pending' }) {
    const want = Math.max(0, Math.floor(Number(amountPaise) || 0));
    if (!want) return { appliedPaise: 0, spendId: null };
    return db.credits.spend(userId, want, { refType: 'payment', refId: paymentId, reason: 'Applied to your plan', status });
  }

  /** The order was paid: the reserved credit is now spent for good. */
  async function finaliseOrder(paymentId) { return db.credits.settleRef('payment', paymentId, 'available'); }

  /** A refunded order returns its credit to the wallet (a `refund` grant), so nobody loses the bonus. */
  async function refundOrderCredit({ userId, paymentId, amountPaise, reason = 'Credit returned' }) {
    const amount = Math.max(0, Math.floor(Number(amountPaise) || 0));
    if (!amount || !userId) return 0;
    const s = await settings();
    await db.credits.add({ userId, kind: 'refund', amountPaise: amount, reason: String(reason).slice(0, 200), refType: 'payment', refId: paymentId, expiresAt: addDays(s.expiryDays) });
    return amount;
  }

  /** The order will never be paid: give the credit back (booked as a `refund` grant). */
  async function releaseOrder(paymentId, { reason = 'Order not completed' } = {}) { return db.credits.returnPending('payment', paymentId, { reason }); }

  /** Housekeeping: expire stale grants and return credit held by abandoned orders. Returns a summary. */
  async function runMaintenance({ staleHours = 24 } = {}) {
    const expiredPaise = await db.credits.expireDue();
    const stale = await db.credits.stalePending(staleHours);
    let returned = 0;
    for (const row of stale) returned += await db.credits.returnPending('payment', row.paymentId, { reason: 'Order not completed' });
    return { expiredPaise, returnedPaise: returned, staleOrders: stale.length };
  }

  /* ---------- admin ---------- */

  /** Everything the Admin → Promotions page shows. */
  async function overview() {
    const s = await settings();
    const [creditStats, referralStats, topReferrers, referrals, ledger] = await Promise.all([
      db.credits.stats(), db.referrals.stats(), db.referrals.leaderboard(8),
      db.referrals.list({ limit: 15 }), db.credits.list({ limit: 15 }),
    ]);
    return { config: { ...s, defaults: config }, stats: { ...creditStats, referrals: referralStats }, topReferrers, referrals: referrals.items, ledger: ledger.items };
  }

  /** Validates and stores an admin's change to the offer. Returns the new effective config. */
  async function updateSettings(patch = {}) {
    const write = [];
    const int = (v, what, max) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > max) throw bad(`${what} must be a number between 0 and ${max}.`); return Math.round(n); };
    if (patch.enabled !== undefined) write.push(['promo_enabled', patch.enabled ? 'true' : 'false']);
    if (patch.signupPaise !== undefined) write.push(['promo_signup_paise', String(int(patch.signupPaise, 'The welcome bonus', 100_000))]);
    if (patch.referralPaise !== undefined) write.push(['promo_referral_paise', String(int(patch.referralPaise, 'The referral bonus', 100_000))]);
    if (patch.maxReferrals !== undefined) write.push(['promo_max_referrals', String(int(patch.maxReferrals, 'The referral cap', 10_000))]);
    if (patch.expiryDays !== undefined) write.push(['promo_expiry_days', String(int(patch.expiryDays, 'The expiry', 3650))]);
    if (patch.redeemDays !== undefined) write.push(['promo_redeem_days', String(int(patch.redeemDays, 'The redeem window', 365))]);
    if (patch.hold !== undefined) {
      if (!['signup', 'verified', 'payment'].includes(patch.hold)) throw bad('The hold rule must be signup, verified or payment.', 'invalid_hold');
      write.push(['promo_referral_hold', patch.hold]);
    }
    for (const [k, v] of write) await db.settings.set(k, v);
    invalidate();
    return settings();
  }

  /** Goodwill credit from an administrator. Audited by the caller. */
  async function grantManual({ userId, amountPaise, reason, actor = null }) {
    const s = await settings();
    const amount = Math.floor(Number(amountPaise) || 0);
    if (amount <= 0) throw bad('Enter how much credit to give (in paise).', 'invalid_amount');
    if (amount > 1_000_000) throw bad('A single credit grant is limited to ₹10,000.', 'invalid_amount');
    const row = await db.credits.add({
      userId, kind: 'admin', amountPaise: amount, status: 'available',
      reason: String(reason || '').slice(0, 200) || `Added by ${actor || 'an administrator'}`,
      refType: 'admin', refId: actor || null, expiresAt: addDays(s.expiryDays),
    });
    const user = await db.users.byId(userId);
    if (user) await notifyCredit(user, { welcomePaise: amount, inviteePaise: 0, inviter: null, settings: s, goodwill: true });
    return row;
  }

  /* ---------- e-mails (best effort: never block a signup or a payment) ---------- */

  // Dispatch without waiting: a promo mail must never stall the request that earned it (sign-up awaits the
  // bonuses). The send still STARTS before the caller continues — the mail is handed to the transport
  // synchronously — so a failure is only ever observed in the background, where it is logged.
  const send = (to, built, note) => {
    if (!to || !mailer || mailer.provider !== 'smtp' || !built) return;
    Promise.resolve(mailer.send({ to, ...built })).catch((e) => log.warn?.(`[promos] ${note} e-mail failed:`, e));
  };
  async function notifyCredit(user, { welcomePaise, inviteePaise, referral = false }) {
    const amount = (welcomePaise || 0) + (inviteePaise || 0);
    if (!amount || !user?.email || /@phone\.addabaaz\.in$/i.test(user.email)) return;
    const balances = await db.credits.summary(user.id).catch((e) => { log.warn?.('[promos] credit balance lookup before e-mail failed:', e); return { availablePaise: 0 }; });
    await send(user.email, creditEmail({ name: user.name, amountPaise: amount, balancePaise: balances.availablePaise, referral, siteUrl, supportEmail: '' }), 'credit');
  }
  async function notifyReferral(inviter, invitee, { amountPaise, pending, completed = false }) {
    if (!inviter?.email || /@phone\.addabaaz\.in$/i.test(inviter.email)) return;
    const balances = await db.credits.summary(inviter.id).catch((e) => { log.warn?.('[promos] referrer balance lookup before e-mail failed:', e); return { availablePaise: 0 }; });
    await send(inviter.email, referralEmail({ name: inviter.name, friendName: firstName(invitee.name), amountPaise, pending, completed, balancePaise: balances.availablePaise, siteUrl }), 'referral');
  }

  // The two templates are built here (not in emails.js) because they are marketing-ish and short.
  const creditEmail = ({ name, amountPaise, balancePaise, referral, goodwill, siteUrl: url, supportEmail }) => {
    const head = referral ? 'Your invite bonus is in' : goodwill ? 'A little something from us' : `Welcome to ADDABAAZ — ₹${amountPaise / 100} is in your account`;
    const lines = [
      `Hi ${firstName(name)},`,
      referral ? `Thanks for joining ADDABAAZ through a friend’s invite — ₹${amountPaise / 100} of credit has been added to your account.` : `We’ve added ₹${amountPaise / 100} of ADDABAAZ credit to your account.`,
      'Use it at checkout: it comes off the price of any plan, and it stays in your account until you do.',
      `Your balance is now ₹${balancePaise / 100}.`,
    ];
    return emailShell({ subject: head, lines, button: url ? { label: 'See plans', url: `${url}/#/plans` } : null, footer: supportEmail ? `Questions? Write to ${supportEmail}.` : '' });
  };
  const referralEmail = ({ name, friendName, amountPaise, pending, completed, balancePaise, siteUrl: url }) => emailShell({
    subject: pending ? `${friendName} joined ADDABAAZ with your invite` : completed ? `Your ₹${amountPaise / 100} referral bonus is ready` : `${friendName} joined ADDABAAZ with your invite`,
    lines: [
      `Hi ${firstName(name)},`,
      `${friendName} signed up with your invite code.`,
      pending
        ? `Your ₹${amountPaise / 100} referral bonus is on hold until ${friendName} confirms their e-mail or phone number — that keeps the offer fair for everyone.`
        : `₹${amountPaise / 100} of credit is now in your account. Balance: ₹${balancePaise / 100}.`,
      'Keep sharing your invite link — credit comes off the price of any plan at checkout.',
    ],
    button: url ? { label: 'Your referral link', url: `${url}/#/credits` } : null,
    footer: '',
  });

  // Same simple, client-safe structure as emails.js (no tables inside paragraphs, escaped values).
  const emailShell = ({ subject, lines, button = null, footer = '' }) => {
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const text = [...lines, button ? `${button.label}: ${button.url}` : null, footer].filter(Boolean).join('\n\n');
    const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#050505;padding:18px 24px;font-size:20px;font-weight:700;letter-spacing:1px;color:#fff">ADDA<span style="color:#e50914">BAAZ</span></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;margin:0 0 14px">${esc(subject)}</h1>
${lines.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join('')}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#e50914;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">${esc(button.label)}</a></p>` : ''}
${footer ? `<p style="margin:18px 0 0;color:#666;font-size:12.5px">${esc(footer)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
    return { subject, text, html };
  };

  const firstName = (name) => String(name || '').split(' ')[0] || 'there';

  return {
    siteUrl,
    settings, invalidate, offer, summary, ensureCode, onSignup, redeem, canRedeem, qualify,
    quoteTax, spendForOrder, finaliseOrder, releaseOrder, refundOrderCredit, runMaintenance, overview, updateSettings, grantManual,
    // Small helpers the routes use.
    normalizeReferralCode, isValidReferralCode, referralLink,
  };
}

// Human labels for the ledger rows (the viewer's own view).
export const CREDIT_LABELS = {
  signup: 'Welcome bonus',
  referral_join: 'Invite bonus',
  referral_invite: 'Referral reward',
  admin: 'Credit from ADDABAAZ',
  spend: 'Used on a plan',
  refund: 'Returned (order not completed)',
};
