// Queries that power the admin console: the database-backed catalog (shows, videos, upcoming, gallery),
// the audit log, user and message management, and the dashboard numbers.
// JSON columns may arrive as text or as objects; normalise.
const json = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
// Builds a `%text%` pattern for LIKE and escapes %, _ and \ so a search for "50%" is literal.
const like = (s) => `%${String(s).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
// Maps API collection names (plural) to the `type` column in catalog_items, and back.
const DB_TYPE = { shows: 'show', videos: 'video', upcoming: 'upcoming', gallery: 'gallery' };
const PLURAL = Object.fromEntries(Object.entries(DB_TYPE).map(([k, v]) => [v, k]));
// Calendar date in India time (UTC+5:30); dashboard charts are grouped by IST days.
const istDay = (d) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Admin-console queries: database-backed catalog, audit log, user/message management, dashboard numbers. Mixed into createDb(). */
import { HttpError, bad } from './http.js';
import { normalizeEmail, emailKey } from './email-address.js';

export function adminDb({ q, tx, self, iso }) {
  // Every catalog write increments a version number; the public catalog cache uses it to know when to reload.
  const bump = (t) => t.query("UPDATE catalog_meta SET n = n + 1, at = UTC_TIMESTAMP(3) WHERE k = 'version'");

  // ---- Catalog: each item is stored as a JSON document in `catalog_items` (type, id, position) ----
  const catalog = {
    // Current catalog version (0 when empty).
    async version() { return Number((await q("SELECT n FROM catalog_meta WHERE k = 'version'"))[0]?.n ?? 0); },
    /** Everything in the shape of data/catalog.json (+ `studio`), each list in its stored order. */
    async snapshot() {
      const rows = await q('SELECT type, doc, updated_at FROM catalog_items ORDER BY type, position, id');
      // Rebuild the same structure as data/catalog.json from the rows.
      const out = { schema: 1, updatedAt: null, shows: [], videos: [], upcoming: [], gallery: [] }; let studio = null, latest = 0;
      for (const r of rows) {
        latest = Math.max(latest, r.updated_at.getTime());
        if (r.type === 'studio') studio = json(r.doc); else out[PLURAL[r.type]].push(json(r.doc));
      }
      out.updatedAt = latest ? new Date(latest).toISOString().slice(0, 10) : null;
      return { catalog: out, studio };
    },
    /** One-time import (from data/catalog.json + studio.json). Exactly one caller wins, even with several servers starting together. */
    async seed(data, studio) {
      return tx(async (t) => {
        if (!(await t.query("INSERT IGNORE INTO catalog_meta (k, n) VALUES ('seeded', 1)")).affectedRows) return false;
        for (const [key, type] of Object.entries(DB_TYPE)) {
          const items = data[key] || [];
          for (let i = 0; i < items.length; i += 100) {
            const chunk = items.slice(i, i + 100);
            await t.query('INSERT IGNORE INTO catalog_items (type, id, position, doc) VALUES ?', [chunk.map((d, j) => [type, d.id, i + j, JSON.stringify(d)])]);
          }
        }
        if (studio) await t.query("INSERT IGNORE INTO catalog_items (type, id, position, doc) VALUES ('studio', 'main', 0, ?)", [JSON.stringify(studio)]);
        await bump(t);
        return true;
      });
    },
    // Fetch one document, or null.
    async get(key, id) { const r = (await q('SELECT doc FROM catalog_items WHERE type = ? AND id = ?', [DB_TYPE[key], id]))[0]; return r ? json(r.doc) : null; },
    /** Creates (`create`) or replaces one document. Returns 'created' | 'updated' | null (update of a missing id). Throws ER_DUP_ENTRY on create of an existing id. */
    async put(key, id, doc, { create = false } = {}) {
      const type = DB_TYPE[key];
      return tx(async (t) => {
        // New coming-soon posters lead their row; other new items go to the end. Existing items stay in place.
        if (create) {
          let next = 0;
          if (key === 'upcoming') await t.query('UPDATE catalog_items SET position = position + 1 WHERE type = ?', [type]);
          else {
            const [{ next: position }] = await t.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM catalog_items WHERE type = ?', [type]);
            next = position;
          }
          await t.query('INSERT INTO catalog_items (type, id, position, doc) VALUES (?,?,?,?)', [type, id, next, JSON.stringify(doc)]);
        } else {
          const res = await t.query('UPDATE catalog_items SET doc = ?, updated_at = UTC_TIMESTAMP(3) WHERE type = ? AND id = ?', [JSON.stringify(doc), type, id]);
          if (!res.affectedRows) return null;
        }
        await bump(t);
        return create ? 'created' : 'updated';
      });
    },
    /** Atomically adds a chunk of imported YouTube videos and their batch history rows; existing catalog ids are skipped. */
    async putYouTubeImports(docs, { batchId, actor }) {
      return tx(async (t) => {
        const [{ next }] = await t.query("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM catalog_items WHERE type = 'video'");
        const actorName = String(actor).slice(0, 254), added = [];
        let position = Number(next);
        for (const doc of docs) {
          const inserted = await t.query("INSERT IGNORE INTO catalog_items (type, id, position, doc) VALUES ('video', ?, ?, ?)", [doc.id, position, JSON.stringify(doc)]);
          if (!inserted.affectedRows) continue;
          await t.query('INSERT IGNORE INTO youtube_import_items (batch_id, video_id, actor, imported_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [batchId, doc.id, actorName]);
          added.push(doc.id); position++;
        }
        if (added.length) await bump(t);
        return added;
      });
    },
    /** Stores a short-lived full-channel preview; expired snapshots are reaped on each new preview. */
    async createYouTubePreview({ snapshotId, actor, checkedAt, expiresAt, videos }) {
      await q('DELETE FROM youtube_preview_snapshots WHERE expires_at <= UTC_TIMESTAMP(3)');
      await q('INSERT INTO youtube_preview_snapshots (snapshot_id, actor, checked_at, expires_at, videos) VALUES (?,?,?,?,?)', [snapshotId, String(actor).slice(0, 254), checkedAt, expiresAt, JSON.stringify(videos)]);
    },
    /** Fetch a preview only for its creator and only while the signed snapshot is still live. */
    async getYouTubePreview(snapshotId, actor) {
      const row = (await q('SELECT checked_at, expires_at, videos FROM youtube_preview_snapshots WHERE snapshot_id = ? AND actor = ? AND expires_at > UTC_TIMESTAMP(3)', [snapshotId, String(actor).slice(0, 254)]))[0];
      return row ? { snapshotId, checkedAt: iso(row.checked_at), expiresAt: iso(row.expires_at), videos: json(row.videos) } : null;
    },
    /** Hides/restores matching videos without changing their other catalog attributes. */
    async setVideosHidden(ids, hidden) {
      const unique = [...new Set(ids)]; if (!unique.length) return [];
      return tx(async (t) => {
        const marks = unique.map(() => '?').join(',');
        const rows = await t.query(`SELECT id FROM catalog_items WHERE type = 'video' AND id IN (${marks}) FOR UPDATE`, unique);
        const found = rows.map((r) => r.id); if (!found.length) return [];
        const foundMarks = found.map(() => '?').join(',');
        await t.query(`UPDATE catalog_items SET doc = JSON_SET(doc, '$.hidden', JSON_EXTRACT(?, '$')), updated_at = UTC_TIMESTAMP(3) WHERE type = 'video' AND id IN (${foundMarks})`, [hidden ? 'true' : 'false', ...found]);
        await bump(t);
        return found;
      });
    },
    /** Deletes many videos in one transaction and also removes viewer list/progress references. */
    async removeVideos(ids) {
      const unique = [...new Set(ids)]; if (!unique.length) return [];
      return tx(async (t) => {
        const marks = unique.map(() => '?').join(',');
        const rows = await t.query(`SELECT id FROM catalog_items WHERE type = 'video' AND id IN (${marks}) FOR UPDATE`, unique);
        const found = rows.map((r) => r.id); if (!found.length) return [];
        const foundMarks = found.map(() => '?').join(',');
        await t.query(`DELETE FROM catalog_items WHERE type = 'video' AND id IN (${foundMarks})`, found);
        await t.query(`DELETE FROM list_items WHERE item_type = 'video' AND item_id IN (${foundMarks})`, found);
        await t.query(`DELETE FROM watch_progress WHERE video_id IN (${foundMarks})`, found);
        await bump(t);
        return found;
      });
    },

    // The studio/about page content is a single document stored as type 'studio'.

    async putStudio(doc) {
      return tx(async (t) => {
        await t.query("INSERT INTO catalog_items (type, id, position, doc) VALUES ('studio', 'main', 0, ?) ON DUPLICATE KEY UPDATE doc = VALUES(doc), updated_at = UTC_TIMESTAMP(3)", [JSON.stringify(doc)]);
        await bump(t);
      });
    },
    /** Deletes an item and everything that points at it (My List entries, progress, reminders); `cascade` also deletes a show's videos. */
    async remove(key, id, { cascade = false } = {}) {
      const type = DB_TYPE[key];
      return tx(async (t) => {
        if (!(await t.query('DELETE FROM catalog_items WHERE type = ? AND id = ?', [type, id])).affectedRows) return null;
        const gone = [id]; let videos = 0;
        // Deleting an item also removes viewers' saved references to it. Deleting a show with `cascade` removes its episodes as well.
        if (key === 'shows') {
          await t.query('DELETE FROM list_items WHERE item_type = ? AND item_id = ?', ['show', id]);
          if (cascade) {
            const vids = (await t.query("SELECT id FROM catalog_items WHERE type = 'video' AND JSON_UNQUOTE(JSON_EXTRACT(doc, '$.showId')) = ?", [id])).map((r) => r.id);
            for (const v of vids) { await t.query("DELETE FROM catalog_items WHERE type = 'video' AND id = ?", [v]); await t.query('DELETE FROM list_items WHERE item_type = ? AND item_id = ?', ['video', v]); await t.query('DELETE FROM watch_progress WHERE video_id = ?', [v]); }
            videos = vids.length;
          }
        } else if (key === 'videos') { await t.query('DELETE FROM list_items WHERE item_type = ? AND item_id = ?', ['video', id]); await t.query('DELETE FROM watch_progress WHERE video_id = ?', [id]); }
        else if (key === 'upcoming') { await t.query('DELETE FROM list_items WHERE item_type = ? AND item_id = ?', ['upcoming', id]); await t.query('DELETE FROM reminders WHERE upcoming_id = ?', [id]); }
        await bump(t);
        return { removed: gone.length, videos };
      });
    },
    /** Stores the given id order for a list (shows / upcoming / gallery). Ids not in the list keep their relative order at the end. */
    async reorder(key, ids) {
      const type = DB_TYPE[key];
      return tx(async (t) => {
        const existing = (await t.query('SELECT id FROM catalog_items WHERE type = ? ORDER BY position, id FOR UPDATE', [type])).map((r) => r.id);
        // Ignore unknown/duplicate ids, then append anything not mentioned so nothing gets lost.
        const known = new Set(existing), first = ids.filter((i, n) => known.has(i) && ids.indexOf(i) === n);
        const order = [...first, ...existing.filter((i) => !first.includes(i))];
        for (let i = 0; i < order.length; i++) await t.query('UPDATE catalog_items SET position = ? WHERE type = ? AND id = ?', [i, type, order[i]]);
        await bump(t);
        return order;
      });
    },
    async countVideosOf(showId) { return (await q("SELECT COUNT(*) AS n FROM catalog_items WHERE type = 'video' AND JSON_UNQUOTE(JSON_EXTRACT(doc, '$.showId')) = ?", [showId]))[0].n; },
  };

  // ---- Uploaded files: admin-uploaded images and subtitles live in MySQL (the upload folder is only a cache of them) ----
  const uploads = {
    /** Stores a file under its content-hash name; identical bytes have the same name, so a repeat upload is a no-op. */
    async put(name, type, data) { await q('INSERT IGNORE INTO uploaded_files (name, content_type, bytes, data) VALUES (?,?,?,?)', [name, type, data.length, data]); },
    /** { type, data } for a stored file, or null. */
    async get(name) { const r = (await q('SELECT content_type, data FROM uploaded_files WHERE name = ?', [name]))[0]; return r ? { type: r.content_type, data: r.data } : null; },
    /** The subset of `names` that is stored, as a Set (used to validate catalog references without touching the disk). */
    async existing(names) {
      if (!names.length) return new Set();
      const rows = await q(`SELECT name FROM uploaded_files WHERE name IN (${names.map(() => '?').join(',')})`, names);
      return new Set(rows.map((r) => r.name));
    },
  };

  // ---- Audit log: who did what in the admin console ----
  const audit = {
    async add({ actorId = null, actor, action, target = null, meta = null, ip = null }) {
      await q('INSERT INTO admin_audit (actor_id, actor, action, target, meta, ip) VALUES (?,?,?,?,?,?)', [actorId, String(actor).slice(0, 254), action, target && String(target).slice(0, 200), meta ? JSON.stringify(meta) : null, ip]);
    },
    async list({ limit = 100, before = null, action = null } = {}) {
      const where = [], args = [];
      if (before) { where.push('id < ?'); args.push(before); }
      if (action) { where.push('action LIKE ?'); args.push(like(action)); }
      const rows = await q(`SELECT * FROM admin_audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`, [...args, limit]);
      return rows.map((r) => ({ id: r.id, at: iso(r.at), actor: r.actor, action: r.action, target: r.target, meta: json(r.meta), ip: r.ip }));
    },
  };

  // ---- YouTube import history: records stay after catalog deletion so "today" and "last batch" remain auditable ----
  const youtubeImports = {
    /** Most recent import batch plus every video imported within the supplied UTC day bounds. */
    async summary({ start, end }) {
      const latest = (await q(`SELECT batch_id, MAX(imported_at) AS imported_at
        FROM youtube_import_items GROUP BY batch_id ORDER BY MAX(imported_at) DESC LIMIT 1`))[0] || null;
      const lastItems = latest
        ? await q('SELECT video_id FROM youtube_import_items WHERE batch_id = ? ORDER BY imported_at, video_id', [latest.batch_id])
        : [];
      const todayItems = await q(`SELECT DISTINCT video_id FROM youtube_import_items
        WHERE imported_at >= ? AND imported_at < ? ORDER BY video_id`, [start, end]);
      return {
        last: latest ? { batchId: latest.batch_id, importedAt: iso(latest.imported_at), videoIds: lastItems.map((r) => r.video_id) } : null,
        todayVideoIds: todayItems.map((r) => r.video_id),
      };
    },
  };

  // ---- User management ----
  const mapUserRow = (r) => ({
    id: r.id, email: r.email, name: r.name, createdAt: iso(r.created_at), isAdmin: !!r.is_admin, disabledAt: iso(r.disabled_at),
    phone: r.phone || null, phoneVerifiedAt: iso(r.phone_verified_at),
    planId: r.plan_id && r.expires_at && r.expires_at.getTime() > Date.now() ? r.plan_id : 'free', expiresAt: iso(r.expires_at), planSource: r.provider || null,
    profiles: r.profiles ?? undefined, providers: r.providers ? r.providers.split(',') : [],
  });
  // SQL snippets for the filter tabs in the Users page (a fixed allow-list, never user input).
  const USER_FILTERS = {
    all: '1=1', paid: "s.plan_id <> 'free' AND s.expires_at > UTC_TIMESTAMP(3)", free: "(s.user_id IS NULL OR s.plan_id = 'free' OR s.expires_at <= UTC_TIMESTAMP(3))",
    expiring: "s.plan_id <> 'free' AND s.expires_at > UTC_TIMESTAMP(3) AND s.expires_at <= UTC_TIMESTAMP(3) + INTERVAL 7 DAY", expired: "s.plan_id <> 'free' AND s.expires_at <= UTC_TIMESTAMP(3)",
    admin: 'u.is_admin = 1', disabled: 'u.disabled_at IS NOT NULL',
  };
  // Exposed as `db.adminUsers`.
  const adminUsers = {
    // Search + filter + pagination in one query; `total` is returned for the pager.
    async list({ q: search = '', filter = 'all', limit = 25, offset = 0 } = {}) {
      const where = [USER_FILTERS[filter] || USER_FILTERS.all], args = [];
      if (search) { where.push('(u.email LIKE ? OR u.name LIKE ?)'); args.push(like(search), like(search)); }
      const from = `FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE ${where.join(' AND ')}`;
      const [{ n }] = await q(`SELECT COUNT(*) AS n ${from}`, args);
      const rows = await q(`SELECT u.*, s.plan_id, s.expires_at, s.provider,
          (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles,
          (SELECT GROUP_CONCAT(i.provider ORDER BY i.created_at) FROM auth_identities i WHERE i.user_id = u.id) AS providers
        ${from} ORDER BY u.created_at DESC, u.id LIMIT ? OFFSET ?`, [...args, limit, offset]);
      return { total: n, users: rows.map(mapUserRow) };
    },
    async get(id) {
      const r = (await q(`SELECT u.*, s.plan_id, s.expires_at, s.provider FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = ?`, [id]))[0];
      if (!r) return null;
      return { ...mapUserRow(r), hasPassword: !!r.password_hash };
    },
    async update(id, patch) {
      const sets = [], vals = [];
      if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
      if (patch.isAdmin !== undefined) { sets.push('is_admin = ?'); vals.push(patch.isAdmin ? 1 : 0); }
      if (patch.disabled !== undefined) { sets.push(patch.disabled ? 'disabled_at = COALESCE(disabled_at, UTC_TIMESTAMP(3))' : 'disabled_at = NULL'); }
      if (sets.length) await q(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    },
    async countAdmins() { return (await q('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled_at IS NULL'))[0].n; },
    /* ---- One address = one account (Admin → Users → “accounts sharing one e-mail”) ----
     * The UNIQUE index on users.email cannot see invisible characters (zero-width space, soft hyphen,
     * full-width ＠ …), and rows created before migration 012 only carry the address as typed. These
     * three methods bring every stored address to the same normalized form, list the rows that still
     * collide, and merge a pair into one account on the admin's word. */

    /**
     * Groups all accounts by the NORMALIZED address — the same definition signup, sign-in and the
     * broadcast audience use. SQL alone cannot do this (it cannot strip a zero-width space), so the
     * grouping happens here; the table is read once.
     */
    async scanEmailGroups({ details = false } = {}) {
      const rows = await q(details
        ? `SELECT u.id, u.email, u.email_norm, u.email_dup, u.name, u.created_at, u.is_admin, u.disabled_at, s.plan_id, s.expires_at,
             (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles,
             (SELECT GROUP_CONCAT(i.provider ORDER BY i.created_at) FROM auth_identities i WHERE i.user_id = u.id) AS providers,
             (SELECT COUNT(*) FROM push_devices d WHERE d.user_id = u.id) AS devices
           FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id`
        : 'SELECT id, email, created_at FROM users');
      const byKey = new Map();
      for (const r of rows) {
        const k = emailKey(r.email);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(r);
      }
      // Oldest first everywhere: the first row of a group is the account that keeps the address.
      for (const list of byKey.values()) list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.id < b.id ? -1 : 1)));
      return byKey;
    },

    /**
     * Brings `email_norm`/`email_dup` in line with the normalized addresses: the oldest account of an
     * address owns it, every other row is flagged for the admin to merge. Idempotent, run at boot and
     * whenever the duplicate report is opened (this is what catches the invisible-character rows SQL
     * could not clean up in the migration).
     */
    async renormalizeEmails() {
      const byKey = await adminUsers.scanEmailGroups();
      let scanned = 0, updated = 0, flagged = 0;
      for (const [key, rows] of byKey) {
        scanned += rows.length;
        for (const [i, r] of rows.entries()) {
          const owner = i === 0;
          try {
            const res = owner
              ? await q('UPDATE users SET email_norm = ?, email_dup = 0 WHERE id = ? AND (email_norm IS NULL OR email_norm <> ? OR email_dup <> 0)', [key, r.id, key])
              : await q('UPDATE users SET email_norm = NULL, email_dup = 1 WHERE id = ? AND (email_norm IS NOT NULL OR email_dup = 0)', [r.id]);
            if (i === 0) updated += res.affectedRows; else if (res.affectedRows) flagged++;
          } catch (e) {
            // Another row already holds this address at the database level: this one is the duplicate.
            if (e?.code !== 'ER_DUP_ENTRY') throw e;
            await q('UPDATE users SET email_norm = NULL, email_dup = 1 WHERE id = ?', [r.id]);
            flagged++;
          }
        }
      }
      return { scanned, updated, flagged };
    },

    /** Groups of accounts whose stored addresses are the same address. Empty array = nothing to fix. */
    async duplicateGroups({ limit = 25 } = {}) {
      const byKey = await adminUsers.scanEmailGroups({ details: true });
      return [...byKey.entries()]
        .filter(([, rows]) => rows.length > 1)
        .slice(0, limit)
        .map(([key, rows]) => ({
          key, count: rows.length,
          users: rows.map((r) => ({
            id: r.id, name: r.name, email: r.email, emailNorm: r.email_norm, dup: !!r.email_dup,
            createdAt: iso(r.created_at), isAdmin: !!r.is_admin, disabled: !!r.disabled_at,
            planId: r.plan_id || 'free', expiresAt: iso(r.expires_at), profiles: Number(r.profiles), devices: Number(r.devices),
            providers: r.providers ? r.providers.split(',') : [],
          })),
        }));
    },

    /**
     * Merges `removeId` into `keepId` — everything the person did follows them to the account that stays,
     * then the extra account is deleted. Only accounts with the same address may be merged.
     * Returns what moved, for the audit log.
     */
    async mergeUsers(keepId, removeId) {
      if (!keepId || !removeId || keepId === removeId) throw bad('Pick two different accounts.');
      const keep = await self.users.byId(keepId), remove = await self.users.byId(removeId);
      if (!keep || !remove) throw new HttpError(404, 'not_found', 'Account not found.');
      const a = normalizeEmail(keep.email).email, b = normalizeEmail(remove.email).email;
      if (a !== b) throw new HttpError(409, 'not_duplicates', 'These accounts do not share an e-mail address — merge is only for duplicates.');

      const moved = {};
      await tx(async (t) => {
        const run = async (label, sql, args) => { const r = await t.query(sql, args); moved[label] = r.affectedRows; };
        // Rows that follow the account itself.
        await run('profiles', 'UPDATE profiles SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        await run('identities', 'UPDATE auth_identities SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        await run('payments', 'UPDATE payments SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        await run('invoices', 'UPDATE invoices SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        await run('refundRequests', 'UPDATE refund_requests SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        await run('supportTickets', 'UPDATE support_tickets SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        await run('campaignDeliveries', 'UPDATE campaign_deliveries SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        await run('pushSubscriptions', 'UPDATE push_subscriptions SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        await run('devices', 'UPDATE push_devices SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        await run('errorReports', 'UPDATE error_log SET user_id = ? WHERE user_id = ?', [keepId, removeId]);
        // Tables whose key includes the user: drop the rows that would collide, then move the rest.
        for (const [label, table] of [['playbackSessions', 'playback_sessions'], ['notifySent', 'notify_sent']]) {
          await t.query(`DELETE r FROM ${table} r JOIN ${table} k ON k.user_id = ? AND r.user_id = ?${label === 'playbackSessions' ? ' AND k.device_id = r.device_id' : ' AND k.kind = r.kind AND k.ref = r.ref'}`, [keepId, removeId]);
          await run(label, `UPDATE ${table} SET user_id = ? WHERE user_id = ?`, [keepId, removeId]);
        }
        // One-off tokens (password reset / verification links) belong to the account being removed.
        await t.query('DELETE FROM auth_tokens WHERE user_id = ?', [removeId]);
        // The subscription is kept only if it gives more access than the one the surviving account has.
        // t.query already returns the rows (db.js unwraps the driver result), so index ONCE.
        const keepSubs = await t.query('SELECT plan_id, expires_at FROM subscriptions WHERE user_id = ?', [keepId]);
        const removeSubs = await t.query('SELECT plan_id, expires_at FROM subscriptions WHERE user_id = ?', [removeId]);
        const ks = keepSubs[0], rs = removeSubs[0];
        moved.subscription = 'kept';
        if (ks && rs) {
          const paid = (p) => p && p.plan_id !== 'free';
          const better = (rs.expires_at && (!ks.expires_at || rs.expires_at > ks.expires_at)) || (paid(rs) && !paid(ks));
          if (better) { await t.query('DELETE FROM subscriptions WHERE user_id = ?', [keepId]); await t.query('UPDATE subscriptions SET user_id = ? WHERE user_id = ?', [keepId, removeId]); moved.subscription = 'moved'; }
          else await t.query('DELETE FROM subscriptions WHERE user_id = ?', [removeId]);
        } else if (rs) { await t.query('UPDATE subscriptions SET user_id = ? WHERE user_id = ?', [keepId, removeId]); moved.subscription = 'moved'; }
        // Carry over what the two accounts told us about the person: admin stays admin, a verified or
        // unsubscribed address stays that way. Names, passwords and sessions stay with the kept account.
        await t.query(`UPDATE users k, users r SET
            k.is_admin = GREATEST(k.is_admin, r.is_admin),
            k.email_verified_at = COALESCE(k.email_verified_at, r.email_verified_at),
            k.email_opt_out_at = GREATEST(COALESCE(k.email_opt_out_at, '1970-01-01'), COALESCE(r.email_opt_out_at, '1970-01-01'))
          WHERE k.id = ? AND r.id = ?`, [keepId, removeId]);
        await t.query("UPDATE users SET email_opt_out_at = NULL WHERE id = ? AND email_opt_out_at = '1970-01-01'", [keepId]);
        // The extra account goes first, so the surviving row can take the address even when the
        // duplicate (not the kept account) was the one holding it.
        await t.query('DELETE FROM users WHERE id = ?', [removeId]);   // cascades to anything still pointing at it
        try { await t.query('UPDATE users SET email_norm = ?, email_dup = 0 WHERE id = ?', [a, keepId]); }
        catch (e) {
          // Belt and braces: another account holds this address, so this one stays flagged for the next report.
          if (e?.code !== 'ER_DUP_ENTRY') throw e;
          await t.query('UPDATE users SET email_norm = NULL, email_dup = 1 WHERE id = ?', [keepId]);
          moved.emailNorm = 'held by another account';
        }
      });
      return { keep: { id: keepId, email: keep.email, name: keep.name }, removed: { id: removeId, email: remove.email, name: remove.name }, moved };
    },
    /* ---- Broadcast e-mail audiences (Admin → Notifications → Email) ----
     * Same filters as the Users page (`filter` is one of USER_FILTERS). Disabled accounts are never
     * mailed, and neither is anyone who clicked the unsubscribe link in an earlier campaign. */
    async emailAudienceCount(filter = 'all') {
      const f = USER_FILTERS[filter] ? filter : 'all';
      const [{ n }] = await q(`SELECT COUNT(*) AS n FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE (${USER_FILTERS[f]}) AND u.disabled_at IS NULL AND u.email_opt_out_at IS NULL AND u.email NOT LIKE '%@phone.addabaaz.in'`);
      return Number(n);
    },
    async emailAudience(filter = 'all', { limit = 200, offset = 0 } = {}) {
      const f = USER_FILTERS[filter] ? filter : 'all';
      return (await q(`SELECT u.id, u.email, u.name FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
        WHERE (${USER_FILTERS[f]}) AND u.disabled_at IS NULL AND u.email_opt_out_at IS NULL AND u.email NOT LIKE '%@phone.addabaaz.in'
        ORDER BY u.created_at, u.id LIMIT ? OFFSET ?`, [limit, offset])).map((r) => ({ id: r.id, email: r.email, name: r.name }));
    },
    async emailOptOutCount() { return Number((await q('SELECT COUNT(*) AS n FROM users WHERE email_opt_out_at IS NOT NULL'))[0].n); },
    async setEmailOptOut(userId, on = true) { return (await q('UPDATE users SET email_opt_out_at = ? WHERE id = ?', [on ? new Date() : null, userId])).affectedRows === 1; },
    async emailOptOut(userId) { const r = (await q('SELECT email_opt_out_at FROM users WHERE id = ?', [userId]))[0]; return !!(r && r.email_opt_out_at); },
    // Used by the `npm run admin` command line to grant/revoke admin rights.
    async setAdminByEmail(email, isAdmin) { return (await q('UPDATE users SET is_admin = ? WHERE email = ? OR email_norm = ?', [isAdmin ? 1 : 0, email, email])).affectedRows >= 1; },
    async admins() { return (await q('SELECT id, email, name FROM users WHERE is_admin = 1 ORDER BY created_at')).map((r) => ({ id: r.id, email: r.email, name: r.name })); },
  };

  // ---- Contact-form inbox ----
  const messages = {
    async list({ status = 'open', limit = 30, offset = 0 } = {}) {
      const where = status === 'open' ? 'WHERE handled_at IS NULL' : status === 'handled' ? 'WHERE handled_at IS NOT NULL' : '';
      const [{ n }] = await q(`SELECT COUNT(*) AS n FROM contact_messages ${where}`);
      const rows = await q(`SELECT * FROM contact_messages ${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, [limit, offset]);
      return { total: n, messages: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, message: r.message, createdAt: iso(r.created_at), handledAt: iso(r.handled_at), handledBy: r.handled_by })) };
    },
    async setHandled(id, by) { return (await q('UPDATE contact_messages SET handled_at = ?, handled_by = ? WHERE id = ?', [by ? new Date() : null, by || null, id])).affectedRows === 1; },
    async remove(id) { return (await q('DELETE FROM contact_messages WHERE id = ?', [id])).affectedRows === 1; },
    async prune() { await q('DELETE FROM contact_messages WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 365 DAY'); },
    async openCount() { return (await q('SELECT COUNT(*) AS n FROM contact_messages WHERE handled_at IS NULL'))[0].n; },
  };

  // ---- Dashboard numbers (all times converted to IST for month/day boundaries) ----
  const stats = {
    async overview(now = new Date()) {
      const ist = new Date(now.getTime() + 330 * 60_000);
      const monthStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000);
      // Run all the dashboard queries in parallel: users, subscribers, revenue, refunds, daily revenue, daily signups, inbox, recent payments/users.
      const [[u], [s], [rev], [refunds], daily, signups, msgs, recentPayments, recentUsers] = await Promise.all([
        q("SELECT COUNT(*) AS total, SUM(created_at >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY) AS week, SUM(created_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY) AS month FROM users"),
        q("SELECT SUM(plan_id <> 'free' AND expires_at > UTC_TIMESTAMP(3)) AS active, SUM(plan_id <> 'free' AND expires_at > UTC_TIMESTAMP(3) AND expires_at <= UTC_TIMESTAMP(3) + INTERVAL 7 DAY) AS expiring, SUM(plan_id <> 'free' AND expires_at > UTC_TIMESTAMP(3) AND provider = 'admin') AS comped FROM subscriptions"),
        q("SELECT COALESCE(SUM(amount_paise - refunded_paise), 0) AS total, COALESCE(SUM(IF(paid_at >= ?, amount_paise - refunded_paise, 0)), 0) AS mtd, COALESCE(SUM(IF(paid_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY, amount_paise - refunded_paise, 0)), 0) AS d30, COUNT(*) AS n FROM payments WHERE status = 'paid' AND amount_paise > 0", [monthStart]),
        q("SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise), 0) AS paise FROM refunds WHERE status = 'processed'"),
        q("SELECT DATE(DATE_ADD(paid_at, INTERVAL 330 MINUTE)) AS d, SUM(amount_paise - refunded_paise) AS paise, COUNT(*) AS n FROM payments WHERE status = 'paid' AND amount_paise > 0 AND paid_at >= UTC_TIMESTAMP(3) - INTERVAL 32 DAY GROUP BY d"),
        q("SELECT DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) AS d, COUNT(*) AS n FROM users WHERE created_at >= UTC_TIMESTAMP(3) - INTERVAL 32 DAY GROUP BY d"),
        messages.openCount(),
        self.payments.listRecent({ limit: 6 }),
        q('SELECT id, email, name, created_at FROM users ORDER BY created_at DESC LIMIT 6'),
      ]);
      const dmap = new Map(daily.map((r) => [r.d.toISOString().slice(0, 10), r])), smap = new Map(signups.map((r) => [r.d.toISOString().slice(0, 10), r.n]));
      // Build a continuous 30-day series so days with no sales still appear (as zero).
      const days = [];
      for (let i = 29; i >= 0; i--) { const d = istDay(new Date(now.getTime() - i * 86_400_000)); days.push({ date: d, paise: Number(dmap.get(d)?.paise || 0), payments: Number(dmap.get(d)?.n || 0), signups: Number(smap.get(d) || 0) }); }
      return {
        users: { total: Number(u.total), last7d: Number(u.week || 0), last30d: Number(u.month || 0) },
        subscribers: { active: Number(s?.active || 0), expiring7d: Number(s?.expiring || 0), comped: Number(s?.comped || 0) },
        revenue: { totalPaise: Number(rev.total), monthToDatePaise: Number(rev.mtd), last30dPaise: Number(rev.d30), payments: Number(rev.n), refunds: Number(refunds.n), refundedPaise: Number(refunds.paise) },
        days, openMessages: Number(msgs),
        recentPayments: recentPayments.map((p) => ({ id: p.id, userEmail: p.userEmail, planId: p.planId, amountPaise: p.amountPaise, status: p.status, provider: p.provider, createdAt: p.createdAt, refundedPaise: p.refundedPaise })),
        recentUsers: recentUsers.map((r) => ({ id: r.id, email: r.email, name: r.name, createdAt: iso(r.created_at) })),
      };
    },
  };

  // ---- Database monitoring (Admin → System → Database) ----
  // TABLE_ROWS / DATA_LENGTH / INDEX_LENGTH are MySQL's table statistics. For InnoDB they are estimates,
  // so this deliberately reports schema storage as an estimated footprint rather than claiming to measure
  // the MySQL process's RAM. The buffer-pool and server counters below are instance-wide, not per schema.
  const MONITOR_RETENTION_KEY = 'database_monitor_retention_days';
  const MONITOR_RETENTION_DAYS = [1, 3, 7, 14, 30];
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const valueNumber = Number(value);
    return Number.isFinite(valueNumber) && valueNumber >= 0 ? valueNumber : null;
  };
  const wholeOrNull = (value) => {
    const n = numberOrNull(value);
    return n === null ? null : Math.trunc(n);
  };
  const counterDelta = (current, previous) => {
    const now = wholeOrNull(current), before = wholeOrNull(previous);
    // A counter that reset after a MySQL restart starts a new series at its current value.
    return now === null || before === null ? null : now >= before ? now - before : now;
  };
  const pruneMonitorHistory = async (days) => {
    await q('DELETE FROM database_monitor_samples WHERE sampled_at < UTC_TIMESTAMP(3) - INTERVAL ? DAY', [days]);
  };
  const getRetentionDays = async () => {
    const configured = Number(await self.settings.get(MONITOR_RETENTION_KEY, '7'));
    return MONITOR_RETENTION_DAYS.includes(configured) ? configured : 7;
  };

  const monitoring = {
    async retentionDays() { return getRetentionDays(); },
    async setRetentionDays(days) {
      const value = Number(days);
      if (!MONITOR_RETENTION_DAYS.includes(value)) throw new TypeError('Unsupported database-monitor history retention.');
      await self.settings.set(MONITOR_RETENTION_KEY, value);
      await pruneMonitorHistory(value);
      return value;
    },
    /** Save one minute bucket. The primary key makes collection safe across multiple app instances. */
    async record(snapshot) {
      const sampledMs = Date.parse(snapshot?.sampledAt || '');
      if (!Number.isFinite(sampledMs)) throw new TypeError('A valid sampledAt timestamp is required to store a database-monitor sample.');
      const sampledAt = new Date(Math.floor(sampledMs / 60_000) * 60_000);
      const previous = (await q(`SELECT sampled_at, queries_since_restart, slow_queries_since_restart, disk_tmp_tables_since_restart
        FROM database_monitor_samples WHERE sampled_at < ? ORDER BY sampled_at DESC LIMIT 1`, [sampledAt]))[0] || null;
      const instance = snapshot.instance || {};
      const storage = snapshot.storage || {};
      const connections = instance.connections || {};
      const activity = instance.activity || {};
      const pool = instance.bufferPool || {};
      const estimatedRows = Number(storage.rowEstimateTables) > 0 ? wholeOrNull(storage.estimatedRows) : null;
      const intervalSeconds = previous
        ? Math.max(1, Math.round((sampledAt.getTime() - new Date(previous.sampled_at).getTime()) / 1000))
        : 0;
      const values = [
        sampledAt,
        wholeOrNull(storage.totalBytes) ?? 0,
        wholeOrNull(storage.dataBytes) ?? 0,
        wholeOrNull(storage.indexBytes) ?? 0,
        estimatedRows,
        wholeOrNull(storage.tableCount) ?? 0,
        wholeOrNull(pool.capacityBytes),
        wholeOrNull(pool.usedBytes),
        numberOrNull(pool.hitRatePct),
        wholeOrNull(connections.connected),
        wholeOrNull(connections.running),
        wholeOrNull(connections.max),
        wholeOrNull(activity.queriesSinceStart),
        wholeOrNull(activity.slowQueries),
        wholeOrNull(activity.diskTemporaryTables),
        counterDelta(activity.queriesSinceStart, previous?.queries_since_restart),
        counterDelta(activity.slowQueries, previous?.slow_queries_since_restart),
        counterDelta(activity.diskTemporaryTables, previous?.disk_tmp_tables_since_restart),
        intervalSeconds,
      ];
      const result = await q(`INSERT IGNORE INTO database_monitor_samples (
        sampled_at, total_storage_bytes, data_bytes, index_bytes, estimated_rows, table_count,
        buffer_pool_capacity_bytes, buffer_pool_used_bytes, buffer_pool_hit_rate_pct,
        connections_current, connections_running, connections_max,
        queries_since_restart, slow_queries_since_restart, disk_tmp_tables_since_restart,
        queries_delta, slow_queries_delta, disk_tmp_tables_delta, sample_interval_seconds
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, values);
      return Number(result?.affectedRows || 0) === 1;
    },
    /** Return a compact, time-bucketed series suitable for an admin chart (at most about 600 points). */
    async history({ since, bucketSeconds = 60 } = {}) {
      const bucket = Math.max(60, Math.min(2_592_000, Math.ceil(Number(bucketSeconds) / 60) * 60 || 60));
      const rows = await q(`SELECT FLOOR(UNIX_TIMESTAMP(sampled_at) / ?) * ? AS bucket_epoch,
          AVG(total_storage_bytes) AS total_storage_bytes,
          AVG(data_bytes) AS data_bytes,
          AVG(index_bytes) AS index_bytes,
          AVG(estimated_rows) AS estimated_rows,
          AVG(buffer_pool_capacity_bytes) AS buffer_pool_capacity_bytes,
          AVG(buffer_pool_used_bytes) AS buffer_pool_used_bytes,
          AVG(buffer_pool_hit_rate_pct) AS buffer_pool_hit_rate_pct,
          AVG(connections_current) AS connections_current,
          AVG(connections_running) AS connections_running,
          AVG(connections_max) AS connections_max,
          CASE WHEN SUM(CASE WHEN queries_delta IS NOT NULL THEN sample_interval_seconds ELSE 0 END) > 0
            THEN SUM(queries_delta) * 60 / SUM(CASE WHEN queries_delta IS NOT NULL THEN sample_interval_seconds ELSE 0 END) ELSE NULL END AS queries_per_minute,
          CASE WHEN SUM(CASE WHEN slow_queries_delta IS NOT NULL THEN sample_interval_seconds ELSE 0 END) > 0
            THEN SUM(slow_queries_delta) * 60 / SUM(CASE WHEN slow_queries_delta IS NOT NULL THEN sample_interval_seconds ELSE 0 END) ELSE NULL END AS slow_queries_per_minute,
          CASE WHEN SUM(CASE WHEN disk_tmp_tables_delta IS NOT NULL THEN sample_interval_seconds ELSE 0 END) > 0
            THEN SUM(disk_tmp_tables_delta) * 60 / SUM(CASE WHEN disk_tmp_tables_delta IS NOT NULL THEN sample_interval_seconds ELSE 0 END) ELSE NULL END AS disk_tmp_tables_per_minute
        FROM database_monitor_samples
        WHERE sampled_at >= ? AND sampled_at <= UTC_TIMESTAMP(3)
        GROUP BY bucket_epoch ORDER BY bucket_epoch`, [bucket, bucket, since, bucket]);
      const value = (row, key) => numberOrNull(row[key]);
      return rows.map((row) => ({
        at: new Date(Number(row.bucket_epoch) * 1000).toISOString(),
        totalStorageBytes: value(row, 'total_storage_bytes'),
        dataBytes: value(row, 'data_bytes'),
        indexBytes: value(row, 'index_bytes'),
        estimatedRows: value(row, 'estimated_rows'),
        bufferPoolCapacityBytes: value(row, 'buffer_pool_capacity_bytes'),
        bufferPoolUsedBytes: value(row, 'buffer_pool_used_bytes'),
        bufferPoolHitRatePct: value(row, 'buffer_pool_hit_rate_pct'),
        connectionsCurrent: value(row, 'connections_current'),
        connectionsRunning: value(row, 'connections_running'),
        connectionsMax: value(row, 'connections_max'),
        queriesPerMinute: value(row, 'queries_per_minute'),
        slowQueriesPerMinute: value(row, 'slow_queries_per_minute'),
        diskTempTablesPerMinute: value(row, 'disk_tmp_tables_per_minute'),
      }));
    },
    async collect() {
      const snapshot = await this.snapshot();
      const stored = await this.record(snapshot);
      await pruneMonitorHistory(await getRetentionDays());
      return { sampledAt: snapshot.sampledAt, stored };
    },
    async snapshot() {
      const [metaRows, tableRows, statusRows, variableRows] = await Promise.all([
        q('SELECT DATABASE() AS schema_name, VERSION() AS server_version'),
        q(`SELECT TABLE_NAME, ENGINE, TABLE_ROWS, AVG_ROW_LENGTH, DATA_LENGTH, INDEX_LENGTH, AUTO_INCREMENT
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`),
        // SHOW GLOBAL STATUS / VARIABLES are supported by MySQL and MariaDB. Some managed DB users
        // restrict global status; those metrics are optional and should not hide the schema statistics.
        q(`SHOW GLOBAL STATUS WHERE Variable_name IN (
          'Uptime', 'Threads_connected', 'Threads_running', 'Max_used_connections', 'Connections',
          'Queries', 'Slow_queries', 'Created_tmp_tables', 'Created_tmp_disk_tables',
          'Innodb_buffer_pool_pages_data', 'Innodb_buffer_pool_pages_free', 'Innodb_buffer_pool_pages_total',
          'Innodb_buffer_pool_pages_dirty', 'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads'
        )`).catch(() => []),
        q(`SHOW GLOBAL VARIABLES WHERE Variable_name IN (
          'max_connections', 'innodb_buffer_pool_size', 'innodb_page_size'
        )`).catch(() => []),
      ]);
      const metric = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
      };
      const asBytes = (value) => metric(value) ?? 0;
      const nameValueMap = (rows) => new Map(rows.map((r) => [
        String(r.Variable_name ?? r.variable_name ?? '').toLowerCase(), r.Value ?? r.value,
      ]));
      const status = nameValueMap(statusRows), variables = nameValueMap(variableRows);
      const statusMetric = (name) => metric(status.get(name.toLowerCase()));
      const variableMetric = (name) => metric(variables.get(name.toLowerCase()));

      const tables = tableRows.map((r) => {
        const dataBytes = asBytes(r.DATA_LENGTH), indexBytes = asBytes(r.INDEX_LENGTH);
        const rows = metric(r.TABLE_ROWS);
        return {
          name: String(r.TABLE_NAME), engine: r.ENGINE || 'Unknown',
          estimatedRows: rows, dataBytes, indexBytes, totalBytes: dataBytes + indexBytes,
          averageRowBytes: metric(r.AVG_ROW_LENGTH), autoIncrement: metric(r.AUTO_INCREMENT),
        };
      });
      tables.sort((a, b) => b.totalBytes - a.totalBytes || a.name.localeCompare(b.name));
      const dataBytes = tables.reduce((n, table) => n + table.dataBytes, 0);
      const indexBytes = tables.reduce((n, table) => n + table.indexBytes, 0);
      const totalBytes = dataBytes + indexBytes;
      const rowEstimateTables = tables.filter((table) => table.estimatedRows !== null).length;
      const estimatedRows = tables.reduce((n, table) => n + (table.estimatedRows ?? 0), 0);
      for (const table of tables) table.sharePct = totalBytes ? Math.round(table.totalBytes / totalBytes * 10_000) / 100 : 0;

      const pageSize = variableMetric('innodb_page_size') || 16_384;
      const poolPages = statusMetric('Innodb_buffer_pool_pages_total');
      const freePages = statusMetric('Innodb_buffer_pool_pages_free');
      const dataPages = statusMetric('Innodb_buffer_pool_pages_data');
      const dirtyPages = statusMetric('Innodb_buffer_pool_pages_dirty');
      const readRequests = statusMetric('Innodb_buffer_pool_read_requests');
      const diskReads = statusMetric('Innodb_buffer_pool_reads');
      const bufferPoolSize = variableMetric('innodb_buffer_pool_size');
      const bufferPoolCapacity = bufferPoolSize ?? (poolPages === null ? null : poolPages * pageSize);
      const bufferPoolUsed = poolPages !== null && freePages !== null
        ? Math.max(0, poolPages - freePages) * pageSize
        : dataPages === null ? null : dataPages * pageSize;
      const bufferPool = bufferPoolCapacity === null && dataPages === null && poolPages === null ? null : {
        capacityBytes: bufferPoolCapacity,
        usedBytes: bufferPoolUsed,
        freeBytes: freePages === null ? null : freePages * pageSize,
        dataBytes: dataPages === null ? null : dataPages * pageSize,
        dirtyBytes: dirtyPages === null ? null : dirtyPages * pageSize,
        usagePct: bufferPoolCapacity && bufferPoolUsed !== null
          ? Math.round(bufferPoolUsed / bufferPoolCapacity * 10_000) / 100 : null,
        hitRatePct: readRequests > 0 && diskReads !== null
          ? Math.round(Math.max(0, 1 - diskReads / readRequests) * 100_000) / 1_000 : null,
        pageSizeBytes: pageSize,
      };
      const maxConnections = variableMetric('max_connections');
      const connected = statusMetric('Threads_connected');
      return {
        schemaName: metaRows[0]?.schema_name || null,
        serverVersion: metaRows[0]?.server_version || null,
        sampledAt: new Date().toISOString(),
        storage: { tableCount: tables.length, dataBytes, indexBytes, totalBytes, estimatedRows, rowEstimateTables },
        tables,
        instance: {
          statusAvailable: statusRows.length > 0,
          connections: {
            connected, running: statusMetric('Threads_running'),
            peak: statusMetric('Max_used_connections'), max: maxConnections,
            usagePct: maxConnections > 0 && connected !== null ? Math.round(connected / maxConnections * 10_000) / 100 : null,
          },
          activity: {
            uptimeSeconds: statusMetric('Uptime'), connectionsSinceStart: statusMetric('Connections'),
            queriesSinceStart: statusMetric('Queries'), slowQueries: statusMetric('Slow_queries'),
            temporaryTables: statusMetric('Created_tmp_tables'), diskTemporaryTables: statusMetric('Created_tmp_disk_tables'),
          },
          bufferPool,
        },
      };
    },
  };

  // ---- Application monitoring (Admin → System → Application) ----
  const APP_MONITOR_RETENTION_KEY = 'application_monitor_retention_days';
  const APP_MONITOR_RETENTION_DAYS = [1, 3, 7, 14, 30];
  const pruneApplicationHistory = async (days) => {
    await q('DELETE FROM application_monitor_samples WHERE sampled_at < UTC_TIMESTAMP(3) - INTERVAL ? DAY', [days]);
  };
  const getApplicationRetention = async () => {
    const configured = Number(await self.settings.get(APP_MONITOR_RETENTION_KEY, '7'));
    return APP_MONITOR_RETENTION_DAYS.includes(configured) ? configured : 7;
  };
  const applicationMonitoring = {
    async retentionDays() { return getApplicationRetention(); },
    async setRetentionDays(days) {
      const value = Number(days);
      if (!APP_MONITOR_RETENTION_DAYS.includes(value)) throw new TypeError('Unsupported application-monitor history retention.');
      await self.settings.set(APP_MONITOR_RETENTION_KEY, value);
      await pruneApplicationHistory(value);
      return value;
    },
    /** Persist one per-process minute sample; the UUID key prevents app instances from overwriting each other. */
    async record(snapshot) {
      const sampledMs = Date.parse(snapshot?.sampledAt || '');
      if (!Number.isFinite(sampledMs) || typeof snapshot.instanceId !== 'string') {
        throw new TypeError('A valid application-monitor sample is required.');
      }
      const sampledAt = new Date(Math.floor(sampledMs / 60_000) * 60_000);
      const memory = snapshot.memory || {};
      const system = snapshot.system || {};
      const http = snapshot.http || {};
      const result = await q(`INSERT IGNORE INTO application_monitor_samples (
        instance_id, sampled_at, cpu_percent, processor_count,
        memory_rss_bytes, heap_used_bytes, heap_total_bytes, external_bytes, array_buffers_bytes,
        load_1, load_5, load_15, sample_interval_seconds,
        http_request_count, http_client_error_count, http_server_error_count,
        http_latency_count, http_latency_sum_ms, http_latency_p50_ms, http_latency_p95_ms, http_latency_max_ms
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        snapshot.instanceId, sampledAt, numberOrNull(snapshot.cpuPercent), wholeOrNull(snapshot.processors) ?? 1,
        wholeOrNull(memory.rssBytes) ?? 0, wholeOrNull(memory.heapUsedBytes) ?? 0,
        wholeOrNull(memory.heapTotalBytes) ?? 0, wholeOrNull(memory.externalBytes) ?? 0,
        wholeOrNull(memory.arrayBuffersBytes), numberOrNull(system.load1), numberOrNull(system.load5), numberOrNull(system.load15),
        wholeOrNull(snapshot.intervalSeconds) ?? 0, wholeOrNull(http.requests) ?? 0,
        wholeOrNull(http.clientErrors) ?? 0, wholeOrNull(http.serverErrors) ?? 0,
        wholeOrNull(http.requests) ?? 0, numberOrNull(http.latencySumMs) ?? 0,
        numberOrNull(http.p50ResponseMs), numberOrNull(http.p95ResponseMs), numberOrNull(http.maxResponseMs),
      ]);
      await pruneApplicationHistory(await getApplicationRetention());
      return Number(result?.affectedRows || 0) === 1;
    },
    /** Aggregate per-process gauge means, fleet totals, and request-weighted latency into about 600 buckets. */
    async history({ since, bucketSeconds = 60 } = {}) {
      const bucket = Math.max(60, Math.min(2_592_000, Math.ceil(Number(bucketSeconds) / 60) * 60 || 60));
      const rows = await q(`SELECT bucket_epoch,
          AVG(cpu_percent) AS cpu_percent,
          SUM(memory_rss_bytes) AS memory_rss_bytes,
          SUM(heap_used_bytes) AS heap_used_bytes,
          SUM(heap_total_bytes) AS heap_total_bytes,
          AVG(load_1) AS load_1,
          COUNT(*) AS active_instances,
          SUM(request_count) * 60 / ? AS requests_per_minute,
          CASE WHEN SUM(latency_count) > 0 THEN SUM(latency_sum_ms) / SUM(latency_count) ELSE NULL END AS response_average_ms,
          MAX(response_p50_ms) AS response_p50_ms,
          MAX(response_p95_ms) AS response_p95_ms,
          MAX(response_max_ms) AS response_max_ms,
          SUM(client_error_count) * 60 / ? AS client_errors_per_minute,
          SUM(server_error_count) * 60 / ? AS server_errors_per_minute,
          CASE WHEN SUM(request_count) > 0 THEN SUM(server_error_count) * 100 / SUM(request_count) ELSE NULL END AS server_error_rate_pct
        FROM (
          SELECT instance_id, FLOOR(UNIX_TIMESTAMP(sampled_at) / ?) * ? AS bucket_epoch,
            AVG(cpu_percent) AS cpu_percent,
            AVG(memory_rss_bytes) AS memory_rss_bytes,
            AVG(heap_used_bytes) AS heap_used_bytes,
            AVG(heap_total_bytes) AS heap_total_bytes,
            AVG(load_1) AS load_1,
            SUM(http_request_count) AS request_count,
            SUM(http_client_error_count) AS client_error_count,
            SUM(http_server_error_count) AS server_error_count,
            SUM(http_latency_count) AS latency_count,
            SUM(http_latency_sum_ms) AS latency_sum_ms,
            MAX(http_latency_p50_ms) AS response_p50_ms,
            MAX(http_latency_p95_ms) AS response_p95_ms,
            MAX(http_latency_max_ms) AS response_max_ms
          FROM application_monitor_samples
          WHERE sampled_at >= ? AND sampled_at <= UTC_TIMESTAMP(3)
          GROUP BY instance_id, bucket_epoch
        ) AS per_instance
        GROUP BY bucket_epoch ORDER BY bucket_epoch`, [bucket, bucket, bucket, bucket, bucket, since]);
      const value = (row, key) => numberOrNull(row[key]);
      return rows.map((row) => ({
        at: new Date(Number(row.bucket_epoch) * 1000).toISOString(),
        cpuPercent: value(row, 'cpu_percent'),
        memoryRssBytes: value(row, 'memory_rss_bytes'),
        heapUsedBytes: value(row, 'heap_used_bytes'),
        heapTotalBytes: value(row, 'heap_total_bytes'),
        load1: value(row, 'load_1'),
        activeInstances: value(row, 'active_instances'),
        requestsPerMinute: value(row, 'requests_per_minute'),
        responseAverageMs: value(row, 'response_average_ms'),
        responseP50Ms: value(row, 'response_p50_ms'),
        responseP95Ms: value(row, 'response_p95_ms'),
        responseMaxMs: value(row, 'response_max_ms'),
        clientErrorsPerMinute: value(row, 'client_errors_per_minute'),
        serverErrorsPerMinute: value(row, 'server_errors_per_minute'),
        serverErrorRatePct: value(row, 'server_error_rate_pct'),
      }));
    },
  };

  // Merged into the main `db` object by db.js.
  return { catalog, uploads, audit, youtubeImports, adminUsers, messages, stats, monitoring, applicationMonitoring };
}
