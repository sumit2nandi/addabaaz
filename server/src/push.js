import crypto from 'node:crypto';

/**
 * Web Push (browsers & installed PWAs). Native Android/iOS push (FCM/APNs) is a separate integration — see docs/ENGAGEMENT.md.
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   generate once:  npx web-push generate-vapid-keys
 *   VAPID_SUBJECT=mailto:office@addabaaz.in
 * Tests inject `sender` (async (subscription, payloadString) => void, throws {statusCode} like web-push does).
 */
// A stable id for a browser push subscription (its endpoint URL is long and secret, so store a hash to look it up).
export const endpointHash = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex');

// `sender` can be injected in tests; otherwise the `web-push` package is loaded lazily on first use.
export function createPush({ db, vapid = {}, sender = null, log = console }) {
  // Push works only when VAPID keys (or a test sender) exist.
  const configured = !!(sender || (vapid.publicKey && vapid.privateKey));
  let wp = null;
  const send = sender || (async (sub, payload) => {
    wp ||= (await import('web-push')).default;
    await wp.sendNotification(sub, payload, { vapidDetails: { subject: vapid.subject || 'mailto:admin@localhost', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 24 * 3600, urgency: 'normal' });
  });
  const svc = {
    configured, publicKey: vapid.publicKey || '',
    /** Sends `message` ({title, body, url, image?, tag?}) to an audience (see db.push.audience). Returns { sent, failed, removed }. */
    async notify(audience, message, { claim = null } = {}) {
      if (!configured) return { sent: 0, failed: 0, removed: 0, skipped: 'not_configured' };
      const subs = await db.push.audience(audience);
      const payload = JSON.stringify({ title: String(message.title || 'ADDABAAZ').slice(0, 80), body: String(message.body || '').slice(0, 180), url: message.url || '/', image: message.image || undefined, tag: message.tag || undefined });
      // With `claim`, each user is notified at most once per (kind, ref); this map avoids repeating the database check per device.
      const decided = new Map();                                    // userId → true if this send is theirs to make (send-once per user, all their devices)
      let sent = 0, failed = 0, removed = 0;
      for (const s of subs) {
        // Skip devices whose user was already notified. On success mark the subscription healthy.
        if (claim) { if (!decided.has(s.userId)) decided.set(s.userId, await db.push.claim(claim.kind, claim.ref, s.userId)); if (!decided.get(s.userId)) continue; }
        try { await send({ endpoint: s.endpoint, keys: s.keys }, payload); sent++; await db.push.ok(s.id); }
        catch (e) {
          // 404/410 mean the browser unsubscribed: delete it. Other errors are counted so dead subscriptions can be found.
          if (e?.statusCode === 404 || e?.statusCode === 410) { await db.push.removeId(s.id); removed++; }   // the browser unsubscribed
          else { failed++; await db.push.failed(s.id); log.warn?.(`[push] send failed (${e?.statusCode || e?.message})`); }
        }
      }
      return { sent, failed, removed };
    },
    /** Run periodically: tell people about new episodes of shows they follow and about launched "Coming soon" titles. Idempotent. */
    async runAutomatic(catalog, { now = Date.now(), lookbackMs = 24 * 3600_000 } = {}) {
      if (!configured) return { episodes: 0, launches: 0 };
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

// Builds the service from VAPID_* environment variables.
export const pushFromEnv = (db, env = process.env) => createPush({ db, vapid: { publicKey: env.VAPID_PUBLIC_KEY || '', privateKey: env.VAPID_PRIVATE_KEY || '', subject: env.VAPID_SUBJECT || (env.SUPPORT_EMAIL ? `mailto:${env.SUPPORT_EMAIL}` : '') } });
