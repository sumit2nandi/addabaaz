// MySQL data-access layer: every SQL statement the app runs lives in the db*.js files.
// This file holds the core tables (users, profiles, library, subscriptions, payments, contact messages);
// db-extra.js, db-billing.js and db-admin.js add the rest and are merged into the same object at the bottom.
// The rest of the server only ever calls these methods, e.g. `db.users.byEmail(...)`, never raw SQL.
import mysql from 'mysql2/promise';
import { dbConfigFromEnv } from './config.js';
import { normalizeEmail } from './email-address.js';
import { billingDb } from './db-billing.js';
import { adminDb } from './db-admin.js';
import { extraDb } from './db-extra.js';

// Converts a Date (or date string) to an ISO-8601 string for JSON responses; null stays null.
const iso = (d) => (d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : null);
// True when MySQL rejected an insert because of a UNIQUE key (e.g. the email already exists).
export const isDuplicate = (e) => e?.code === 'ER_DUP_ENTRY';
// How many "continue watching" rows are kept per profile.
const MAX_PROGRESS = 500;
// Converts a `payments` table row (snake_case) into the camelCase object the rest of the code uses.
const mapPayment = (r) => r && ({
  id: r.id, userId: r.user_id, planId: r.plan_id, provider: r.provider, orderId: r.provider_order_id, paymentId: r.provider_payment_id,
  amountPaise: r.amount_paise, listPricePaise: r.list_price_paise ?? r.amount_paise, discountPaise: r.discount_paise, couponCode: r.coupon_code,
  billing: typeof r.billing === 'string' ? JSON.parse(r.billing) : r.billing || null, refundedPaise: r.refunded_paise, currency: r.currency,
  status: r.status, createdAt: iso(r.created_at), paidAt: iso(r.paid_at),
});

/**
 * MySQL data-access layer. Every method is async and uses parameterised queries.
 * Timestamps are UTC (pool option timezone 'Z') and returned to the API as ISO strings.
 */
export async function createDb({ config = dbConfigFromEnv(), ensureDatabase = false } = {}) {
  // The database name is split off so the server can connect first and create the database if asked.
  const { database, ...conn } = config;
  if (ensureDatabase) {                                   // used by `npm run db:migrate` and tests
    const c = await mysql.createConnection({ ...conn, ssl: config.ssl });
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.end();
  }
  // A connection pool shared by the whole app. Times are UTC everywhere.
  const pool = mysql.createPool({
    ...conn, database, timezone: 'Z', charset: 'utf8mb4', waitForConnections: true, queueLimit: 0,
    connectTimeout: 10_000, supportBigNumbers: true, dateStrings: false,
  });
  pool.pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));   // DEFAULT CURRENT_TIMESTAMP is then UTC too
  // Shorthand: run a query and return only the rows (no column metadata).
  const q = async (sql, params) => (await pool.query(sql, params))[0];

  /** Runs fn(conn) in a transaction; commits on success, rolls back on error. */
  async function tx(fn) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const out = await fn({ query: async (sql, params) => (await c.query(sql, params))[0] });
      await c.commit();
      return out;
    } catch (e) { await c.rollback().catch(() => {}); throw e; } finally { c.release(); }
  }

  // Row mappers: database column names -> API field names.
  const userRow = (r) => r && { id: r.id, email: r.email, emailNorm: r.email_norm || null, emailDup: !!r.email_dup, name: r.name, passwordHash: r.password_hash, createdAt: iso(r.created_at), isAdmin: !!r.is_admin, disabledAt: iso(r.disabled_at), emailVerifiedAt: iso(r.email_verified_at), sessionVersion: r.session_version || 0, hasPin: !!r.parental_pin_hash };
  const profileRow = (r) => ({ id: r.id, name: r.name, color: r.color, ...(r.kids ? { kids: true } : {}) });

  // The public object. `self` is also handed to the extension modules so they can call each other's methods.
  const self = {
    pool,
    // Health check used by /health.
    async ping() { await q('SELECT 1'); return true; },
    async close() { await pool.end(); },
    // Only used by tests to clean up.
    async dropDatabase() { await q(`DROP DATABASE IF EXISTS \`${database.replace(/`/g, '')}\``); },

    // ---- Accounts ----
    users: {
      // Lookups return null when nothing matches. `byEmail` compares the raw stored address;
      // `byEmailNorm` the normalized one — the two are the same for every account created since
      // migration 012, and differ only for rows the admin duplicate report flags (legacy, unknown chars).
      async byEmail(email) { return userRow((await q('SELECT * FROM users WHERE email = ?', [email]))[0]); },
      async byEmailNorm(norm) { return userRow((await q('SELECT * FROM users WHERE email_norm = ?', [norm]))[0]); },
      async byId(id) { return userRow((await q('SELECT * FROM users WHERE id = ?', [id]))[0]); },
      /** Creates the user and their first profile atomically. Throws ER_DUP_ENTRY if the email exists. */
      async createWithProfile(user, profile) {
        await tx(async (t) => {
          await t.query('INSERT INTO users (id, email, email_norm, name, password_hash) VALUES (?,?,?,?,?)', [user.id, user.email, user.emailNorm || normalizeEmail(user.email).email, user.name, user.passwordHash]);
          await t.query('INSERT INTO profiles (id, user_id, name, color) VALUES (?,?,?,?)', [profile.id, user.id, profile.name, profile.color]);
        });
      },
      async rename(id, name) { await q('UPDATE users SET name = ? WHERE id = ?', [name, id]); },
      /** Deleting the user cascades to profiles, list, progress, reminders and subscription. */
      async remove(id) { await q('DELETE FROM users WHERE id = ?', [id]); },
    },

    /** Linked social accounts (Google / Facebook). */
    identities: {
      async userFor(provider, subject) {
        return userRow((await q('SELECT u.* FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?', [provider, subject]))[0]);
      },
      async touch(provider, subject) { await q('UPDATE auth_identities SET last_login_at = UTC_TIMESTAMP(3) WHERE provider = ? AND subject = ?', [provider, subject]); },
      async link(userId, { provider, subject, email }) { await q('INSERT IGNORE INTO auth_identities (provider, subject, user_id, email, last_login_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [provider, subject, userId, email]); },
      async providersOf(userId) { return (await q('SELECT provider FROM auth_identities WHERE user_id = ? ORDER BY created_at', [userId])).map((r) => r.provider); },
      /** New passwordless account + first profile + identity, atomically. Throws ER_DUP_ENTRY on an email/identity race. */
      async createUser(user, profile, { provider, subject, email }) {
        await tx(async (t) => {
          await t.query('INSERT INTO users (id, email, email_norm, name, password_hash) VALUES (?,?,?,?,NULL)', [user.id, user.email, user.emailNorm || normalizeEmail(user.email).email, user.name]);
          await t.query('INSERT INTO profiles (id, user_id, name, color) VALUES (?,?,?,?)', [profile.id, user.id, profile.name, profile.color]);
          await t.query('INSERT INTO auth_identities (provider, subject, user_id, email, last_login_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [provider, subject, user.id, email]);
        });
      },
    },

    // ---- Profiles: up to a handful per account (Netflix-style), one may be a kids profile ----
    profiles: {
      async list(userId) { return (await q('SELECT id, name, color, kids FROM profiles WHERE user_id = ? ORDER BY created_at, id', [userId])).map(profileRow); },
      async get(id, userId) { const r = (await q('SELECT id, name, color, kids FROM profiles WHERE id = ? AND user_id = ?', [id, userId]))[0]; return r ? profileRow(r) : null; },
      /** Enforces the per-user limit under a row lock so concurrent requests can't exceed it. Returns null at the limit. */
      async create(userId, { id, name, kids = false }, max, palette) {
        return tx(async (t) => {
          await t.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
          const [{ n }] = await t.query('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', [userId]);
          if (n >= max) return null;
          const color = n % palette;
          await t.query('INSERT INTO profiles (id, user_id, name, color, kids) VALUES (?,?,?,?,?)', [id, userId, name, color, kids ? 1 : 0]);
          return { id, name, color, ...(kids ? { kids: true } : {}) };
        });
      },
      // Builds the UPDATE from only the fields present in `patch` (partial update).
      async update(id, patch) {
        const sets = [], vals = [];
        for (const k of ['name', 'color', 'kids']) if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(k === 'kids' ? (patch[k] ? 1 : 0) : patch[k]); }
        if (sets.length) await q(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
        return profileRow((await q('SELECT id, name, color, kids FROM profiles WHERE id = ?', [id]))[0]);
      },
      /** Removes a profile unless it's the user's last one. Returns false when refused. */
      async remove(id, userId) {
        return tx(async (t) => {
          await t.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
          const [{ n }] = await t.query('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', [userId]);
          if (n <= 1) return false;
          await t.query('DELETE FROM profiles WHERE id = ? AND user_id = ?', [id, userId]);
          return true;
        });
      },
    },

    // ---- Per-profile library: My List, watch progress (continue watching) and release reminders ----
    library: {
      async get(profileId) {
        const [list, prog, rem] = await Promise.all([
          q('SELECT item_type, item_id, added_at FROM list_items WHERE profile_id = ? ORDER BY added_at, item_id', [profileId]),
          q('SELECT video_id, position_sec, duration_sec, updated_at FROM watch_progress WHERE profile_id = ?', [profileId]),
          q('SELECT upcoming_id FROM reminders WHERE profile_id = ? ORDER BY created_at, upcoming_id', [profileId]),
        ]);
        return {
          list: list.map((r) => ({ type: r.item_type, id: r.item_id, addedAt: iso(r.added_at) })),
          progress: Object.fromEntries(prog.map((r) => [r.video_id, { position: r.position_sec, duration: r.duration_sec, updatedAt: iso(r.updated_at) }])),
          reminders: rem.map((r) => r.upcoming_id),
        };
      },
      async addListItem(profileId, type, id) { await q('INSERT IGNORE INTO list_items (profile_id, item_type, item_id) VALUES (?,?,?)', [profileId, type, id]); },
      async removeListItem(profileId, type, id) { await q('DELETE FROM list_items WHERE profile_id = ? AND item_type = ? AND item_id = ?', [profileId, type, id]); },
      // Upsert: one row per (profile, video), updated as playback advances.
      async saveProgress(profileId, videoId, position, duration) {
        await q(`INSERT INTO watch_progress (profile_id, video_id, position_sec, duration_sec, updated_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))
                 ON DUPLICATE KEY UPDATE position_sec = VALUES(position_sec), duration_sec = VALUES(duration_sec), updated_at = VALUES(updated_at)`,
          [profileId, videoId, position, duration]);
        // Keep only the most recent MAX_PROGRESS rows per profile.
        const [{ n }] = await q('SELECT COUNT(*) AS n FROM watch_progress WHERE profile_id = ?', [profileId]);
        if (n > MAX_PROGRESS) await q('DELETE FROM watch_progress WHERE profile_id = ? ORDER BY updated_at ASC LIMIT ?', [profileId, n - MAX_PROGRESS]);
      },
      async removeProgress(profileId, videoId) { await q('DELETE FROM watch_progress WHERE profile_id = ? AND video_id = ?', [profileId, videoId]); },
      async addReminder(profileId, id) { await q('INSERT IGNORE INTO reminders (profile_id, upcoming_id) VALUES (?,?)', [profileId, id]); },
      async removeReminder(profileId, id) { await q('DELETE FROM reminders WHERE profile_id = ? AND upcoming_id = ?', [profileId, id]); },
    },

    // ---- Premium access: one row per user with an expiry date ----
    subscriptions: {
      /** Effective subscription. An expired plan reads as free (status 'expired') so every access check is a simple planId test. */
      async get(userId) {
        const r = (await q('SELECT * FROM subscriptions WHERE user_id = ?', [userId]))[0];
        if (!r || r.plan_id === 'free') return { planId: 'free', status: 'active' };
        if (r.expires_at && r.expires_at.getTime() <= Date.now()) return { planId: 'free', status: 'expired', expiredPlanId: r.plan_id, expiresAt: iso(r.expires_at) };
        return { planId: r.plan_id, status: r.status, provider: r.provider, demo: !!r.is_demo, startedAt: iso(r.started_at), expiresAt: iso(r.expires_at) };
      },
      /** Grants `days` of access; an unexpired plan is extended rather than replaced. */
      async extend(userId, { planId, days, provider, demo = false }, t = { query: q }) {
        // Make sure the row exists first, so the FOR UPDATE below locks a record rather than a gap (gap locks deadlock under concurrent purchases).
        await t.query("INSERT IGNORE INTO subscriptions (user_id, plan_id, status) VALUES (?, 'free', 'active')", [userId]);
        const [row] = await t.query('SELECT * FROM subscriptions WHERE user_id = ? FOR UPDATE', [userId]);
        const now = Date.now();
        const live = row.plan_id !== 'free' && row.expires_at && row.expires_at.getTime() > now;
        const base = live ? row.expires_at.getTime() : now;
        const expires = new Date(base + days * 86_400_000);
        const started = live && row.started_at ? row.started_at : new Date(now);
        await t.query("UPDATE subscriptions SET plan_id = ?, status = 'active', provider = ?, is_demo = ?, started_at = ?, expires_at = ?, updated_at = UTC_TIMESTAMP(3) WHERE user_id = ?",
          [planId, provider, demo ? 1 : 0, started, expires, userId]);
      },
      async clear(userId) { await q('DELETE FROM subscriptions WHERE user_id = ?', [userId]); },
      /** Paid plans that end within `days` and haven't been reminded about this particular expiry date yet. */
      async dueForReminder(days, limit = 200) {
        return (await q(`SELECT s.user_id, s.plan_id, s.expires_at, u.email, u.name FROM subscriptions s JOIN users u ON u.id = s.user_id
                         WHERE s.is_demo = 0 AND (s.provider IS NULL OR s.provider <> 'admin') AND s.plan_id <> 'free' AND s.expires_at > UTC_TIMESTAMP(3) AND s.expires_at <= UTC_TIMESTAMP(3) + INTERVAL ? DAY
                           AND (s.expiry_reminder_for IS NULL OR s.expiry_reminder_for <> s.expires_at) LIMIT ?`, [days, limit]))
          .map((r) => ({ userId: r.user_id, planId: r.plan_id, expiresAt: r.expires_at, email: r.email, name: r.name }));
      },
      /** Multi-instance safe: exactly one caller gets `true` for a given expiry date. */
      async claimReminder(userId, expiresAt) {
        return (await q('UPDATE subscriptions SET expiry_reminder_for = expires_at WHERE user_id = ? AND expires_at = ? AND (expiry_reminder_for IS NULL OR expiry_reminder_for <> expires_at)', [userId, expiresAt])).affectedRows === 1;
      },
      /** Demo-only: activate for `days` without a payment. */
      async activateDemo(userId, planId, days) { await tx(async (t) => this.extend(userId, { planId, days, provider: 'mock', demo: true }, t)); },
    },

    // ---- Payment orders (Razorpay or demo). Status goes created -> paid, or stays created/failed ----
    payments: {
      /** `coupon` (a coupons row) makes the insert happen under the coupon's row lock so its limits can't be beaten by parallel checkouts. */
      async create(p, { coupon = null } = {}) {
        const insert = (t) => t.query(
          'INSERT INTO payments (id, user_id, plan_id, provider, provider_order_id, amount_paise, list_price_paise, discount_paise, coupon_code, billing, currency) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [p.id, p.userId, p.planId, p.provider, p.orderId, p.amountPaise, p.listPricePaise ?? p.amountPaise, p.discountPaise ?? 0, p.couponCode ?? null, p.billing ? JSON.stringify(p.billing) : null, p.currency || 'INR']);
        if (coupon) await self.coupons.reserve(coupon, p.userId, insert); else await insert({ query: q });
      },
      // Lookups by our id, the provider's order id and the provider's payment id (used by the webhook).
      async byOrder(provider, orderId) { return mapPayment((await q('SELECT * FROM payments WHERE provider = ? AND provider_order_id = ?', [provider, orderId]))[0]); },
      async byProviderPayment(provider, providerPaymentId) { return mapPayment((await q('SELECT * FROM payments WHERE provider = ? AND provider_payment_id = ?', [provider, providerPaymentId]))[0]); },
      async byId(id) { return mapPayment((await q('SELECT * FROM payments WHERE id = ?', [id]))[0]); },
      /** An unpaid, recent order for the same purchase — reopened instead of creating a second one (keeps coupon accounting honest). */
      async openOrder({ userId, planId, amountPaise, couponCode, provider, maxAgeMin = 30 }) {
        const r = (await q(`SELECT * FROM payments WHERE user_id = ? AND plan_id = ? AND provider = ? AND amount_paise = ? AND status = 'created' AND (coupon_code <=> ?)
                            AND created_at > UTC_TIMESTAMP(3) - INTERVAL ? MINUTE ORDER BY created_at DESC LIMIT 1`, [userId, planId, provider, amountPaise, couponCode ?? null, maxAgeMin]))[0];
        return mapPayment(r);
      },
      // Stores the buyer's GST details (name, GSTIN, state) on a still-unpaid order.
      async setBilling(id, billing) { await q("UPDATE payments SET billing = ? WHERE id = ? AND status = 'created'", [JSON.stringify(billing), id]); },
      /** Atomically claims the right to send the "payment failed" email for an order (once). */
      async claimFailedNotice(id) { return (await q('UPDATE payments SET failed_notified_at = UTC_TIMESTAMP(3) WHERE id = ? AND failed_notified_at IS NULL AND status = \'created\'', [id])).affectedRows === 1; },
      /**
       * Marks the order paid, grants the plan and (optionally) issues the tax invoice in ONE transaction. Safe to call repeatedly
       * (browser verify + webhook): only the call that flips created→paid grants access. `invoice(paymentRow)` returns the invoice
       * fields to store (see billing.js) or null. Returns { applied, invoice }.
       */
      async settle(payment, providerPaymentId, days, { invoice = null } = {}) {
        if (invoice) await self.invoices.ensureCounter('INV');
        return tx(async (t) => {
          const res = await t.query("UPDATE payments SET status = 'paid', provider_payment_id = ?, paid_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'created'", [providerPaymentId, payment.id]);
          if (!res.affectedRows) return { applied: false, invoice: null };
          if (payment.userId) await self.subscriptions.extend(payment.userId, { planId: payment.planId, days, provider: payment.provider }, t);
          let issued = null;
          if (invoice) {
            const fields = invoice(mapPayment((await t.query('SELECT * FROM payments WHERE id = ?', [payment.id]))[0]));
            if (fields) issued = await self.invoices.issue(t, { kind: 'invoice', paymentId: payment.id, userId: payment.userId, ...fields });
          }
          return { applied: true, invoice: issued };
        });
      },
      /** A user's payment history, newest first, with invoices, credit notes and refunds attached. */
      async listForUser(userId, limit = 100) {
        const rows = (await q("SELECT * FROM payments WHERE user_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT ?", [userId, limit])).map(mapPayment);
        for (const p of rows) { p.invoices = await self.invoices.forPayment(p.id); p.refunds = await self.refunds.forPayment(p.id); }
        return rows;
      },
      /** Payments for the admin console: filter by buyer (email or user id) and status, newest first. */
      // Optional filters are added to the WHERE clause only when supplied.
      async listRecent({ email = null, userId = null, status = null, limit = 50, offset = 0 } = {}) {
        const where = [], args = [];
        if (email) { where.push('u.email = ?'); args.push(email); }
        if (userId) { where.push('p.user_id = ?'); args.push(userId); }
        if (status) { where.push('p.status = ?'); args.push(status); }
        const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const rows = (await q(`SELECT p.*, u.email AS user_email FROM payments p LEFT JOIN users u ON u.id = p.user_id ${w} ORDER BY p.created_at DESC, p.id LIMIT ? OFFSET ?`, [...args, limit, offset]))
          .map((r) => ({ ...mapPayment(r), userEmail: r.user_email }));
        for (const p of rows) { p.invoices = await self.invoices.forPayment(p.id); p.refunds = await self.refunds.forPayment(p.id); }
        return rows;
      },
      async countAll({ email = null, userId = null, status = null } = {}) {
        const where = [], args = [];
        if (email) { where.push('u.email = ?'); args.push(email); }
        if (userId) { where.push('p.user_id = ?'); args.push(userId); }
        if (status) { where.push('p.status = ?'); args.push(status); }
        return (await q(`SELECT COUNT(*) AS n FROM payments p LEFT JOIN users u ON u.id = p.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, args))[0].n;
      },
    },

    // ---- Messages from the public contact form (read in the admin console) ----
    contacts: {
      async add(e) { await q('INSERT INTO contact_messages (id, name, email, phone, message) VALUES (?,?,?,?,?)', [e.id, e.name, e.email, e.phone, e.message]); },
      async count() { return (await q('SELECT COUNT(*) AS n FROM contact_messages'))[0].n; },
    },
  };
  // Merge in the other data-access modules. They share the pool, transaction helper and `self`.
  Object.assign(self, extraDb({ q, tx, self, iso }));         // reset/verify tokens, ratings, comments, push, analytics…
  Object.assign(self, billingDb({ q, tx, self, iso }));      // coupons, invoices, refunds
  Object.assign(self, adminDb({ q, tx, self, iso }));        // catalog, audit log, admin user/message queries, dashboard numbers
  return self;
}
