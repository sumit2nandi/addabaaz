/**
 * Data access for: one-time auth tokens, account security (PIN, session version), ratings, web-push
 * subscriptions, playback sessions, play statistics, refund requests and the error log.
 * Same conventions as db.js: parameterised queries, UTC timestamps returned as ISO strings.
 */
// Each `const x = {...}` below is one group of related queries, exposed as `db.x` (see the return statement at the end).
import crypto from 'node:crypto';
import { phoneLinkDb } from './db-phone-link.js';

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

  // ---- Verified contact e-mail for phone-verified accounts; the address is promoted only after the token is redeemed ----
  const emailChanges = {
    /** Issues a one-hour confirmation link, invalidating an earlier pending request for this account. */
    async issue(userId, { email, emailNorm, tokenHash, ttlMs }) {
      return tx(async (t) => {
        // The conditional update both serializes concurrent requests and preserves the one-minute cooldown after a token is redeemed.
        const gate = await t.query('UPDATE users SET email_change_requested_at = UTC_TIMESTAMP(3) WHERE id = ? AND (email_change_requested_at IS NULL OR email_change_requested_at <= UTC_TIMESTAMP(3) - INTERVAL 60 SECOND)', [userId]);
        if (gate.affectedRows !== 1) return false;
        await t.query('DELETE FROM email_change_tokens WHERE user_id = ?', [userId]);
        await t.query('INSERT INTO email_change_tokens (token_hash, user_id, email, email_norm, expires_at) VALUES (?,?,?,?,?)',
          [tokenHash, userId, email, emailNorm, new Date(Date.now() + ttlMs)]);
        return true;
      });
    },
    /** Cooldown timestamp used to avoid sending multiple verification messages per minute. */
    async lastIssuedAt(userId) { const r = (await q('SELECT email_change_requested_at AS at FROM users WHERE id = ?', [userId]))[0]; return r?.at ? new Date(r.at) : null; },
    /** If mail delivery fails, remove the unusable request and release its cooldown if it is still the latest one. */
    async revoke(userId, tokenHash) {
      await tx(async (t) => {
        await t.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
        const removed = await t.query('DELETE FROM email_change_tokens WHERE user_id = ? AND token_hash = ?', [userId, tokenHash]);
        if (removed.affectedRows !== 1) return;
        const previous = (await t.query('SELECT MAX(created_at) AS at FROM email_change_tokens WHERE user_id = ?', [userId]))[0]?.at || null;
        await t.query('UPDATE users SET email_change_requested_at = ? WHERE id = ?', [previous, userId]);
      });
    },
    /** Atomically consume a valid link and promote its address; duplicate addresses roll back and remain retryable. */
    async confirm(tokenHash) {
      return tx(async (t) => {
        // Use the same lock order as issue(): user row first, then pending token, avoiding a resend/confirm deadlock.
        const hint = (await t.query('SELECT user_id FROM email_change_tokens WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)', [tokenHash]))[0];
        if (!hint || !(await t.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [hint.user_id]))[0]) return null;
        const row = (await t.query('SELECT user_id, email, email_norm FROM email_change_tokens WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE', [tokenHash]))[0];
        if (!row) return null;
        const updated = await t.query('UPDATE users SET email = ?, email_norm = ?, email_verified_at = UTC_TIMESTAMP(3) WHERE id = ? AND disabled_at IS NULL AND (phone_verified_at IS NOT NULL OR email_verified_at IS NOT NULL)',
          [row.email, row.email_norm, row.user_id]);
        // Once redeemed (or no longer applicable), remove the pending address and hash in this same transaction.
        await t.query('DELETE FROM email_change_tokens WHERE token_hash = ?', [tokenHash]);
        return updated.affectedRows === 1 ? { userId: row.user_id, email: row.email } : null;
      });
    },
    /** Purge expired pending addresses and the request timestamp after a short cleanup grace period. */
    async purge() {
      await q('DELETE FROM email_change_tokens WHERE expires_at < UTC_TIMESTAMP(3) - INTERVAL 1 DAY');
      await q('UPDATE users SET email_change_requested_at = NULL WHERE email_change_requested_at < UTC_TIMESTAMP(3) - INTERVAL 1 DAY');
    },
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

  // ---- Web-push subscriptions (one row per browser) and send-once bookkeeping ----
  const push = {
    async upsert(userId, { endpoint, hash, p256dh, auth }, prefs = {}) {
      await q(`INSERT INTO push_subscriptions (id, user_id, endpoint_hash, endpoint, p256dh, auth, episodes, launches, news) VALUES (UUID(),?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint), p256dh = VALUES(p256dh), auth = VALUES(auth), fail_count = 0`,
      [userId, hash, endpoint, p256dh, auth, prefs.episodes === false ? 0 : 1, prefs.launches === false ? 0 : 1, prefs.news === false ? 0 : 1]);
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
      const cols = 'ps.id, ps.user_id, u.name, u.email, ps.endpoint, ps.p256dh, ps.auth';
      let rows;
      if (a.kind === 'episodes') {
        const vids = a.videoIds?.length ? a.videoIds : ['\u0000'];
        rows = await q(`SELECT ${cols} FROM push_subscriptions ps LEFT JOIN users u ON u.id = ps.user_id WHERE ps.episodes = 1 AND ps.user_id IN (
          SELECT p.user_id FROM profiles p JOIN list_items l ON l.profile_id = p.id AND l.item_type = 'show' AND l.item_id = ?
          UNION SELECT p.user_id FROM profiles p JOIN watch_progress w ON w.profile_id = p.id AND w.video_id IN (?))`, [a.showId, vids]);
      } else if (a.kind === 'launches') {
        rows = await q(`SELECT ${cols} FROM push_subscriptions ps LEFT JOIN users u ON u.id = ps.user_id WHERE ps.launches = 1 AND ps.user_id IN (SELECT p.user_id FROM profiles p JOIN reminders r ON r.profile_id = p.id AND r.upcoming_id = ?)`, [a.upcomingId]);
      } else if (a.kind === 'news') rows = await q(`SELECT ${cols} FROM push_subscriptions ps LEFT JOIN users u ON u.id = ps.user_id WHERE ps.news = 1`);
      else if (a.kind === 'user') rows = await q(`SELECT ${cols} FROM push_subscriptions ps LEFT JOIN users u ON u.id = ps.user_id WHERE ps.user_id = ?`, [a.userId]);
      else rows = await q(`SELECT ${cols} FROM push_subscriptions ps LEFT JOIN users u ON u.id = ps.user_id`);
      return rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name || null, email: r.email || null, endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
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
    async upsert(userId, { hash, token, platform = null, label = null, prefs = null }) {
      const plat = ['android', 'ios', 'web'].includes(platform) ? platform : null;
      const lab = label ? String(label).slice(0, 120) : null;
      // On a re-registration the stored choices are kept: the apps send the token on every start, and those
      // columns are the viewer's settings, not part of the registration. A registration that carries no
      // choices at all starts from the defaults — all three kinds on (migration 020).
      await q(`INSERT INTO push_devices (id, user_id, platform, token_hash, token, label, episodes, launches, news) VALUES (UUID(),?,COALESCE(?,'android'),?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), token = VALUES(token), platform = COALESCE(?, platform), label = COALESCE(?, label), fail_count = 0, last_seen = UTC_TIMESTAMP(3)`,
      [userId, plat, hash, String(token).slice(0, 512), lab,
        prefs?.episodes === false ? 0 : 1, prefs?.launches === false ? 0 : 1, prefs?.news === false ? 0 : 1,
        plat, lab]);
    },
    /** Stores a guest app token with no account association; the same device moves to a user on sign-in. */
    async upsertGuest({ hash, token, platform = null, label = null, prefs = null }) {
      const plat = ['android', 'ios', 'web'].includes(platform) ? platform : null;
      const lab = label ? String(label).slice(0, 120) : null;
      await q(`INSERT INTO push_devices (id, user_id, platform, token_hash, token, label, episodes, launches, news) VALUES (UUID(),NULL,COALESCE(?,'android'),?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE user_id = NULL, token = VALUES(token), platform = COALESCE(?, platform), label = COALESCE(?, label), fail_count = 0, last_seen = UTC_TIMESTAMP(3)`,
      [plat, hash, String(token).slice(0, 512), lab,
        prefs?.episodes === false ? 0 : 1, prefs?.launches === false ? 0 : 1, prefs?.news === false ? 0 : 1,
        plat, lab]);
    },
    /** Removes one token (sign-out, permission revoked, or account opt-out). */
    async remove(userId, hash) { return (await q('DELETE FROM push_devices WHERE user_id = ? AND token_hash = ?', [userId, hash])).affectedRows; },
    /** Removes a token by hash (FCM dead-token cleanup and public guest opt-out / stale-link cleanup). */
    async removeHash(hash) { await q('DELETE FROM push_devices WHERE token_hash = ?', [hash]); },
    async listFor(userId) { return (await q('SELECT platform, label, last_seen FROM push_devices WHERE user_id = ? ORDER BY last_seen DESC', [userId])).map((r) => ({ platform: r.platform, label: r.label, lastSeen: iso(r.last_seen) })); },
    /** The three notification choices stored for one device token (by hash), or null when the token is unknown. */
    async getPrefs(hash) { const r = (await q('SELECT episodes, launches, news FROM push_devices WHERE token_hash = ?', [hash]))[0]; return r ? { episodes: !!r.episodes, launches: !!r.launches, news: !!r.news } : null; },
    /** Updates only the choices the client sent. Works for an account device or a guest device (token possession). */
    async setPrefs(hash, prefs) {
      const sets = [], vals = [];
      for (const k of ['episodes', 'launches', 'news']) if (prefs[k] !== undefined) { sets.push(`${k} = ?`); vals.push(prefs[k] ? 1 : 0); }
      if (!sets.length) return 0;
      return (await q(`UPDATE push_devices SET ${sets.join(', ')}, last_seen = UTC_TIMESTAMP(3) WHERE token_hash = ?`, [...vals, hash])).affectedRows;
    },
    async count() { return Number((await q('SELECT COUNT(*) AS n FROM push_devices'))[0].n); },
    /** Every registered token, for a broadcast. */
    async audience() { return (await q('SELECT token FROM push_devices')).map((r) => r.token); },
    /** The tokens (+ owner) of the people a targeted audience reaches (same audience shapes as db.push.audience). */
    async audienceFor(a) {
      const sel = 'SELECT pd.token, pd.token_hash, pd.user_id, pd.platform, pd.label, u.name, u.email FROM push_devices pd LEFT JOIN users u ON u.id = pd.user_id';
      let rows;
      // The same three switches as the browser, applied to the same audiences: a device that turned, say,
      // episode notifications off is skipped for a show's new-episode send but still gets a launch.
      if (a.kind === 'episodes') {
        const vids = a.videoIds?.length ? a.videoIds : ['\u0000'];
        rows = await q(`${sel} WHERE pd.episodes = 1 AND pd.user_id IN (
          SELECT p.user_id FROM profiles p JOIN list_items l ON l.profile_id = p.id AND l.item_type = 'show' AND l.item_id = ?
          UNION SELECT p.user_id FROM profiles p JOIN watch_progress w ON w.profile_id = p.id AND w.video_id IN (?))`, [a.showId, vids]);
      } else if (a.kind === 'launches') rows = await q(`${sel} WHERE pd.launches = 1 AND pd.user_id IN (SELECT p.user_id FROM profiles p JOIN reminders r ON r.profile_id = p.id AND r.upcoming_id = ?)`, [a.upcomingId]);
      else if (a.kind === 'news') rows = await q(`${sel} WHERE pd.news = 1`);
      else if (a.kind === 'user') rows = await q(`${sel} WHERE pd.user_id = ?`, [a.userId]);
      else rows = await q(sel);
      return rows.map((r) => ({ token: r.token, tokenHash: r.token_hash, userId: r.user_id, platform: r.platform, label: r.label || null, name: r.name || null, email: r.email || null }));
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
    // Admin content lists need each video's accumulated first-party starts, not just a recent analytics window.
    async allTimeCounts() {
      const rows = await q('SELECT video_id, SUM(plays) AS plays FROM play_stats GROUP BY video_id');
      return Object.fromEntries(rows.map((r) => [r.video_id, Number(r.plays)]));
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

  // ---- Phone sign-in: one row per OTP sent (only a hash of the code is stored) ----
  const phoneOtps = {
    /** Issues a code: earlier live codes for the same number stop working immediately. */
    async issue(phone, codeHash, ttlMs) {
      await tx(async (t) => {
        await t.query('UPDATE phone_otps SET consumed_at = UTC_TIMESTAMP(3) WHERE phone = ? AND consumed_at IS NULL', [phone]);
        await t.query('INSERT INTO phone_otps (id, phone, code_hash, expires_at) VALUES (UUID(),?,?,?)', [phone, codeHash, new Date(Date.now() + ttlMs)]);
      });
    },
    /** When a code was last sent to this number (per-number cooldown). */
    async lastIssuedAt(phone) { const r = (await q('SELECT MAX(created_at) AS at FROM phone_otps WHERE phone = ?', [phone]))[0]; return r?.at ? new Date(r.at) : null; },
    /** How many codes were sent to this number in the last `seconds` (flood guard). */
    async recentCount(phone, seconds) { return Number((await q('SELECT COUNT(*) AS n FROM phone_otps WHERE phone = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL ? SECOND', [phone, seconds]))[0].n); },
    /** The newest live code row for a number, or null. */
    async active(phone) {
      const r = (await q('SELECT id, code_hash, attempts, expires_at FROM phone_otps WHERE phone = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP(3) ORDER BY created_at DESC LIMIT 1', [phone]))[0];
      return r ? { id: r.id, codeHash: r.code_hash, attempts: Number(r.attempts), expiresAt: iso(r.expires_at) } : null;
    },
    /** Counts a wrong attempt; after `max` wrong tries the code is burnt. */
    async fail(id, max = 5) {
      await q('UPDATE phone_otps SET attempts = attempts + 1 WHERE id = ?', [id]);
      await q('UPDATE phone_otps SET consumed_at = UTC_TIMESTAMP(3) WHERE id = ? AND attempts >= ?', [id, max]);
    },
    /** Spends a code (single use). Returns false when another request already used it. */
    async consume(id) { return (await q('UPDATE phone_otps SET consumed_at = UTC_TIMESTAMP(3) WHERE id = ? AND consumed_at IS NULL', [id])).affectedRows === 1; },
    async purge() { await q('DELETE FROM phone_otps WHERE expires_at < UTC_TIMESTAMP(3) - INTERVAL 1 DAY'); await q('DELETE FROM account_phone_otps WHERE expires_at < UTC_TIMESTAMP(3) - INTERVAL 1 DAY'); },
  };

  // ---- Accounts that carry a verified phone number (phone sign-in / sign-up) ----
  const phones = {
    async byPhone(phone) {
      const r = (await q('SELECT * FROM users WHERE phone = ?', [phone]))[0];
      if (!r) return null;
      return { id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash, createdAt: iso(r.created_at), isAdmin: !!r.is_admin, disabledAt: iso(r.disabled_at), emailVerifiedAt: iso(r.email_verified_at), sessionVersion: r.session_version || 0, hasPin: !!r.parental_pin_hash, phone: r.phone, phoneVerifiedAt: iso(r.phone_verified_at) };
    },
    /** Links a verified number to an account (sign-in from a new browser, or "add my number" later). */
    async attach(userId, phone) {
      const r = await q('UPDATE users SET phone = ?, phone_verified_at = UTC_TIMESTAMP(3) WHERE id = ? AND (phone IS NULL OR phone = ?)', [phone, userId, phone]);
      return r.affectedRows === 1;
    },
    /** Creates an account whose only credential is a verified phone number; email is an internal phone-derived placeholder. */
    async createWithPhone(user, profile) {
      await tx(async (t) => {
        await t.query('INSERT INTO users (id, email, email_norm, name, phone, phone_verified_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))', [user.id, user.email, user.email.toLowerCase(), user.name, user.phone]);
        await t.query('INSERT INTO profiles (id, user_id, name, color, kids) VALUES (?,?,?,?,0)', [profile.id, user.id, profile.name, profile.color ?? 0]);
      });
    },
    /** Persistence guard for replacing the internal placeholder if a verified email-update flow is added. */
  };

  // ---- Support tickets (the Support page → Admin → Support) ----
  const mapReply = (r) => ({ id: r.id, ticketId: r.ticket_id, author: r.author, authorName: r.author_name, body: r.body, createdAt: iso(r.created_at) });
  const mapTicket = (r) => ({
    id: r.id, userId: r.user_id, name: r.name, email: r.email, phone: r.phone, category: r.category,
    subject: r.subject, body: r.body, status: r.status, priority: r.priority,
    appVersion: r.app_version, platform: r.platform, device: r.device,
    adminNote: r.admin_note, handledBy: r.handled_by, replies: Number(r.replies || 0),
    lastReplyBy: r.last_reply_by, lastReplyAt: iso(r.last_reply_at),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), resolvedAt: iso(r.resolved_at),
  });
  // A ticket list row carries the latest activity so the console can sort/paint without a second query.
  const ticketSelect = `SELECT t.*, (SELECT r2.created_at FROM support_ticket_replies r2 WHERE r2.ticket_id = t.id ORDER BY r2.created_at DESC LIMIT 1) AS last_reply_at,
    (SELECT r3.author FROM support_ticket_replies r3 WHERE r3.ticket_id = t.id ORDER BY r3.created_at DESC LIMIT 1) AS last_reply_by,
    (SELECT COUNT(*) FROM support_ticket_replies r4 WHERE r4.ticket_id = t.id) AS replies FROM support_tickets t`;
  const tickets = {
    async create(t) {
      await q(`INSERT INTO support_tickets (id, user_id, name, email, phone, category, subject, body, priority, app_version, platform, device)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.id, t.userId || null, String(t.name).slice(0, 80), String(t.email).slice(0, 254), t.phone ? String(t.phone).slice(0, 24) : null,
        t.category, String(t.subject).slice(0, 160), String(t.body).slice(0, 20_000), t.priority || 'normal',
        t.appVersion ? String(t.appVersion).slice(0, 40) : null, t.platform ? String(t.platform).slice(0, 40) : null, t.device ? String(t.device).slice(0, 120) : null]);
    },
    async get(id) { const r = (await q(`${ticketSelect} WHERE t.id = ?`, [id]))[0]; return r ? mapTicket(r) : null; },
    /** A guest's ticket, found from the short reference ("ADD-1A2B3C4D") plus the e-mail that raised it. */
    async byReference(ref, email) {
      const prefix = String(ref || '').replace(/^ADD-?/i, '').toLowerCase();
      if (!/^[0-9a-f]{8}$/.test(prefix)) return null;
      const r = (await q(`${ticketSelect} WHERE t.id LIKE ? AND LOWER(t.email) = ? LIMIT 1`, [`${prefix}%`, String(email || '').toLowerCase()]))[0];
      return r ? mapTicket(r) : null;
    },
    async replies(ticketId) { return (await q('SELECT * FROM support_ticket_replies WHERE ticket_id = ? ORDER BY created_at, id', [ticketId])).map(mapReply); },
    /** Adds a message to the thread and moves the ticket's status/last-activity accordingly. */
    async addReply({ id, ticketId, author, authorName = null, authorId = null, body, status = null }) {
      await tx(async (t) => {
        await t.query('INSERT INTO support_ticket_replies (id, ticket_id, author, author_name, author_id, body) VALUES (?,?,?,?,?,?)', [id, ticketId, author, authorName, authorId, String(body).slice(0, 10_000)]);
        await t.query(`UPDATE support_tickets SET replies = replies + 1, last_reply_by = ?, last_reply_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3),
          status = COALESCE(?, status), resolved_at = IF(? = 'resolved', COALESCE(resolved_at, UTC_TIMESTAMP(3)), IF(? IN ('open','pending'), NULL, resolved_at))
          WHERE id = ?`, [author, status, status, status, ticketId]);
      });
    },
    /** A viewer's own tickets. Guests have none (they get the reference by e-mail). */
    async forUser(userId, { limit = 25, offset = 0 } = {}) {
      const [rows, [{ n }]] = await Promise.all([
        q(`${ticketSelect} WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT ? OFFSET ?`, [userId, limit, offset]),
        q('SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ?', [userId]),
      ]);
      return { total: Number(n), items: rows.map(mapTicket) };
    },
    /** Console list with the usual filters. `q` searches subject, body, email and name. */
    async list({ status = 'all', category = 'all', search = '', userId = null, limit = 25, offset = 0 } = {}) {
      const where = [], params = [];
      if (status !== 'all') { where.push('t.status = ?'); params.push(status); }
      if (category !== 'all') { where.push('t.category = ?'); params.push(category); }
      if (userId) { where.push('t.user_id = ?'); params.push(userId); }
      if (search) { where.push('(t.subject LIKE ? OR t.body LIKE ? OR t.email LIKE ? OR t.name LIKE ?)'); const like = `%${search}%`; params.push(like, like, like, like); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows, [{ n }], counts] = await Promise.all([
        q(`${ticketSelect} ${w} ORDER BY FIELD(t.status,'open','pending','resolved','closed'), t.updated_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
        q(`SELECT COUNT(*) AS n FROM support_tickets t ${w}`, params),
        q("SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status"),
      ]);
      const byStatus = Object.fromEntries(counts.map((r) => [r.status, Number(r.n)]));
      return { total: Number(n), items: rows.map(mapTicket), counts: { open: byStatus.open || 0, pending: byStatus.pending || 0, resolved: byStatus.resolved || 0, closed: byStatus.closed || 0 } };
    },
    /** Updates the triage fields an admin owns (status, priority, internal note, who handled it). */
    async update(id, { status, priority, adminNote, handledBy = null }) {
      const sets = [], params = [];
      if (status) { sets.push('status = ?'); params.push(status); sets.push("resolved_at = IF(? = 'resolved', COALESCE(resolved_at, UTC_TIMESTAMP(3)), IF(? IN ('open','pending'), NULL, resolved_at))"); params.push(status, status); }
      if (priority) { sets.push('priority = ?'); params.push(priority); }
      if (adminNote !== undefined) { sets.push('admin_note = ?'); params.push(adminNote ? String(adminNote).slice(0, 300) : null); }
      if (handledBy) { sets.push('handled_by = ?'); params.push(String(handledBy).slice(0, 254)); }
      if (!sets.length) return false;
      sets.push('updated_at = UTC_TIMESTAMP(3)');
      return (await q(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = ?`, [...params, id])).affectedRows === 1;
    },
    async remove(id) { return (await q('DELETE FROM support_tickets WHERE id = ?', [id])).affectedRows === 1; },
    /** Badge on the console: tickets nobody has picked up yet (new viewer messages count as activity). */
    async openCount() { return Number((await q("SELECT COUNT(*) AS n FROM support_tickets WHERE status IN ('open','pending')"))[0].n); },
    /** Tickets whose last message was from the viewer (the admin's "needs an answer" queue). */
    async awaitingCount() { return Number((await q("SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'"))[0].n); },
    /** Keep support conversations for at most one year after the last activity. */
    async prune() { await q('DELETE FROM support_tickets WHERE updated_at < UTC_TIMESTAMP(3) - INTERVAL 365 DAY'); },
  };

  // ---- Server-side settings (app_settings): currently the client cache version behind the console button ----
  const settings = {
    async get(k, dflt = null) { const r = (await q('SELECT v FROM app_settings WHERE k = ?', [k]))[0]; return r ? r.v : dflt; },
    async set(k, v) { await q('INSERT INTO app_settings (k, v) VALUES (?,?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, String(v).slice(0, 255)]); },
    /** Read + write in one step (used by the cache-purge button so two admins cannot write the same value). */
    async bump(k) { const next = String(Date.now()); await q('INSERT INTO app_settings (k, v) VALUES (?,?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, next]); return next; },
    async all() { return Object.fromEntries((await q('SELECT k, v FROM app_settings')).map((r) => [r.k, r.v])); },
  };


  /* ---- Promotional credit (welcome bonus, referral rewards, goodwill) — see server/src/promos.js ----
   * The ledger is append-only: a grant stores how much is left (`remaining_paise`), and spending walks the
   * grants oldest-expiry-first and decrements them inside one transaction with row locks. That is what makes
   * a balance correct under two tabs checking out at once, and what stops an expired grant from being spent.
   */
  const CREDIT_SELECT = `SELECT id, user_id, kind, amount_paise, remaining_paise, status, reason, ref_type, ref_id, expires_at, settled_at, created_at FROM user_credit`;
  const mapCredit = (r) => r && ({
    id: r.id, userId: r.user_id, kind: r.kind, amountPaise: Number(r.amount_paise), remainingPaise: Number(r.remaining_paise),
    status: r.status, reason: r.reason, refType: r.ref_type, refId: r.ref_id,
    expiresAt: iso(r.expires_at), settledAt: iso(r.settled_at), createdAt: iso(r.created_at),
  });
  const credits = {
    /** The spendable balance in paise (grants that are available and not expired). */
    async balance(userId) {
      const r = (await q(`SELECT COALESCE(SUM(remaining_paise),0) AS n FROM user_credit
        WHERE user_id = ? AND status = 'available' AND amount_paise > 0 AND remaining_paise > 0
          AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))`, [userId]))[0];
      return Number(r?.n || 0);
    },
    /** Spendable balance, what is on hold (a referral whose friend has not qualified yet) and what expires soon. */
    async summary(userId) {
      const r = (await q(`SELECT
        COALESCE(SUM(CASE WHEN amount_paise > 0 AND status = 'available' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3)) THEN remaining_paise ELSE 0 END),0) AS available,
        COALESCE(SUM(CASE WHEN amount_paise > 0 AND status = 'pending' THEN remaining_paise ELSE 0 END),0) AS pending,
        COALESCE(SUM(CASE WHEN amount_paise < 0 AND status = 'pending' THEN -amount_paise ELSE 0 END),0) AS held,
        COALESCE(SUM(CASE WHEN status = 'available' AND expires_at IS NOT NULL AND expires_at > UTC_TIMESTAMP(3) AND expires_at <= UTC_TIMESTAMP(3) + INTERVAL 7 DAY THEN remaining_paise ELSE 0 END),0) AS expiring,
        MIN(CASE WHEN amount_paise > 0 AND status = 'available' AND expires_at IS NOT NULL AND expires_at > UTC_TIMESTAMP(3) THEN expires_at END) AS nextExpiry
        FROM user_credit WHERE user_id = ?`, [userId]))[0] || {};
      // `heldPaise` is credit reserved by an order that has not been paid yet — it comes back if it never is.
      return { availablePaise: Number(r.available || 0), pendingPaise: Number(r.pending || 0), heldPaise: Number(r.held || 0), expiringPaise: Number(r.expiring || 0), nextExpiryAt: iso(r.nextExpiry) };
    },
    /** Has the account ever been granted this kind? (One welcome bonus per account, ever.) */
    async hasKind(userId, kind) { return Number((await q('SELECT COUNT(*) AS n FROM user_credit WHERE user_id = ? AND kind = ?', [userId, kind]))[0].n) > 0; },
    /** Adds one ledger row. `status: 'pending'` holds the value until it is released. */
    async add(entry) {
      const id = entry.id || crypto.randomUUID();
      await q(`INSERT INTO user_credit (id, user_id, kind, amount_paise, remaining_paise, status, reason, ref_type, ref_id, expires_at, settled_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, entry.userId, entry.kind, entry.amountPaise, entry.amountPaise > 0 ? entry.amountPaise : 0, entry.status || 'available',
        entry.reason ? String(entry.reason).slice(0, 200) : null, entry.refType || null, entry.refId || null, entry.expiresAt || null,
        entry.status && entry.status !== 'pending' && entry.status !== 'available' ? new Date() : null]);
      return mapCredit((await q(`${CREDIT_SELECT} WHERE id = ?`, [id]))[0]);
    },
    /** Grants that are waiting for the referred friend to qualify. */
    async pendingFor(userId) { return (await q(`${CREDIT_SELECT} WHERE user_id = ? AND status = 'pending' AND amount_paise > 0 ORDER BY created_at`, [userId])).map(mapCredit); },
    /** Releases the pending grants tied to one reference (a single referral, an order …). */
    async releasePendingRef(userId, refType, refId) {
      const r = (await q(`SELECT COALESCE(SUM(remaining_paise),0) AS n FROM user_credit WHERE user_id = ? AND ref_type = ? AND ref_id = ? AND status = 'pending' AND amount_paise > 0`, [userId, refType, refId]))[0];
      const amount = Number(r?.n || 0);
      if (amount > 0) await q(`UPDATE user_credit SET status = 'available', settled_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND ref_type = ? AND ref_id = ? AND status = 'pending' AND amount_paise > 0`, [userId, refType, refId]);
      return amount;
    },
    /** Releases every pending grant of an account. Returns how much became spendable. */
    async releasePending(userId) {
      const rows = await q(`SELECT COALESCE(SUM(remaining_paise),0) AS n FROM user_credit WHERE user_id = ? AND status = 'pending' AND amount_paise > 0`, [userId]);
      const amount = Number(rows[0]?.n || 0);
      if (amount > 0) await q(`UPDATE user_credit SET status = 'available', settled_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND status = 'pending' AND amount_paise > 0`, [userId]);
      return amount;
    },
    /**
     * Spends `amountPaise` oldest-expiry-first under row locks. Returns { appliedPaise, spendId } — applied may be
     * less than asked when the balance ran out. Records the spend as one negative ledger row (status `pending`
     * until the payment it belongs to is settled, so an abandoned order can be given back).
     */
    async spend(userId, amountPaise, { refType = null, refId = null, reason = null, status = 'available' } = {}) {
      const want = Math.max(0, Math.floor(Number(amountPaise) || 0));
      if (!want) return { appliedPaise: 0, spendId: null };
      return tx(async (t) => {
        const grants = await t.query(`SELECT id, remaining_paise FROM user_credit
          WHERE user_id = ? AND status = 'available' AND amount_paise > 0 AND remaining_paise > 0
            AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
          ORDER BY (expires_at IS NULL) DESC, expires_at ASC, created_at ASC, id ASC
          FOR UPDATE`, [userId]);
        let left = want;
        for (const g of grants) {
          if (left <= 0) break;
          const take = Math.min(left, Number(g.remaining_paise));
          const rest = Number(g.remaining_paise) - take;
          await t.query('UPDATE user_credit SET remaining_paise = ?, status = ? WHERE id = ?', [rest, rest > 0 ? 'available' : 'spent', g.id]);
          left -= take;
        }
        const applied = want - left;
        if (!applied) return { appliedPaise: 0, spendId: null };
        const id = crypto.randomUUID();
        await t.query(`INSERT INTO user_credit (id, user_id, kind, amount_paise, remaining_paise, status, reason, ref_type, ref_id)
          VALUES (?,?,?,?,?,?,?,?,?)`, [id, userId, 'spend', -applied, 0, status, reason ? String(reason).slice(0, 200) : null, refType, refId]);
        return { appliedPaise: applied, spendId: id };
      });
    },
    /** Marks the spends tied to a reference as final (the payment went through) or void (it never will be paid). */
    async settleRef(refType, refId, status) {
      const res = await q(`UPDATE user_credit SET status = ?, settled_at = UTC_TIMESTAMP(3) WHERE ref_type = ? AND ref_id = ? AND kind = 'spend' AND status = 'pending'`, [status, refType, refId]);
      return res.affectedRows || 0;
    },
    /** What a pending spend holds (used to give the value back when an order is abandoned). */
    async pendingSpend(refType, refId) {
      // A bare SUM: MySQL's ONLY_FULL_GROUP_BY mode rejects selecting a plain column next to an aggregate.
      const r = (await q(`SELECT COALESCE(SUM(-amount_paise),0) AS n FROM user_credit WHERE ref_type = ? AND ref_id = ? AND kind = 'spend' AND status = 'pending'`, [refType, refId]))[0];
      return { amountPaise: Number(r?.n || 0) };
    },
    /** Undoes a pending spend: books a `refund` grant so the viewer keeps the value. */
    async returnPending(refType, refId, { reason = 'Order not completed' } = {}) {
      const held = await credits.pendingSpend(refType, refId);
      if (!held.amountPaise) return 0;
      const n = await credits.settleRef(refType, refId, 'void');
      if (!n) return 0;
      await credits.add({ userId: (await q(`SELECT user_id FROM user_credit WHERE ref_type = ? AND ref_id = ? AND kind = 'spend' LIMIT 1`, [refType, refId]))[0]?.user_id, kind: 'refund', amountPaise: held.amountPaise, reason, refType, refId });
      return held.amountPaise;
    },
    /** Pending spends older than `hours` whose payment is still unpaid (a deploy or a closed tab left them). */
    async stalePending(hours = 24) {
      return (await q(`SELECT c.id, c.user_id AS userId, c.ref_id AS paymentId, -c.amount_paise AS amountPaise FROM user_credit c
        WHERE c.kind = 'spend' AND c.status = 'pending' AND c.ref_type = 'payment' AND c.created_at < UTC_TIMESTAMP(3) - INTERVAL ? HOUR
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = c.ref_id AND p.status = 'paid')`, [hours])).map((r) => ({ id: r.id, userId: r.userId, paymentId: r.paymentId, amountPaise: Number(r.amountPaise) }));
    },
    /** Removes one grant that has not been touched yet (a mistake or a fraud report). Returns what was removed. */
    async revoke(id, { reason = null } = {}) {
      const r = (await q(`SELECT remaining_paise FROM user_credit WHERE id = ? AND amount_paise > 0 AND status IN ('pending','available') AND remaining_paise > 0`, [id]))[0];
      if (!r) return 0;
      await q(`UPDATE user_credit SET remaining_paise = 0, status = 'void', reason = COALESCE(?, reason), settled_at = UTC_TIMESTAMP(3) WHERE id = ?`, [reason ? String(reason).slice(0, 200) : null, id]);
      return Number(r.remaining_paise);
    },
    /** Removes every untouched grant created by a reference (cancelling a referral). Returns the total removed. */
    async revokeByRef(refType, refId, { reason = null } = {}) {
      const rows = await q(`SELECT COALESCE(SUM(remaining_paise),0) AS n FROM user_credit
        WHERE ref_type = ? AND ref_id = ? AND amount_paise > 0 AND status IN ('pending','available') AND remaining_paise > 0`, [refType, refId]);
      const amount = Number(rows[0]?.n || 0);
      if (amount > 0) await q(`UPDATE user_credit SET remaining_paise = 0, status = 'void', reason = COALESCE(?, reason), settled_at = UTC_TIMESTAMP(3)
        WHERE ref_type = ? AND ref_id = ? AND amount_paise > 0 AND status IN ('pending','available') AND remaining_paise > 0`, [reason ? String(reason).slice(0, 200) : null, refType, refId]);
      return amount;
    },
    /** Flips grants whose expiry has passed. Returns how much value expired. */
    async expireDue() {
      const r = (await q(`SELECT COALESCE(SUM(remaining_paise),0) AS n FROM user_credit WHERE status = 'available' AND amount_paise > 0 AND remaining_paise > 0 AND expires_at IS NOT NULL AND expires_at <= UTC_TIMESTAMP(3)`))[0];
      const amount = Number(r?.n || 0);
      if (amount > 0) await q(`UPDATE user_credit SET status = 'expired', settled_at = UTC_TIMESTAMP(3) WHERE status = 'available' AND amount_paise > 0 AND remaining_paise > 0 AND expires_at IS NOT NULL AND expires_at <= UTC_TIMESTAMP(3)`);
      return amount;
    },
    /** The viewer's own movements, newest first. */
    async ledger(userId, { limit = 50, offset = 0 } = {}) {
      const rows = await q(`${CREDIT_SELECT} WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [userId, limit, offset]);
      const total = Number((await q('SELECT COUNT(*) AS n FROM user_credit WHERE user_id = ?', [userId]))[0].n);
      return { total, items: rows.map(mapCredit) };
    },
    /** Console: the newest movements across all accounts (optionally for one account or one kind). */
    async list({ userId = null, kind = null, limit = 50, offset = 0 } = {}) {
      const where = [], args = [];
      if (userId) { where.push('c.user_id = ?'); args.push(userId); }
      if (kind) { where.push('c.kind = ?'); args.push(kind); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = await q(`SELECT c.*, u.email AS user_email, u.name AS user_name FROM user_credit c LEFT JOIN users u ON u.id = c.user_id ${w} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
      const total = Number((await q(`SELECT COUNT(*) AS n FROM user_credit c ${w}`, args))[0].n);
      return { total, items: rows.map((r) => ({ ...mapCredit(r), userEmail: r.user_email, userName: r.user_name })) };
    },
    /** Headline numbers for the console: what is out there, what was used, what expired. */
    async stats() {
      const r = (await q(`SELECT
        COALESCE(SUM(CASE WHEN amount_paise > 0 AND status IN ('available','pending') THEN remaining_paise ELSE 0 END),0) AS outstanding,
        COALESCE(SUM(CASE WHEN amount_paise > 0 THEN amount_paise ELSE 0 END),0) AS granted,
        COALESCE(SUM(CASE WHEN kind = 'spend' AND status <> 'void' THEN -amount_paise ELSE 0 END),0) AS spent,
        COALESCE(SUM(CASE WHEN status = 'expired' THEN amount_paise ELSE 0 END),0) AS expired,
        COUNT(DISTINCT CASE WHEN amount_paise > 0 THEN user_id END) AS accounts
        FROM user_credit`))[0] || {};
      const byKind = Object.fromEntries((await q(`SELECT kind, COUNT(*) AS n, COALESCE(SUM(amount_paise),0) AS paise FROM user_credit GROUP BY kind`)).map((x) => [x.kind, { count: Number(x.n), paise: Number(x.paise) }]));
      return { outstandingPaise: Number(r.outstanding || 0), grantedPaise: Number(r.granted || 0), spentPaise: Number(r.spent || 0), expiredPaise: Number(r.expired || 0), accounts: Number(r.accounts || 0), byKind };
    },
  };

  // ---- Referrals: who invited whom (one row per invited account, at most one referral per person) ----
  const mapReferral = (r) => r && ({
    id: r.id, inviterId: r.inviter_id, inviteeId: r.invitee_id, code: r.code, status: r.status,
    bonusPaise: Number(r.bonus_paise), createdAt: iso(r.created_at), completedAt: iso(r.completed_at),
    inviterEmail: r.inviter_email, inviteeEmail: r.invitee_email, inviteeName: r.invitee_name,
  });
  const referrals = {
    async create({ id = crypto.randomUUID(), inviterId, inviteeId, code, bonusPaise = 0, status = 'pending' }) {
      await q('INSERT INTO referrals (id, inviter_id, invitee_id, code, status, bonus_paise, completed_at) VALUES (?,?,?,?,?,?,?)',
        [id, inviterId, inviteeId, code, status, bonusPaise, status === 'completed' ? new Date() : null]);
      return referrals.byId(id);
    },
    async byId(id) { return mapReferral((await q('SELECT * FROM referrals WHERE id = ?', [id]))[0]); },
    /** The referral of an invited account (each account can have at most one). */
    async byInvitee(inviteeId) { return mapReferral((await q('SELECT * FROM referrals WHERE invitee_id = ?', [inviteeId]))[0]); },
    /** Everyone this account invited, newest first, with the friend's name/email and accurate summary counts. */
    async forInviter(inviterId, { limit = 50, offset = 0 } = {}) {
      const [rows, summaryRows] = await Promise.all([
        q(`SELECT r.*, u.email AS invitee_email, u.name AS invitee_name FROM referrals r LEFT JOIN users u ON u.id = r.invitee_id
          WHERE r.inviter_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`, [inviterId, limit, offset]),
        q(`SELECT COUNT(*) AS total,
            SUM(CASE WHEN status <> 'void' THEN 1 ELSE 0 END) AS active_total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN bonus_paise ELSE 0 END), 0) AS earned_paise
          FROM referrals WHERE inviter_id = ?`, [inviterId]),
      ]);
      const summary = summaryRows[0] || {};
      return {
        total: Number(summary.total || 0), activeTotal: Number(summary.active_total || 0),
        completed: Number(summary.completed || 0), pending: Number(summary.pending || 0),
        earnedPaise: Number(summary.earned_paise || 0), items: rows.map(mapReferral),
      };
    },
    /** How many rewards this account has already earned or is waiting on (the anti-farming cap). */
    async countForInviter(inviterId) { return Number((await q("SELECT COUNT(*) AS n FROM referrals WHERE inviter_id = ? AND status <> 'void'", [inviterId]))[0].n); },
    async complete(id) { await q("UPDATE referrals SET status = 'completed', completed_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'pending'", [id]); return referrals.byId(id); },
    async void(id) { await q("UPDATE referrals SET status = 'void' WHERE id = ?", [id]); return referrals.byId(id); },
    /** Console list: newest first, with both parties for display. */
    async list({ status = null, limit = 50, offset = 0 } = {}) {
      const where = status ? 'WHERE r.status = ?' : '', args = status ? [status] : [];
      const rows = await q(`SELECT r.*, i.email AS inviter_email, u.email AS invitee_email, u.name AS invitee_name FROM referrals r
        LEFT JOIN users i ON i.id = r.inviter_id LEFT JOIN users u ON u.id = r.invitee_id ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
      const total = Number((await q(`SELECT COUNT(*) AS n FROM referrals r ${where}`, args))[0].n);
      return { total, items: rows.map(mapReferral) };
    },
    /** Who brings the most people in (completed referrals first). */
    async leaderboard(limit = 10) {
      return (await q(`SELECT r.inviter_id AS userId, u.name, u.email, COUNT(*) AS invited,
          SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN r.status <> 'void' THEN r.bonus_paise ELSE 0 END) AS bonusPaise
        FROM referrals r LEFT JOIN users u ON u.id = r.inviter_id GROUP BY r.inviter_id, u.name, u.email
        ORDER BY completed DESC, invited DESC LIMIT ?`, [limit])).map((r) => ({ userId: r.userId, name: r.name, email: r.email, invited: Number(r.invited), completed: Number(r.completed || 0), bonusPaise: Number(r.bonusPaise || 0) }));
    },
    async stats() {
      const r = (await q(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END) AS void,
        COALESCE(SUM(CASE WHEN status <> 'void' THEN bonus_paise ELSE 0 END),0) AS bonusPaise FROM referrals`))[0] || {};
      return { total: Number(r.total || 0), completed: Number(r.completed || 0), pending: Number(r.pending || 0), void: Number(r.void || 0), bonusPaise: Number(r.bonusPaise || 0) };
    },
    /** Deleting an account removes its referral rows through the foreign keys. */
  };

  // ---- Client/server error reports shown in the admin "Errors" page ----
  const parseErrorJson = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); }
    catch { return { message: String(value).slice(0, 2000) }; }
  };
  const errors = {
    async add(e) {
      const sqlQuery = e.sqlQuery ? String(e.sqlQuery).slice(0, 8000) : null;
      const sqlParamCount = Number.isSafeInteger(e.sqlParamCount) && e.sqlParamCount >= 0 ? e.sqlParamCount : null;
      const severity = ['warning', 'error', 'fatal'].includes(e.severity) ? e.severity : 'error';
      const errorName = e.errorName ? String(e.errorName).slice(0, 128) : null;
      const errorCode = e.errorCode || e.code ? String(e.errorCode || e.code).slice(0, 128) : null;
      const httpStatus = Number.isInteger(e.status ?? e.httpStatus) ? Number(e.status ?? e.httpStatus) : null;
      const httpMethod = e.method || e.httpMethod ? String(e.method || e.httpMethod).slice(0, 12) : null;
      const requestId = e.requestId ? String(e.requestId).slice(0, 64) : null;
      const releaseId = e.release || e.releaseId ? String(e.release || e.releaseId).slice(0, 64) : null;
      const environment = e.environment ? String(e.environment).slice(0, 32) : null;
      const instanceId = e.instanceId ? String(e.instanceId).slice(0, 36) : null;
      let details = null, sqlException = null;
      try { details = e.details ? JSON.stringify(e.details) : null; } catch { /* malformed details never block the report */ }
      try { sqlException = e.sqlException ? JSON.stringify(e.sqlException).slice(0, 8000) : null; } catch { /* never let malformed diagnostics block the report */ }
      await q(`INSERT INTO error_log
        (source, severity, message, error_name, error_code, http_status, http_method, request_id, release_id, environment, instance_id, details,
         stack, sql_query, sql_param_count, sql_exception, url, user_agent, user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [e.source === 'client' ? 'client' : 'server', severity,
        String(e.message || 'Unknown error').slice(0, 500), errorName, errorCode, httpStatus, httpMethod, requestId, releaseId, environment, instanceId,
        details, e.stack ? String(e.stack).slice(0, 48_000) : null, sqlQuery, sqlParamCount, sqlException,
        String(e.url || '').slice(0, 300), String(e.userAgent || '').slice(0, 512), e.userId || null]);
    },
    async list({ limit = 50, offset = 0, source = '', search = '' } = {}) {
      const pageLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const pageOffset = Math.max(Number(offset) || 0, 0);
      const selectedSource = ['server', 'client'].includes(source) ? source : '';
      const text = String(search || '').trim().slice(0, 120);
      const where = [];
      const params = [];
      if (selectedSource) { where.push('e.source = ?'); params.push(selectedSource); }
      if (text) {
        const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push('(e.message LIKE ? OR e.error_name LIKE ? OR e.error_code LIKE ? OR e.url LIKE ? OR e.request_id LIKE ?)');
        params.push(pattern, pattern, pattern, pattern, pattern);
      }
      const recentFilter = where.length ? ` AND ${where.join(' AND ')}` : '';
      const groupFilter = recentFilter.replaceAll('e.', '');
      const RECENT_COLUMNS = `e.id, e.source, e.severity, e.message, e.error_name, e.error_code, e.http_status, e.http_method, e.request_id,
                  e.release_id, e.environment, e.instance_id, e.details, e.stack, e.sql_query, e.sql_param_count, e.sql_exception,
                  e.url, e.user_agent, e.user_id, u.name AS account_name, u.email AS account_email, e.created_at`;
      const toRecent = (r) => ({
        id: r.id, source: r.source, severity: r.severity || 'error', message: r.message, errorName: r.error_name || null,
        errorCode: r.error_code || null, status: r.http_status == null ? null : Number(r.http_status), method: r.http_method || null,
        requestId: r.request_id || null, release: r.release_id || null, environment: r.environment || null, instanceId: r.instance_id || null,
        details: parseErrorJson(r.details), stack: r.stack, sqlQuery: r.sql_query || null,
        sqlParamCount: r.sql_param_count == null ? null : Number(r.sql_param_count), sqlException: parseErrorJson(r.sql_exception),
        url: r.url, userAgent: r.user_agent, userId: r.user_id || null, accountName: r.account_name || null,
        accountEmail: r.account_email || null, at: iso(r.created_at),
      });
      const [groups, recent, [{ n: total }]] = await Promise.all([
        // The five most frequent repeated errors of the last 7 days. MAX(id) points at one full example per group.
        q(`SELECT source, severity, error_name, error_code, http_status, message, COUNT(*) AS n, MAX(created_at) AS last_at, MIN(created_at) AS first_at, MAX(url) AS url, MAX(id) AS sample_id
           FROM error_log WHERE created_at > UTC_TIMESTAMP(3) - INTERVAL 7 DAY${groupFilter}
           GROUP BY source, severity, error_name, error_code, http_status, message ORDER BY n DESC, last_at DESC LIMIT 5`, params),
        q(`SELECT ${RECENT_COLUMNS}
           FROM error_log e LEFT JOIN users u ON u.id = e.user_id
           WHERE e.created_at > UTC_TIMESTAMP(3) - INTERVAL 30 DAY${recentFilter}
           ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`, [...params, pageLimit, pageOffset]),
        q(`SELECT COUNT(*) AS n FROM error_log e WHERE e.created_at > UTC_TIMESTAMP(3) - INTERVAL 30 DAY${recentFilter}`, params),
      ]);
      const sampleIds = groups.map((r) => Number(r.sample_id)).filter((id) => id > 0);
      const samples = sampleIds.length
        ? await q(`SELECT ${RECENT_COLUMNS} FROM error_log e LEFT JOIN users u ON u.id = e.user_id WHERE e.id IN (${sampleIds.map(() => '?').join(',')})`, sampleIds)
        : [];
      const sampleById = new Map(samples.map((r) => [Number(r.id), toRecent(r)]));
      return {
        groups: groups.map((r) => ({
          source: r.source, severity: r.severity || 'error', errorName: r.error_name || null, errorCode: r.error_code || null,
          status: r.http_status == null ? null : Number(r.http_status), message: r.message, count: Number(r.n),
          lastAt: iso(r.last_at), firstAt: iso(r.first_at), url: r.url, sample: sampleById.get(Number(r.sample_id)) || null,
        })),
        recent: recent.map(toRecent),
        total: Number(total || 0), limit: pageLimit, offset: pageOffset, source: selectedSource, search: text,
      };
    },
    async clear() { await q('DELETE FROM error_log'); },
    async prune() { await q('DELETE FROM error_log WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 30 DAY'); },
    async count24h() { return Number((await q('SELECT COUNT(*) AS n FROM error_log WHERE created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY'))[0].n); },
  };

  // Everything above becomes a property of the main `db` object.

  // ---- Broadcast campaigns: one row per admin broadcast, updated as it sends ----
  const mapCampaign = (r) => ({
    id: r.id, channel: r.channel, audience: r.audience, title: r.title, body: r.body, url: r.url, button: r.button,
    imageUrl: r.image_url || null, imageAlt: r.image_alt || null,
    status: r.status, total: Number(r.total), sent: Number(r.sent), failed: Number(r.failed), skipped: Number(r.skipped),
    cursor: Number(r.page_cursor), test: !!r.is_test, error: r.error, by: r.created_by,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), finishedAt: iso(r.finished_at),
  });
  const campaigns = {
    async create(c) {
      await q(`INSERT INTO campaigns (id, channel, audience, title, body, url, button, image_url, image_alt, status, is_test, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.id, c.channel, String(c.audience).slice(0, 120), String(c.title).slice(0, 200), String(c.body).slice(0, 20_000), c.url || null, c.button || null,
        c.imageUrl ? String(c.imageUrl).slice(0, 500) : null, c.imageAlt ? String(c.imageAlt).slice(0, 200) : null, c.status || 'queued', c.test ? 1 : 0, c.by || null]);
    },
    async get(id) { const r = (await q('SELECT * FROM campaigns WHERE id = ?', [id]))[0]; return r ? mapCampaign(r) : null; },
    /** Upserts one endpoint/account result. The unique digest makes retries update the same recipient row. */
    async recordDelivery(campaignId, d) {
      const channel = d.channel === 'email' ? 'email' : 'push';
      const transport = ['email', 'web_push', 'app_push'].includes(d.transport) ? d.transport : (channel === 'email' ? 'email' : 'web_push');
      const status = ['pending', 'sent', 'failed', 'skipped'].includes(d.status) ? d.status : 'pending';
      const key = String(d.deliveryKey || '');
      if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('A SHA-256 campaign delivery key is required.');
      await q(`INSERT INTO campaign_deliveries
        (id, campaign_id, delivery_key, channel, transport, user_id, recipient_name, recipient_email, destination, status, error)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), recipient_name = VALUES(recipient_name), recipient_email = VALUES(recipient_email),
          destination = VALUES(destination), status = VALUES(status), error = VALUES(error), updated_at = UTC_TIMESTAMP(3)`,
      [crypto.randomUUID(), campaignId, key, channel, transport, d.userId || null,
        d.name ? String(d.name).slice(0, 120) : null, d.email ? String(d.email).slice(0, 254) : null,
        d.destination ? String(d.destination).slice(0, 160) : null, status, d.error ? String(d.error).slice(0, 500) : null]);
    },
    /** Recipient-level history is paged so a large campaign never loads every address into one response. */
    async deliveries(campaignId, { status = 'all', search = '', limit = 50, offset = 0 } = {}) {
      const where = ['campaign_id = ?'], params = [campaignId];
      if (['pending', 'sent', 'failed', 'skipped'].includes(status)) { where.push('status = ?'); params.push(status); }
      const text = String(search || '').trim().slice(0, 100);
      if (text) {
        const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push('(recipient_name LIKE ? OR recipient_email LIKE ? OR user_id LIKE ?)'); params.push(pattern, pattern, pattern);
      }
      const clause = where.join(' AND ');
      const [rows, [{ n }]] = await Promise.all([
        q(`SELECT id, user_id, recipient_name, recipient_email, destination, transport, status, error, created_at, updated_at
           FROM campaign_deliveries WHERE ${clause} ORDER BY created_at, id LIMIT ? OFFSET ?`, [...params, limit, offset]),
        q(`SELECT COUNT(*) AS n FROM campaign_deliveries WHERE ${clause}`, params),
      ]);
      return { total: Number(n), limit, offset, deliveries: rows.map((r) => ({
        id: r.id, userId: r.user_id || null, name: r.recipient_name || null, email: r.recipient_email || null,
        destination: r.destination || null, transport: r.transport, status: r.status, error: r.error || null,
        at: iso(r.created_at), updatedAt: iso(r.updated_at),
      })) };
    },
    async deliveryCounts(campaignId) {
      const rows = await q('SELECT status, COUNT(*) AS n FROM campaign_deliveries WHERE campaign_id = ? GROUP BY status', [campaignId]);
      return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    },
    /** Claims a queued campaign, or takes over only after another instance's lease expires. */
    async claim(id, token, leaseSeconds = 300) {
      const lease = Math.min(Math.max(Number(leaseSeconds) || 300, 30), 900);
      const r = await q(`UPDATE campaigns SET status = 'sending', claim_token = ?, claim_until = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)), updated_at = UTC_TIMESTAMP(3)
                         WHERE id = ? AND status IN ('queued','sending') AND (claim_token IS NULL OR claim_until IS NULL OR claim_until <= UTC_TIMESTAMP(3))`, [token, lease, id]);
      return r.affectedRows === 1;
    },
    /** Renews only the caller's live lease; a worker that lost ownership cannot extend or overwrite it. */
    async renew(id, token, leaseSeconds = 300) {
      const lease = Math.min(Math.max(Number(leaseSeconds) || 300, 30), 900);
      const r = await q(`UPDATE campaigns SET claim_until = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)), updated_at = UTC_TIMESTAMP(3)
                         WHERE id = ? AND status = 'sending' AND claim_token = ? AND claim_until > UTC_TIMESTAMP(3)`, [lease, id, token]);
      if (r.affectedRows === 1) return true;
      // MySQL can report zero changed rows when two renewals land in the same millisecond.
      return !!(await q("SELECT id FROM campaigns WHERE id = ? AND status = 'sending' AND claim_token = ? AND claim_until > UTC_TIMESTAMP(3)", [id, token]))[0];
    },
    // Progress updates after each e-mail page (and once for push); they also extend the lease atomically.
    async progress(id, { sent, failed, skipped, total, cursor }, token) {
      const r = await q(`UPDATE campaigns SET sent = sent + ?, failed = failed + ?, skipped = skipped + ?, total = GREATEST(total, ?), page_cursor = ?,
                         claim_until = TIMESTAMPADD(SECOND, 300, UTC_TIMESTAMP(3)), updated_at = UTC_TIMESTAMP(3)
                         WHERE id = ? AND status = 'sending' AND claim_token = ? AND claim_until > UTC_TIMESTAMP(3)`,
      [Number(sent) || 0, Number(failed) || 0, Number(skipped) || 0, Number(total) || 0, Number(cursor) || 0, id, token]);
      if (r.affectedRows === 1) return true;
      return !!(await q("SELECT id FROM campaigns WHERE id = ? AND status = 'sending' AND claim_token = ? AND claim_until > UTC_TIMESTAMP(3)", [id, token]))[0];
    },
    async finish(id, status, error = null, token = null) {
      const where = token ? ' AND claim_token = ?' : '';
      const values = [status, error ? String(error).slice(0, 300) : null, id, ...(token ? [token] : [])];
      const r = await q(`UPDATE campaigns SET status = ?, error = ?, updated_at = UTC_TIMESTAMP(3), finished_at = UTC_TIMESTAMP(3), claim_token = NULL, claim_until = NULL WHERE id = ?${where}`, values);
      return r.affectedRows === 1;
    },
    async list({ limit = 25 } = {}) { return (await q('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT ?', [limit])).map(mapCampaign); },
    /** Rows eligible for takeover. The claim UPDATE is the final atomic arbiter when instances race. */
    async unfinished() {
      return (await q("SELECT * FROM campaigns WHERE status IN ('queued','sending') AND is_test = 0 AND (claim_token IS NULL OR claim_until IS NULL OR claim_until <= UTC_TIMESTAMP(3)) ORDER BY created_at LIMIT 5")).map(mapCampaign);
    },
    async prune() { await q("DELETE FROM campaigns WHERE finished_at IS NOT NULL AND finished_at < UTC_TIMESTAMP(3) - INTERVAL 365 DAY"); },
  };

  return { phoneLinks: phoneLinkDb({ q, tx }), authTokens, emailChanges, accounts, ratings, push, devices, campaigns, playback, playStats, refundRequests, tickets, phoneOtps, phones, settings, errors, credits, referrals };
}
