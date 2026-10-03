/**
 * Data access for: one-time auth tokens, account security (PIN, session version), ratings, comments, web-push
 * subscriptions, playback sessions, play statistics, refund requests and the error log.
 * Same conventions as db.js: parameterised queries, UTC timestamps returned as ISO strings.
 */
// Each `const x = {...}` below is one group of related queries, exposed as `db.x` (see the return statement at the end).
export function extraDb({ q, tx, iso }) {
  // ---- One-time tokens (password reset, e-mail verification). Only a hash is stored, never the token itself ----
  const authTokens = {
    /** Issues a token hash for `purpose`; earlier unused tokens of that purpose stop working. */
    async issue(userId, purpose, hash, ttlMs) {
      await q('UPDATE auth_tokens SET used_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [userId, purpose]);
      await q('INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?,?,?,?)', [hash, userId, purpose, new Date(Date.now() + ttlMs)]);
    },
    // When the last token of this kind was issued (used for the 60-second re-send cooldown).
    async lastIssuedAt(userId, purpose) { const r = (await q('SELECT MAX(created_at) AS at FROM auth_tokens WHERE user_id = ? AND purpose = ?', [userId, purpose]))[0]; return r?.at ? new Date(r.at) : null; },
    /** Atomically spends a valid token; returns its user id or null. */
    // Marks the token used and only succeeds if it is unused, unexpired and the right purpose, so a link works once.
    async consume(hash, purpose) {
      const res = await q('UPDATE auth_tokens SET used_at = UTC_TIMESTAMP(3) WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP(3)', [hash, purpose]);
      if (res.affectedRows !== 1) return null;
      return (await q('SELECT user_id FROM auth_tokens WHERE token_hash = ?', [hash]))[0]?.user_id || null;
    },
    // Housekeeping: remove long-expired tokens.
    async purge() { await q('DELETE FROM auth_tokens WHERE expires_at < UTC_TIMESTAMP(3) - INTERVAL 7 DAY'); },
  };

  // ---- Account security: password changes, session invalidation, e-mail verification, parental PIN ----
  const accounts = {
    /** New password: every older session token stops working (session_version + 1); a reset link also proves the email is real. */
    async setPassword(userId, passwordHash, { verify = false } = {}) {
      await q(`UPDATE users SET password_hash = ?, session_version = session_version + 1${verify ? ', email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(3))' : ''} WHERE id = ?`, [passwordHash, userId]);
      return (await q('SELECT session_version AS v FROM users WHERE id = ?', [userId]))[0].v;
    },
    // "Sign out everywhere": bump the version so every older token is rejected.
    async bumpSessions(userId) { await q('UPDATE users SET session_version = session_version + 1 WHERE id = ?', [userId]); return (await q('SELECT session_version AS v FROM users WHERE id = ?', [userId]))[0].v; },
    async markVerified(userId) { await q('UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(3)) WHERE id = ?', [userId]); },
    async setPin(userId, hash) { await q('UPDATE users SET parental_pin_hash = ?, pin_failed = 0, pin_locked_until = NULL WHERE id = ?', [hash, userId]); },
    async pin(userId) {
      const r = (await q('SELECT parental_pin_hash, pin_failed, pin_locked_until FROM users WHERE id = ?', [userId]))[0];
      return r ? { hash: r.parental_pin_hash, failed: r.pin_failed, lockedUntil: r.pin_locked_until ? new Date(r.pin_locked_until) : null } : null;
    },
    // Count a wrong PIN and lock further attempts for `lockMs` once `maxFails` is reached.
    async pinFailed(userId, maxFails, lockMs) {
      await q('UPDATE users SET pin_failed = pin_failed + 1 WHERE id = ?', [userId]);
      await q('UPDATE users SET pin_failed = 0, pin_locked_until = ? WHERE id = ? AND pin_failed >= ?', [new Date(Date.now() + lockMs), userId, maxFails]);
    },
    async pinOk(userId) { await q('UPDATE users SET pin_failed = 0, pin_locked_until = NULL WHERE id = ?', [userId]); },
  };

  // ---- Thumbs up/down per profile (value 1 or -1) ----
  const ratings = {
    async set(profileId, type, id, value) { await q('INSERT INTO ratings (profile_id, item_type, item_id, value) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE value = VALUES(value), created_at = UTC_TIMESTAMP(3)', [profileId, type, id, value]); },
    async clear(profileId, type, id) { await q('DELETE FROM ratings WHERE profile_id = ? AND item_type = ? AND item_id = ?', [profileId, type, id]); },
    async mine(profileId) { return Object.fromEntries((await q('SELECT item_type, item_id, value FROM ratings WHERE profile_id = ?', [profileId])).map((r) => [`${r.item_type}:${r.item_id}`, r.value])); },
    async counts(type, id) { const r = (await q('SELECT COALESCE(SUM(value = 1), 0) AS up, COALESCE(SUM(value = -1), 0) AS down FROM ratings WHERE item_type = ? AND item_id = ?', [type, id]))[0]; return { up: Number(r.up), down: Number(r.down) }; },
    /** Ids of the show/videos a profile liked (used for recommendations). */
    async liked(profileId) { return (await q('SELECT item_type, item_id FROM ratings WHERE profile_id = ? AND value = 1', [profileId])).map((r) => ({ type: r.item_type, id: r.item_id })); },
  };

  // ---- Comments on videos, with reporting and moderation ----
  const mapComment = (r) => ({ id: r.id, videoId: r.video_id, userId: r.user_id, author: r.author, body: r.body, status: r.status, reports: r.reports, hiddenReason: r.hidden_reason, createdAt: iso(r.created_at) });
  const comments = {
    async list(videoId, { limit = 30, before = null } = {}) {
      const rows = await q(`SELECT * FROM comments WHERE video_id = ? AND status = 'visible' ${before ? 'AND created_at < ?' : ''} ORDER BY created_at DESC LIMIT ?`, before ? [videoId, new Date(before), limit] : [videoId, limit]);
      return rows.map(mapComment);
    },
    async count(videoId) { return Number((await q("SELECT COUNT(*) AS n FROM comments WHERE video_id = ? AND status = 'visible'", [videoId]))[0].n); },
    async add(c) { await q('INSERT INTO comments (id, video_id, user_id, author, body) VALUES (?,?,?,?,?)', [c.id, c.videoId, c.userId, c.author, c.body]); },
    // How many comments this user posted in the last N seconds (spam limit).
    async recentBy(userId, seconds) { return Number((await q('SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL ? SECOND', [userId, seconds]))[0].n); },
    async byId(id) { const r = (await q('SELECT * FROM comments WHERE id = ?', [id]))[0]; return r ? mapComment(r) : null; },
    async remove(id) { return (await q('DELETE FROM comments WHERE id = ?', [id])).affectedRows === 1; },
    /** One report per user. At `autoHideAt` reports the comment is hidden until an admin reviews it. Returns { reported, hidden }. */
    async report(id, userId, autoHideAt) {
      const ins = await q('INSERT IGNORE INTO comment_reports (comment_id, user_id) VALUES (?,?)', [id, userId]);
      if (!ins.affectedRows) return { reported: false, hidden: false };
      await q('UPDATE comments SET reports = reports + 1 WHERE id = ?', [id]);
      const hid = await q("UPDATE comments SET status = 'hidden', hidden_reason = 'reports' WHERE id = ? AND status = 'visible' AND reports >= ?", [id, autoHideAt]);
      return { reported: true, hidden: hid.affectedRows === 1 };
    },
    // Moderation: show/hide a comment; making it visible again clears its reports.
    async setStatus(id, status, reason = null) {
      const res = await q('UPDATE comments SET status = ?, hidden_reason = ?, reports = IF(? = \'visible\', 0, reports) WHERE id = ?', [status, status === 'hidden' ? reason || 'admin' : null, status, id]);
      if (status === 'visible') await q('DELETE FROM comment_reports WHERE comment_id = ?', [id]);
      return res.affectedRows === 1;
    },
    /** Admin queue: `review` = reported or hidden, newest first. */
    async adminList({ filter = 'review', q: text = '', limit = 50, offset = 0 } = {}) {
      const where = [], params = [];
      if (filter === 'review') where.push("(status = 'hidden' OR reports > 0)"); else if (filter === 'hidden') where.push("status = 'hidden'");
      if (text) { where.push('(body LIKE ? OR author LIKE ?)'); params.push(`%${text}%`, `%${text}%`); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows, [{ n }]] = await Promise.all([q(`SELECT c.*, u.email FROM comments c JOIN users u ON u.id = c.user_id ${w.replace(/\b(status|reports|body|author)\b/g, 'c.$1')} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]), q(`SELECT COUNT(*) AS n FROM comments ${w}`, params)]);
      return { total: Number(n), items: rows.map((r) => ({ ...mapComment(r), email: r.email })) };
    },
    async reviewCount() { return Number((await q("SELECT COUNT(*) AS n FROM comments WHERE status = 'hidden' AND hidden_reason = 'reports'"))[0].n); },
  };

  // ---- Web-push subscriptions (one row per browser) and send-once bookkeeping ----
  const push = {
    async upsert(userId, { endpoint, hash, p256dh, auth }, prefs = {}) {
      await q(`INSERT INTO push_subscriptions (id, user_id, endpoint_hash, endpoint, p256dh, auth, episodes, launches, news) VALUES (UUID(),?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint), p256dh = VALUES(p256dh), auth = VALUES(auth), fail_count = 0`,
      [userId, hash, endpoint, p256dh, auth, prefs.episodes === false ? 0 : 1, prefs.launches === false ? 0 : 1, prefs.news ? 1 : 0]);
    },
    async setPrefs(userId, hash, prefs) {
      const sets = [], vals = [];
      for (const k of ['episodes', 'launches', 'news']) if (prefs[k] !== undefined) { sets.push(`${k} = ?`); vals.push(prefs[k] ? 1 : 0); }
      if (sets.length) await q(`UPDATE push_subscriptions SET ${sets.join(', ')} WHERE user_id = ? AND endpoint_hash = ?`, [...vals, userId, hash]);
    },
    async get(userId, hash) { const r = (await q('SELECT episodes, launches, news FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?', [userId, hash]))[0]; return r ? { episodes: !!r.episodes, launches: !!r.launches, news: !!r.news } : null; },
    async remove(userId, hash) { await q('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?', [userId, hash]); },
    async pruneSent() { await q('DELETE FROM notify_sent WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 30 DAY'); },
    async removeId(id) { await q('DELETE FROM push_subscriptions WHERE id = ?', [id]); },
    async ok(id) { await q('UPDATE push_subscriptions SET last_ok_at = UTC_TIMESTAMP(3), fail_count = 0 WHERE id = ?', [id]); },
    async failed(id) { await q('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?', [id]); await q('DELETE FROM push_subscriptions WHERE id = ? AND fail_count >= 5', [id]); },
    async count() { return Number((await q('SELECT COUNT(*) AS n FROM push_subscriptions'))[0].n); },
    /** Subscriptions to notify. audience: { kind: 'episodes', showId, videoIds } | { kind: 'launches', upcomingId } | { kind: 'news' } | { kind: 'all' } | { kind: 'user', userId } */
    // Works out who should get a notification: followers of a show, people waiting for a launch, everyone opted in to news, or one user.
    async audience(a) {
      const cols = 'ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth';
      let rows;
      if (a.kind === 'episodes') {
        const vids = a.videoIds?.length ? a.videoIds : ['\u0000'];
        rows = await q(`SELECT ${cols} FROM push_subscriptions ps WHERE ps.episodes = 1 AND ps.user_id IN (
          SELECT p.user_id FROM profiles p JOIN list_items l ON l.profile_id = p.id AND l.item_type = 'show' AND l.item_id = ?
          UNION SELECT p.user_id FROM profiles p JOIN watch_progress w ON w.profile_id = p.id AND w.video_id IN (?))`, [a.showId, vids]);
      } else if (a.kind === 'launches') {
        rows = await q(`SELECT ${cols} FROM push_subscriptions ps WHERE ps.launches = 1 AND ps.user_id IN (SELECT p.user_id FROM profiles p JOIN reminders r ON r.profile_id = p.id AND r.upcoming_id = ?)`, [a.upcomingId]);
      } else if (a.kind === 'news') rows = await q(`SELECT ${cols} FROM push_subscriptions ps WHERE ps.news = 1`);
      else if (a.kind === 'user') rows = await q(`SELECT ${cols} FROM push_subscriptions ps WHERE ps.user_id = ?`, [a.userId]);
      else rows = await q(`SELECT ${cols} FROM push_subscriptions ps`);
      return rows.map((r) => ({ id: r.id, userId: r.user_id, endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
    },
    /** True the first time (kind, ref, user) is claimed — makes automatic notifications send-once. */
    async claim(kind, ref, userId) { return (await q('INSERT IGNORE INTO notify_sent (kind, ref, user_id) VALUES (?,?,?)', [kind, ref, userId])).affectedRows === 1; },
  };

  // ---- Native app push devices (FCM tokens; the Capacitor apps POST these to /api/v1/devices) ----
  const devices = {
    /**
     * Registers (or refreshes) a token for a user; the same token on another account moves to it.
     * A re-registration that only carries the token (the apps usually just send that) keeps the stored
     * platform and label instead of wiping them.
     */
    async upsert(userId, { hash, token, platform = null, label = null }) {
      const plat = ['android', 'ios', 'web'].includes(platform) ? platform : null;
      const lab = label ? String(label).slice(0, 120) : null;
      await q(`INSERT INTO push_devices (id, user_id, platform, token_hash, token, label) VALUES (UUID(),?,COALESCE(?,'android'),?,?,?)
        ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), token = VALUES(token), platform = COALESCE(?, platform), label = COALESCE(?, label), fail_count = 0, last_seen = UTC_TIMESTAMP(3)`,
      [userId, plat, hash, String(token).slice(0, 512), lab, plat, lab]);
    },
    /** Stores a guest app token with no account association; the same device moves to a user on sign-in. */
    async upsertGuest({ hash, token, platform = null, label = null }) {
      const plat = ['android', 'ios', 'web'].includes(platform) ? platform : null;
      const lab = label ? String(label).slice(0, 120) : null;
      await q(`INSERT INTO push_devices (id, user_id, platform, token_hash, token, label) VALUES (UUID(),NULL,COALESCE(?,'android'),?,?,?)
        ON DUPLICATE KEY UPDATE user_id = NULL, token = VALUES(token), platform = COALESCE(?, platform), label = COALESCE(?, label), fail_count = 0, last_seen = UTC_TIMESTAMP(3)`,
      [plat, hash, String(token).slice(0, 512), lab, plat, lab]);
    },
    /** Removes one token (sign-out, permission revoked, or account opt-out). */
    async remove(userId, hash) { return (await q('DELETE FROM push_devices WHERE user_id = ? AND token_hash = ?', [userId, hash])).affectedRows; },
    /** Removes a token by hash (FCM dead-token cleanup and public guest opt-out / stale-link cleanup). */
    async removeHash(hash) { await q('DELETE FROM push_devices WHERE token_hash = ?', [hash]); },
    async listFor(userId) { return (await q('SELECT platform, label, last_seen FROM push_devices WHERE user_id = ? ORDER BY last_seen DESC', [userId])).map((r) => ({ platform: r.platform, label: r.label, lastSeen: iso(r.last_seen) })); },
    async count() { return Number((await q('SELECT COUNT(*) AS n FROM push_devices'))[0].n); },
    /** Every registered token, for a broadcast. */
    async audience() { return (await q('SELECT token FROM push_devices')).map((r) => r.token); },
    /** The tokens (+ owner) of the people a targeted audience reaches (same audience shapes as db.push.audience). */
    async audienceFor(a) {
      const sel = 'SELECT pd.token, pd.user_id FROM push_devices pd';
      let rows;
      if (a.kind === 'episodes') {
        const vids = a.videoIds?.length ? a.videoIds : ['\u0000'];
        rows = await q(`${sel} WHERE pd.user_id IN (
          SELECT p.user_id FROM profiles p JOIN list_items l ON l.profile_id = p.id AND l.item_type = 'show' AND l.item_id = ?
          UNION SELECT p.user_id FROM profiles p JOIN watch_progress w ON w.profile_id = p.id AND w.video_id IN (?))`, [a.showId, vids]);
      } else if (a.kind === 'launches') rows = await q(`${sel} WHERE pd.user_id IN (SELECT p.user_id FROM profiles p JOIN reminders r ON r.profile_id = p.id AND r.upcoming_id = ?)`, [a.upcomingId]);
      else if (a.kind === 'user') rows = await q(`${sel} WHERE pd.user_id = ?`, [a.userId]);
      else rows = await q(sel);
      return rows.map((r) => ({ token: r.token, userId: r.user_id }));
    },
    async ok(hash) { await q('UPDATE push_devices SET last_seen = UTC_TIMESTAMP(3), fail_count = 0 WHERE token_hash = ?', [hash]); },
    /** A failed (but not dead) send; tokens failing 5 times in a row are dropped by purge(). */
    async failed(hash) { await q('UPDATE push_devices SET fail_count = fail_count + 1 WHERE token_hash = ?', [hash]); },
    async purge() { await q('DELETE FROM push_devices WHERE fail_count >= 5 OR last_seen < UTC_TIMESTAMP(3) - INTERVAL 180 DAY'); },
  };

  // ---- Broadcast campaigns (Admin → Notifications: push and e-mail blasts with live progress) ----

  // ---- Which devices are streaming right now (enforces the simultaneous-stream limit) ----
  const playback = {
    /** Registers/refreshes this device. Refuses (ok:false) when `limit` OTHER devices were active within `windowSec`. */
    async touch(userId, deviceId, label, videoId, { limit, windowSec }) {
      return tx(async (t) => {
        await t.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
        const others = await t.query('SELECT device_id, device_label, video_id FROM playback_sessions WHERE user_id = ? AND device_id <> ? AND last_seen > UTC_TIMESTAMP(3) - INTERVAL ? SECOND AND video_id IS NOT NULL', [userId, deviceId, windowSec]);
        if (others.length >= limit) return { ok: false, active: others.map((o) => ({ deviceId: o.device_id, label: o.device_label })) };
        await t.query(`INSERT INTO playback_sessions (user_id, device_id, device_label, video_id) VALUES (?,?,?,?)
          ON DUPLICATE KEY UPDATE device_label = VALUES(device_label), video_id = VALUES(video_id), last_seen = UTC_TIMESTAMP(3)`, [userId, deviceId, label, videoId]);
        return { ok: true, active: others.map((o) => ({ deviceId: o.device_id, label: o.device_label })) };
      });
    },
    // Playback stopped: keep the device row but clear the video.
    async stop(userId, deviceId) { await q('UPDATE playback_sessions SET video_id = NULL WHERE user_id = ? AND device_id = ?', [userId, deviceId]); },
    async devices(userId, windowSec) {
      return (await q('SELECT device_id, device_label, video_id, started_at, last_seen, (video_id IS NOT NULL AND last_seen > UTC_TIMESTAMP(3) - INTERVAL ? SECOND) AS watching FROM playback_sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT 20', [windowSec, userId]))
        .map((r) => ({ deviceId: r.device_id, label: r.device_label, watching: !!r.watching, videoId: r.watching ? r.video_id : null, lastSeen: iso(r.last_seen) }));
    },
    async forget(userId, deviceId) { await q('DELETE FROM playback_sessions WHERE user_id = ? AND device_id = ?', [userId, deviceId]); },
    async purge() { await q('DELETE FROM playback_sessions WHERE last_seen < UTC_TIMESTAMP(3) - INTERVAL 90 DAY'); },
  };

  // ---- Daily play counts and watch time for the admin analytics page ----
  const playStats = {
    async record(videoId, showId, { play = false, seconds = 0 }) {
      await q('INSERT INTO play_stats (day, video_id, show_id, plays, seconds) VALUES (UTC_DATE(),?,?,?,?) ON DUPLICATE KEY UPDATE plays = plays + VALUES(plays), seconds = seconds + VALUES(seconds)', [videoId, showId || null, play ? 1 : 0, Math.max(0, Math.floor(seconds))]);
    },
    async overview(days = 30) {
      const [daily, byShow, byVideo, [tot]] = await Promise.all([
        q('SELECT day, SUM(plays) AS plays, SUM(seconds) AS seconds FROM play_stats WHERE day >= UTC_DATE() - INTERVAL ? DAY GROUP BY day ORDER BY day', [days - 1]),
        q('SELECT show_id, SUM(plays) AS plays, SUM(seconds) AS seconds FROM play_stats WHERE day >= UTC_DATE() - INTERVAL ? DAY GROUP BY show_id ORDER BY seconds DESC LIMIT 10', [days - 1]),
        q('SELECT video_id, show_id, SUM(plays) AS plays, SUM(seconds) AS seconds FROM play_stats WHERE day >= UTC_DATE() - INTERVAL ? DAY GROUP BY video_id, show_id ORDER BY plays DESC, seconds DESC LIMIT 15', [days - 1]),
        q('SELECT COALESCE(SUM(plays), 0) AS plays, COALESCE(SUM(seconds), 0) AS seconds FROM play_stats WHERE day >= UTC_DATE() - INTERVAL ? DAY', [days - 1]),
      ]);
      return {
        days,
        totals: { plays: Number(tot.plays), seconds: Number(tot.seconds) },
        daily: daily.map((r) => ({ date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10), plays: Number(r.plays), seconds: Number(r.seconds) })),
        shows: byShow.map((r) => ({ showId: r.show_id, plays: Number(r.plays), seconds: Number(r.seconds) })),
        videos: byVideo.map((r) => ({ videoId: r.video_id, showId: r.show_id, plays: Number(r.plays), seconds: Number(r.seconds) })),
      };
    },
  };

  // ---- Viewer refund requests, decided by an admin ----
  const mapReq = (r) => ({ id: r.id, paymentId: r.payment_id, userId: r.user_id, email: r.email, reason: r.reason, status: r.status, adminNote: r.admin_note, decidedBy: r.decided_by, createdAt: iso(r.created_at), decidedAt: iso(r.decided_at) });
  const refundRequests = {
    async create({ id, paymentId, userId, reason }) { await q('INSERT INTO refund_requests (id, payment_id, user_id, reason) VALUES (?,?,?,?)', [id, paymentId, userId, reason]); },
    async pendingFor(paymentId) { const r = (await q("SELECT * FROM refund_requests WHERE payment_id = ? AND status = 'pending' LIMIT 1", [paymentId]))[0]; return r ? mapReq(r) : null; },
    async forUser(userId) { return (await q('SELECT * FROM refund_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId])).map(mapReq); },
    async get(id) { const r = (await q('SELECT r.*, u.email FROM refund_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?', [id]))[0]; return r ? mapReq(r) : null; },
    async list({ status = 'pending', limit = 50, offset = 0 } = {}) {
      const w = status === 'all' ? '' : 'WHERE r.status = ?', p = status === 'all' ? [] : [status];
      const [rows, [{ n }]] = await Promise.all([q(`SELECT r.*, u.email FROM refund_requests r JOIN users u ON u.id = r.user_id ${w} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [...p, limit, offset]), q(`SELECT COUNT(*) AS n FROM refund_requests r ${w}`, p)]);
      return { total: Number(n), items: rows.map(mapReq) };
    },
    /** Only a pending request can be decided (returns false if someone else already did). */
    async decide(id, status, by, note) { return (await q("UPDATE refund_requests SET status = ?, decided_by = ?, admin_note = ?, decided_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'pending'", [status, by, note || null, id])).affectedRows === 1; },
    async reopen(id) { await q("UPDATE refund_requests SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ?", [id]); },
    async pendingCount() { return Number((await q("SELECT COUNT(*) AS n FROM refund_requests WHERE status = 'pending'"))[0].n); },
  };

  // ---- Client/server error reports shown in the admin "Errors" page ----
  const errors = {
    async add(e) {
      await q('INSERT INTO error_log (source, message, stack, url, user_agent, user_id) VALUES (?,?,?,?,?,?)', [e.source, String(e.message || '').slice(0, 500), e.stack ? String(e.stack).slice(0, 4000) : null, String(e.url || '').slice(0, 300), String(e.userAgent || '').slice(0, 200), e.userId || null]);
    },
    async list({ limit = 100 } = {}) {
      const [groups, recent] = await Promise.all([
        q('SELECT source, message, COUNT(*) AS n, MAX(created_at) AS last_at, MIN(created_at) AS first_at, MAX(url) AS url FROM error_log WHERE created_at > UTC_TIMESTAMP(3) - INTERVAL 7 DAY GROUP BY source, message ORDER BY last_at DESC LIMIT ?', [limit]),
        q('SELECT id, source, message, stack, url, user_agent, created_at FROM error_log ORDER BY id DESC LIMIT 20'),
      ]);
      return { groups: groups.map((r) => ({ source: r.source, message: r.message, count: Number(r.n), lastAt: iso(r.last_at), firstAt: iso(r.first_at), url: r.url })), recent: recent.map((r) => ({ id: r.id, source: r.source, message: r.message, stack: r.stack, url: r.url, userAgent: r.user_agent, at: iso(r.created_at) })) };
    },
    async clear() { await q('DELETE FROM error_log'); },
    async prune() { await q('DELETE FROM error_log WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 30 DAY'); },
    async count24h() { return Number((await q('SELECT COUNT(*) AS n FROM error_log WHERE created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY'))[0].n); },
  };

  // Everything above becomes a property of the main `db` object.

  // ---- Broadcast campaigns: one row per admin broadcast, updated as it sends ----
  const mapCampaign = (r) => ({
    id: r.id, channel: r.channel, audience: r.audience, title: r.title, body: r.body, url: r.url, button: r.button,
    status: r.status, total: Number(r.total), sent: Number(r.sent), failed: Number(r.failed), skipped: Number(r.skipped),
    cursor: Number(r.page_cursor), test: !!r.is_test, error: r.error, by: r.created_by,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), finishedAt: iso(r.finished_at),
  });
  const campaigns = {
    async create(c) {
      await q(`INSERT INTO campaigns (id, channel, audience, title, body, url, button, status, is_test, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [c.id, c.channel, String(c.audience).slice(0, 120), String(c.title).slice(0, 200), String(c.body).slice(0, 20_000), c.url || null, c.button || null, c.status || 'queued', c.test ? 1 : 0, c.by || null]);
    },
    async get(id) { const r = (await q('SELECT * FROM campaigns WHERE id = ?', [id]))[0]; return r ? mapCampaign(r) : null; },
    // Progress updates while a campaign sends (called after every batch).
    async progress(id, { sent, failed, skipped, total, cursor }) {
      await q(`UPDATE campaigns SET sent = sent + ?, failed = failed + ?, skipped = skipped + ?, total = GREATEST(total, ?), page_cursor = ?, status = 'sending', updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [Number(sent) || 0, Number(failed) || 0, Number(skipped) || 0, Number(total) || 0, Number(cursor) || 0, id]);
    },
    async finish(id, status, error = null) {
      await q('UPDATE campaigns SET status = ?, error = ?, updated_at = UTC_TIMESTAMP(3), finished_at = UTC_TIMESTAMP(3) WHERE id = ?', [status, error ? String(error).slice(0, 300) : null, id]);
    },
    async list({ limit = 25 } = {}) { return (await q('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT ?', [limit])).map(mapCampaign); },
    /**
     * Campaigns left unfinished (a deploy or crash mid-send). Only rows that have not moved for five
     * minutes are returned, so a campaign another instance is actively sending is never picked up twice.
     */
    async unfinished() { return (await q("SELECT * FROM campaigns WHERE status IN ('queued','sending') AND is_test = 0 AND updated_at < UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE ORDER BY created_at LIMIT 5")).map(mapCampaign); },
    async prune() { await q("DELETE FROM campaigns WHERE finished_at IS NOT NULL AND finished_at < UTC_TIMESTAMP(3) - INTERVAL 365 DAY"); },
  };

  return { authTokens, accounts, ratings, comments, push, devices, campaigns, playback, playStats, refundRequests, errors };
}
