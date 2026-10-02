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
    /* ---- Broadcast e-mail audiences (Admin → Notifications → Email) ----
     * Same filters as the Users page (`filter` is one of USER_FILTERS). Disabled accounts are never
     * mailed, and neither is anyone who clicked the unsubscribe link in an earlier campaign. */
    async emailAudienceCount(filter = 'all') {
      const f = USER_FILTERS[filter] ? filter : 'all';
      const [{ n }] = await q(`SELECT COUNT(*) AS n FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE (${USER_FILTERS[f]}) AND u.disabled_at IS NULL AND u.email_opt_out_at IS NULL`);
      return Number(n);
    },
    async emailAudience(filter = 'all', { limit = 200, offset = 0 } = {}) {
      const f = USER_FILTERS[filter] ? filter : 'all';
      return (await q(`SELECT u.id, u.email, u.name FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
        WHERE (${USER_FILTERS[f]}) AND u.disabled_at IS NULL AND u.email_opt_out_at IS NULL
        ORDER BY u.created_at, u.id LIMIT ? OFFSET ?`, [limit, offset])).map((r) => ({ id: r.id, email: r.email, name: r.name }));
    },
    async emailOptOutCount() { return Number((await q('SELECT COUNT(*) AS n FROM users WHERE email_opt_out_at IS NOT NULL'))[0].n); },
    async setEmailOptOut(userId, on = true) { return (await q('UPDATE users SET email_opt_out_at = ? WHERE id = ?', [on ? new Date() : null, userId])).affectedRows === 1; },
    async emailOptOut(userId) { const r = (await q('SELECT email_opt_out_at FROM users WHERE id = ?', [userId]))[0]; return !!(r && r.email_opt_out_at); },
    // Used by the `npm run admin` command line to grant/revoke admin rights.
    async setAdminByEmail(email, isAdmin) { return (await q('UPDATE users SET is_admin = ? WHERE email = ?', [isAdmin ? 1 : 0, email])).affectedRows === 1; },
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

  // Merged into the main `db` object by db.js.
  return { catalog, uploads, audit, youtubeImports, adminUsers, messages, stats };
}
