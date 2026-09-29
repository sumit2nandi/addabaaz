import mysql from 'mysql2/promise';
import { dbConfigFromEnv } from './config.js';

const iso = (d) => (d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : null);
export const isDuplicate = (e) => e?.code === 'ER_DUP_ENTRY';
const MAX_PROGRESS = 500;

/**
 * MySQL data-access layer. Every method is async and uses parameterised queries.
 * Timestamps are UTC (pool option timezone 'Z') and returned to the API as ISO strings.
 */
export async function createDb({ config = dbConfigFromEnv(), ensureDatabase = false } = {}) {
  const { database, ...conn } = config;
  if (ensureDatabase) {                                   // used by `npm run db:migrate` and tests
    const c = await mysql.createConnection({ ...conn, ssl: config.ssl });
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.end();
  }
  const pool = mysql.createPool({
    ...conn, database, timezone: 'Z', charset: 'utf8mb4', waitForConnections: true, queueLimit: 0,
    connectTimeout: 10_000, supportBigNumbers: true, dateStrings: false,
  });
  pool.pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));   // DEFAULT CURRENT_TIMESTAMP is then UTC too
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

  const userRow = (r) => r && { id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash, createdAt: iso(r.created_at) };
  const profileRow = (r) => ({ id: r.id, name: r.name, color: r.color });

  return {
    pool,
    async ping() { await q('SELECT 1'); return true; },
    async close() { await pool.end(); },
    async dropDatabase() { await q(`DROP DATABASE IF EXISTS \`${database.replace(/`/g, '')}\``); },

    users: {
      async byEmail(email) { return userRow((await q('SELECT * FROM users WHERE email = ?', [email]))[0]); },
      async byId(id) { return userRow((await q('SELECT * FROM users WHERE id = ?', [id]))[0]); },
      /** Creates the user and their first profile atomically. Throws ER_DUP_ENTRY if the email exists. */
      async createWithProfile(user, profile) {
        await tx(async (t) => {
          await t.query('INSERT INTO users (id, email, name, password_hash) VALUES (?,?,?,?)', [user.id, user.email, user.name, user.passwordHash]);
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
          await t.query('INSERT INTO users (id, email, name, password_hash) VALUES (?,?,?,NULL)', [user.id, user.email, user.name]);
          await t.query('INSERT INTO profiles (id, user_id, name, color) VALUES (?,?,?,?)', [profile.id, user.id, profile.name, profile.color]);
          await t.query('INSERT INTO auth_identities (provider, subject, user_id, email, last_login_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [provider, subject, user.id, email]);
        });
      },
    },

    profiles: {
      async list(userId) { return (await q('SELECT id, name, color FROM profiles WHERE user_id = ? ORDER BY created_at, id', [userId])).map(profileRow); },
      async get(id, userId) { const r = (await q('SELECT id, name, color FROM profiles WHERE id = ? AND user_id = ?', [id, userId]))[0]; return r ? profileRow(r) : null; },
      /** Enforces the per-user limit under a row lock so concurrent requests can't exceed it. Returns null at the limit. */
      async create(userId, { id, name }, max, palette) {
        return tx(async (t) => {
          await t.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
          const [{ n }] = await t.query('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', [userId]);
          if (n >= max) return null;
          const color = n % palette;
          await t.query('INSERT INTO profiles (id, user_id, name, color) VALUES (?,?,?,?)', [id, userId, name, color]);
          return { id, name, color };
        });
      },
      async update(id, patch) {
        const sets = [], vals = [];
        for (const k of ['name', 'color']) if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
        if (sets.length) await q(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
        return profileRow((await q('SELECT id, name, color FROM profiles WHERE id = ?', [id]))[0]);
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

    subscriptions: {
      async get(userId) {
        const r = (await q('SELECT * FROM subscriptions WHERE user_id = ?', [userId]))[0];
        if (!r || r.plan_id === 'free') return { planId: 'free', status: 'active' };
        return { planId: r.plan_id, status: r.status, provider: r.provider, demo: !!r.is_demo, startedAt: iso(r.started_at) };
      },
      async set(userId, { planId, status = 'active', provider = null, demo = false }) {
        await q(`INSERT INTO subscriptions (user_id, plan_id, status, provider, is_demo, started_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))
                 ON DUPLICATE KEY UPDATE plan_id = VALUES(plan_id), status = VALUES(status), provider = VALUES(provider),
                                         is_demo = VALUES(is_demo), started_at = VALUES(started_at), updated_at = UTC_TIMESTAMP(3)`,
          [userId, planId, status, provider, demo ? 1 : 0]);
      },
    },

    contacts: {
      async add(e) { await q('INSERT INTO contact_messages (id, name, email, phone, message) VALUES (?,?,?,?,?)', [e.id, e.name, e.email, e.phone, e.message]); },
      async count() { return (await q('SELECT COUNT(*) AS n FROM contact_messages'))[0].n; },
    },
  };
}
