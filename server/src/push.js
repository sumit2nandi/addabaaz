import crypto from 'node:crypto';

/**
 * Push delivery to every device a viewer has:
 *   - Web Push (browsers & installed PWAs) with VAPID keys — push_subscriptions,
 *   - native app push (Android/iOS apps, FCM) — push_devices, sent through fcm.js.
 * Either channel can be missing; the service reports which ones are configured and sends through
 * whichever are.
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   generate once:  npx web-push generate-vapid-keys
 *   VAPID_SUBJECT=mailto:office@addabaaz.in
 *   FCM_SERVICE_ACCOUNT[_FILE]             Firebase service account (see fcm.js)
 * Tests inject `sender` (async (subscription, payloadString) => void, throws {statusCode} like web-push does)
 * and `fcm` (anything with { configured, send(tokens, message) }).
 */
/**
 * The payload a browser notification carries — the ONE place it is defined, so what the Broadcast page
 * previews is byte-for-byte what viewers receive. Lengths match the platform limits (title 80, body 180).
 * The service worker (sw.js) renders `image` as the rich notification picture.
 */
export function notificationPayload({ title, body, url, image, tag } = {}) {
  return {
    title: String(title || 'ADDABAAZ').slice(0, 80),
    body: String(body || '').slice(0, 180),
    url: String(url || '/'),
    ...(image ? { image: String(image) } : {}),
    ...(tag ? { tag: String(tag) } : {}),
  };
}

// A stable id for a browser push subscription (its endpoint URL is long and secret, so store a hash to look it up).
export const endpointHash = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex');

// `sender` can be injected in tests; otherwise the `web-push` package is loaded lazily on first use.
export function createPush({ db, vapid = {}, sender = null, fcm = null, log = console }) {
  // Push works only when VAPID keys (or a test sender) exist.
  const configured = !!(sender || (vapid.publicKey && vapid.privateKey));
  let wp = null;
  const send = sender || (async (sub, payload) => {
    wp ||= (await import('web-push')).default;
    await wp.sendNotification(sub, payload, { vapidDetails: { subject: vapid.subject || 'mailto:admin@localhost', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 24 * 3600, urgency: 'normal' });
  });
  // Native app push (FCM). Absent in tests that only exercise Web Push, and when FCM_SERVICE_ACCOUNT is not set.
  const nativeConfigured = !!fcm?.configured;
  /** Sends `message` to native rows after audience/claim filtering; tokens stay inside this service. */
  async function notifyNative(rows, message, onDelivery = null) {
    if (!nativeConfigured || !rows.length) return { sent: 0, failed: 0, removed: 0 };
    const report = async (row, status, error = null) => {
      if (!onDelivery) return;
      const platform = ({ android: 'Android', ios: 'iOS', web: 'Web' })[row.platform] || 'App';
      await onDelivery({
        recipientKey: row.tokenHash || row.token, userId: row.userId || null,
        name: row.name || (row.userId ? null : 'Guest device'), email: row.email || null,
        transport: 'app_push', destination: `${platform}${row.label ? ` · ${row.label}` : ''}`,
        status, error,
      });
    };
    for (const row of rows) await report(row, 'pending');

    let r;
    try {
      r = await fcm.send(rows.map((row) => row.token), { title: message.title, body: message.body, url: message.url, image: message.image, tag: message.tag });
    } catch (e) {
      const reason = `FCM delivery failed: ${String(e?.message || e || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 400)}`;
      for (const row of rows) await report(row, 'failed', reason);
      log.warn?.(`[push] native send failed: ${e.message}`);
      return { sent: 0, failed: rows.length, removed: 0 };
    }

    const dead = new Set(r.dead || []), byToken = new Map((r.results || []).map((item) => [item.token, item]));
    let successBudget = Number(r.sent) || 0, failureBudget = Number(r.failed) || 0;
    let sent = 0, failed = 0, removed = 0;
    for (const row of rows) {
      let result = byToken.get(row.token);
      if (!result) {
        if (dead.has(row.token)) result = { ok: false, dead: true };
        else if (successBudget > 0) { result = { ok: true }; successBudget--; }
        else if (failureBudget > 0) { result = { ok: false, dead: false }; failureBudget--; }
        else result = { ok: false, dead: false, error: 'No delivery result was returned.' };
      }
      if (result.ok) { sent++; await report(row, 'sent'); }
      else if (result.dead) {
        removed++; await report(row, 'skipped', 'Device token is expired or no longer registered.');
      } else {
        failed++;
        const reason = String(result.error || 'FCM delivery failed').replace(/[\r\n]+/g, ' ').slice(0, 400);
        await report(row, 'failed', reason);
      }
    }
    if (dead.size) for (const token of dead) await db.devices.removeHash(endpointHash(token)).catch(() => {});
    return { sent, failed, removed };
  }

  const svc = {
    configured, nativeConfigured, publicKey: vapid.publicKey || '',
    /** Sends `message` ({title, body, url, image?, tag?}) to an audience. `onDelivery` is an optional private campaign-reporting callback. */
    async notify(audience, message, { claim = null, onDelivery = null } = {}) {
      // Both channels are looked up first: a send-once claim (automatic notifications) must be decided
      // ONCE per user and then applied to their browser subscriptions AND their app devices together.
      const subs = configured ? await db.push.audience(audience) : [];
      const rows = nativeConfigured ? await db.devices.audienceFor(audience).catch((e) => { log.warn?.(`[push] app audience failed: ${e.message}`); return []; }) : [];
      let allowedNative = rows, keptSubs = subs;
      if (claim) {
        const decided = new Map();
        for (const userId of new Set([...subs.map((s) => s.userId), ...rows.map((r) => r.userId)])) decided.set(userId, await db.push.claim(claim.kind, claim.ref, userId));
        allowedNative = rows.filter((r) => decided.get(r.userId));
        keptSubs = subs.filter((s) => decided.get(s.userId));
      }
      const native = await notifyNative(allowedNative, message, onDelivery).catch((e) => { log.warn?.(`[push] native send failed: ${e.message}`); return { sent: 0, failed: 0, removed: 0 }; });
      if (!configured) return { sent: native.sent, failed: native.failed, removed: native.removed, native, skipped: 'not_configured' };
      const payload = JSON.stringify(notificationPayload(message));
      let sent = 0, failed = 0, removed = 0;
      for (const s of keptSubs) {
        const report = async (status, error = null) => onDelivery?.({
          recipientKey: s.id, userId: s.userId || null, name: s.name || null, email: s.email || null,
          transport: 'web_push', destination: 'Browser / web app', status, error,
        });
        await report('pending');
        try {
          await send({ endpoint: s.endpoint, keys: s.keys }, payload);
          sent++; await db.push.ok(s.id); await report('sent');
        } catch (e) {
          // 404/410 mean the browser unsubscribed: delete it. Other errors are counted so dead subscriptions can be found.
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await db.push.removeId(s.id); removed++; await report('skipped', 'Push subscription expired or was removed.');
          } else {
            failed++; await db.push.failed(s.id);
            const reason = e?.statusCode ? `Web Push HTTP ${e.statusCode}` : `Web Push delivery failed${e?.code ? ` (${String(e.code).slice(0, 40)})` : ''}`;
            await report('failed', reason);
            log.warn?.(`[push] send failed (${e?.statusCode || e?.message})`);
          }
        }
      }
      return { sent: sent + native.sent, failed: failed + native.failed, removed: removed + native.removed, native };
    },
    /** Run periodically: tell people about new episodes of shows they follow and about launched "Coming soon" titles. Idempotent. */
    async runAutomatic(catalog, { now = Date.now(), lookbackMs = 24 * 3600_000 } = {}) {
      if (!configured && !nativeConfigured) return { episodes: 0, launches: 0 };
      const shows = new Map((catalog.shows || []).map((x) => [x.id, x]));   // `catalog` = the public snapshot's { shows, videos, upcoming }
      // Small helper view over the catalog for the loops below.
      const cat = {
        videos: catalog.videos || [], upcoming: catalog.upcoming || [], show: (id) => shows.get(id),
        episodes: (id) => (catalog.videos || []).filter((v) => v.kind === 'episode' && v.showId === id),
        displayTitle: (v) => { const t = String(v.shortTitle || v.title || ''); return t.length > 100 ? `${t.slice(0, 97)}…` : t; },
      };
      let episodes = 0, launches = 0;
      // New episodes: for each recent episode, notify people who follow the show (My List) or watched it.
      for (const v of cat.videos) {
        if (v.kind !== 'episode' || !v.showId || now - Date.parse(v.publishedAt) > lookbackMs || Date.parse(v.publishedAt) > now) continue;
        const show = cat.show(v.showId); if (!show) continue;
        const ids = cat.videos.filter((x) => x.showId === show.id).map((x) => x.id);
        const r = await svc.notify({ kind: 'episodes', showId: show.id, videoIds: ids }, { title: `New: ${show.titleEn || show.title}${v.episode ? ` EP ${v.episode}` : ''}`, body: cat.displayTitle(v), url: `/watch/${v.id}`, tag: `ep-${v.id}` }, { claim: { kind: 'episode', ref: v.id } });
        episodes += r.sent;
      }
      // Launches: notify people who set a reminder once the upcoming show has an episode.
      for (const u of cat.upcoming) {
        const show = u.showId && cat.show(u.showId); if (!show || !cat.episodes(show.id).length) continue;
        const r = await svc.notify({ kind: 'launches', upcomingId: u.id }, { title: `${show.titleEn || show.title} is now streaming`, body: show.tagline || 'Watch the first episode now.', url: `/show/${show.id}`, tag: `launch-${u.id}` }, { claim: { kind: 'launch', ref: u.id } });
        launches += r.sent;
      }
      return { episodes, launches };
    },
  };
  return svc;
}

// Builds the service from the VAPID_* and FCM_SERVICE_ACCOUNT* environment variables.
export const pushFromEnv = (db, env = process.env, { fcm = null } = {}) => createPush({
  db, fcm,
  vapid: { publicKey: env.VAPID_PUBLIC_KEY || '', privateKey: env.VAPID_PRIVATE_KEY || '', subject: env.VAPID_SUBJECT || (env.SUPPORT_EMAIL ? `mailto:${env.SUPPORT_EMAIL}` : '') },
});
