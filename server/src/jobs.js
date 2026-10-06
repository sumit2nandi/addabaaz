/**
 * The once-a-minute housekeeping job (started by index.js; tests call it directly).
 * Everything here is safe to run on several servers at once: notifications are claimed per user in MySQL, purges are idempotent.
 */
// `db`, `catalog`, `push` and `campaigns` are passed in (dependency injection) so tests can supply fakes.
// Returns counts of notifications sent.
export async function runScheduledJobs({ db, catalog, push, campaigns = null, promos = null, applicationMonitor = null, log = console }) {
  const out = { episodes: 0, launches: 0 };
  // Save per-process application metrics before housekeeping work affects this sample window.
  if (applicationMonitor?.takeSnapshot && db.applicationMonitoring?.record) {
    try { await db.applicationMonitoring.record(applicationMonitor.takeSnapshot()); }
    catch (e) { log.error?.('[jobs] application monitor failed:', e); }
  }
  // Save one low-cardinality database sample every minute for Admin → System → Database history.
  // Keep it independent of notification/cleanup failures so a bad job does not leave gaps in the charts.
  if (db.monitoring?.collect) {
    try { await db.monitoring.collect(); }
    catch (e) { log.error?.('[jobs] database monitor failed:', e); }
  }
  try {
    const snap = await catalog.get();   // the public snapshot: scheduled items appear once due
    // Send scheduled push notifications (new episodes, launches) if push is configured.
    if (push?.configured || push?.nativeConfigured) Object.assign(out, await push.runAutomatic(snap.catalog));
    // Purge expired tokens, stale playback/push records, old diagnostics and one-year-old support, contact and campaign records.
    await Promise.all([db.authTokens.purge(), db.phoneOtps?.purge?.(), db.playback.purge(), db.errors.prune(), db.push.pruneSent(), db.devices.purge(), db.tickets?.prune?.(), db.messages?.prune?.(), db.campaigns.prune()]);
    // Continue broadcasts a deploy or crash interrupted.
    out.campaigns = await (campaigns?.resume({ resolveAudience: audienceResolver(snap.catalog) }) ?? 0);
    // Promotions: expire credit whose time ran out and hand back credit held by abandoned orders.
    if (promos) out.promos = await promos.runMaintenance().catch((e) => { log.error?.('[jobs] promo maintenance failed:', e); return null; });
  } catch (e) { log.error?.('[jobs] scheduled work failed:', e); }
  return out;
}

/**
 * Turns a campaign audience id (`news`, `all`, `show:<id>`, `launch:<id>`) into the descriptor
 * db.push.audience expects. Used when an interrupted broadcast is resumed at boot.
 */
export function audienceResolver(catalog) {
  return (id) => {
    if (id === 'all') return { kind: 'all' };
    if (id === 'news') return { kind: 'news' };
    const m = /^(show|launch):(.+)$/.exec(String(id));
    if (!m) return null;
    if (m[1] === 'launch') return { kind: 'launches', upcomingId: m[2] };
    if (!(catalog.shows || []).some((s) => s.id === m[2])) return null;
    const videoIds = (catalog.videos || []).filter((v) => v.showId === m[2]).map((v) => v.id);
    return { kind: 'episodes', showId: m[2], videoIds };
  };
}
