// An in-memory stand-in for the promotional-credit part of the data layer (db.credits, db.referrals, the
// user helpers promos.js needs and app_settings). It mirrors server/src/db-extra.js: an append-only ledger
// with `remaining_paise` decreasing on a spend, one referral per account, and grants that stop being
// spendable when they expire. Shared by the promotion tests and the checkout tests so neither needs MySQL.
import crypto from 'node:crypto';

const HOUR = 3600_000;

export function fakeCreditDb() {
  const users = new Map(), credit = [], referralRows = [], settings = {};
  const now = () => Date.now();
  const user = (id, extra = {}) => ({ id, email: `${id}@example.com`, name: `User ${id}`, createdAt: new Date().toISOString(), referralCode: null, ...extra });
  const addUser = (id, extra) => { const u = user(id, extra); users.set(id, u); return u; };
  const touch = (row, iso) => ({ ...row, createdAt: row.createdAt || iso });

  const credits = {
    async add(e) {
      const row = { id: e.id || crypto.randomUUID(), userId: e.userId, kind: e.kind, amountPaise: e.amountPaise, remainingPaise: e.amountPaise > 0 ? e.amountPaise : 0, status: e.status || 'available', reason: e.reason || null, refType: e.refType || null, refId: e.refId || null, expiresAt: e.expiresAt || null, createdAt: new Date().toISOString() };
      credit.push(row); return row;
    },
    async hasKind(userId, kind) { return credit.some((c) => c.userId === userId && c.kind === kind); },
    async balance(userId) {
      return credit.filter((c) => c.userId === userId && c.status === 'available' && c.amountPaise > 0 && c.remainingPaise > 0 && (!c.expiresAt || Date.parse(c.expiresAt) > now())).reduce((n, c) => n + c.remainingPaise, 0);
    },
    async summary(userId) {
      const mine = credit.filter((c) => c.userId === userId && c.amountPaise > 0);
      const live = (c) => (!c.expiresAt || Date.parse(c.expiresAt) > now());
      return {
        availablePaise: mine.filter((c) => c.status === 'available' && live(c)).reduce((n, c) => n + c.remainingPaise, 0),
        pendingPaise: mine.filter((c) => c.status === 'pending').reduce((n, c) => n + c.remainingPaise, 0),
        heldPaise: credit.filter((c) => c.userId === userId && c.status === 'pending' && c.amountPaise < 0).reduce((n, c) => n - c.amountPaise, 0),
        expiringPaise: mine.filter((c) => c.status === 'available' && live(c) && c.expiresAt && Date.parse(c.expiresAt) <= now() + 7 * 24 * HOUR).reduce((n, c) => n + c.remainingPaise, 0),
        nextExpiryAt: null,
      };
    },
    async spend(userId, amountPaise, { refType = null, refId = null, reason = null, status = 'available' } = {}) {
      const want = Math.max(0, Math.floor(Number(amountPaise) || 0));
      if (!want) return { appliedPaise: 0, spendId: null };
      const grants = credit.filter((c) => c.userId === userId && c.status === 'available' && c.amountPaise > 0 && c.remainingPaise > 0 && (!c.expiresAt || Date.parse(c.expiresAt) > now()))
        .sort((a, b) => (Date.parse(a.expiresAt || 0) || Infinity) - (Date.parse(b.expiresAt || 0) || Infinity));
      let left = want;
      for (const g of grants) { if (left <= 0) break; const take = Math.min(left, g.remainingPaise); g.remainingPaise -= take; if (!g.remainingPaise) g.status = 'spent'; left -= take; }
      const applied = want - left;
      if (!applied) return { appliedPaise: 0, spendId: null };
      const row = await credits.add({ userId, kind: 'spend', amountPaise: -applied, status, reason, refType, refId });
      return { appliedPaise: applied, spendId: row.id };
    },
    async settleRef(refType, refId, status) { let n = 0; for (const c of credit) if (c.kind === 'spend' && c.refType === refType && c.refId === refId && c.status === 'pending') { c.status = status; n++; } return n; },
    async pendingSpend(refType, refId) { const rows = credit.filter((c) => c.kind === 'spend' && c.refType === refType && c.refId === refId && c.status === 'pending'); return { amountPaise: rows.reduce((n, c) => n - c.amountPaise, 0), id: rows[0]?.id || null }; },
    async returnPending(refType, refId, { reason = 'Order not completed' } = {}) {
      const held = await credits.pendingSpend(refType, refId);
      if (!held.amountPaise) return 0;
      const owner = credit.find((c) => c.kind === 'spend' && c.refType === refType && c.refId === refId)?.userId;
      await credits.settleRef(refType, refId, 'void');
      await credits.add({ userId: owner, kind: 'refund', amountPaise: held.amountPaise, reason, refType, refId });
      return held.amountPaise;
    },
    async stalePending(hours = 24) {
      return credit.filter((c) => c.kind === 'spend' && c.status === 'pending' && c.refType === 'payment' && now() - Date.parse(c.createdAt) > hours * HOUR)
        .map((c) => ({ id: c.id, userId: c.userId, paymentId: c.refId, amountPaise: -c.amountPaise }));
    },
    async expireDue() { let n = 0; for (const c of credit) if (c.status === 'available' && c.amountPaise > 0 && c.remainingPaise > 0 && c.expiresAt && Date.parse(c.expiresAt) <= now()) { n += c.remainingPaise; c.remainingPaise = 0; c.status = 'expired'; } return n; },
    async releasePending(userId) { let n = 0; for (const c of credit) if (c.userId === userId && c.status === 'pending' && c.amountPaise > 0) { c.status = 'available'; n += c.remainingPaise; } return n; },
    async releasePendingRef(userId, refType, refId) { let n = 0; for (const c of credit) if (c.userId === userId && c.status === 'pending' && c.amountPaise > 0 && c.refType === refType && c.refId === refId) { c.status = 'available'; n += c.remainingPaise; } return n; },
    async ledger(userId, { limit = 50 } = {}) { const items = credit.filter((c) => c.userId === userId).slice(-limit).reverse(); return { total: items.length, items }; },
    async list({ userId = null, kind = null, limit = 50 } = {}) { const items = credit.filter((c) => (!userId || c.userId === userId) && (!kind || c.kind === kind)).slice(0, limit); return { total: items.length, items }; },
    async stats() { return { outstandingPaise: 0, grantedPaise: 0, spentPaise: 0, expiredPaise: 0, accounts: new Set(credit.map((c) => c.userId)).size, byKind: {} }; },
    async revoke(id) { const c = credit.find((x) => x.id === id && x.amountPaise > 0 && x.remainingPaise > 0 && (x.status === 'available' || x.status === 'pending')); if (!c) return 0; const n = c.remainingPaise; c.remainingPaise = 0; c.status = 'void'; return n; },
    async revokeByRef(refType, refId) { let n = 0; for (const c of credit) if (c.refType === refType && c.refId === refId && c.amountPaise > 0 && c.remainingPaise > 0 && (c.status === 'available' || c.status === 'pending')) { n += c.remainingPaise; c.remainingPaise = 0; c.status = 'void'; } return n; },
  };

  const referrals = {
    async create({ inviterId, inviteeId, code, bonusPaise, status = 'pending' }) {
      if (referralRows.some((r) => r.inviteeId === inviteeId)) { const e = new Error('duplicate'); e.code = 'ER_DUP_ENTRY'; throw e; }
      const row = { id: crypto.randomUUID(), inviterId, inviteeId, code, bonusPaise, status, createdAt: new Date().toISOString(), completedAt: null };
      referralRows.push(row); return row;
    },
    async byId(id) { return referralRows.find((r) => r.id === id) || null; },
    async byInvitee(id) { return referralRows.find((r) => r.inviteeId === id && r.status !== 'void') || null; },
    async forInviter(id, { limit = 25, offset = 0 } = {}) {
      const all = referralRows.filter((r) => r.inviterId === id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const active = all.filter((r) => r.status !== 'void');
      const items = all.slice(offset, offset + limit).map((r) => ({ ...r, inviteeName: users.get(r.inviteeId)?.name, inviteeEmail: users.get(r.inviteeId)?.email }));
      return {
        total: all.length, activeTotal: active.length, completed: active.filter((r) => r.status === 'completed').length,
        pending: active.filter((r) => r.status === 'pending').length,
        earnedPaise: active.filter((r) => r.status === 'completed').reduce((n, r) => n + Number(r.bonusPaise || 0), 0), items,
      };
    },
    async countForInviter(id) { return referralRows.filter((r) => r.inviterId === id && r.status !== 'void').length; },
    async complete(id) { const r = referralRows.find((x) => x.id === id); if (r) { r.status = 'completed'; r.completedAt = new Date().toISOString(); } return r; },
    async void(id) { const r = referralRows.find((x) => x.id === id); if (r) r.status = 'void'; },
    async list() { return { total: referralRows.length, items: referralRows }; },
    async leaderboard() { return []; },
    async stats() { return { total: referralRows.length, completed: referralRows.filter((r) => r.status === 'completed').length, pending: referralRows.filter((r) => r.status === 'pending').length, void: 0, bonusPaise: 0 }; },
  };

  return {
    state: { users, credit, referralRows, settings },
    users: {
      async byId(id) { return users.get(id) || null; },
      async byEmail(email) { return [...users.values()].find((u) => u.email === email) || null; },
      async byReferralCode(code) { return [...users.values()].find((u) => u.referralCode === String(code).toUpperCase()) || null; },
      async setReferralCode(id, code) { users.get(id).referralCode = String(code).toUpperCase(); return users.get(id).referralCode; },
    },
    credits, referrals, addUser,
    settings: { async all() { return { ...settings }; }, async set(k, v) { settings[k] = v; } },
  };
}

const sent = [];
const mailer = { provider: 'smtp', async send(m) { sent.push(m); return { sent: true }; } };
// `build(db, { config: { …overrides } })` — environment defaults with a few values changed.
const build = (db, { config = {}, ...extra } = {}) => createPromos({ db, config: { ...promosConfigFromEnv({}), ...config }, mailer, siteUrl: 'https://addabaaz.in', ...extra });
