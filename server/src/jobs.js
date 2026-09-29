/**
 * The once-a-minute housekeeping job (started by index.js; tests call it directly).
 * Everything here is safe to run on several servers at once: notifications are claimed per user in MySQL, purges are idempotent.
 */
export async function runScheduledJobs({ db, catalog, push, log = console }) {
  const out = { episodes: 0, launches: 0 };
  try {
    if (push?.configured) Object.assign(out, await push.runAutomatic((await catalog.get()).catalog));   // the public snapshot: scheduled items appear once due
    await Promise.all([db.authTokens.purge(), db.playback.purge(), db.errors.prune(), db.push.pruneSent()]);
  } catch (e) { log.error?.(`[jobs] ${e.message}`); }
  return out;
}
