// Broadcast campaigns — the engine behind Admin → Notifications.
//
// A campaign is one broadcast the admin sent, to one audience, over one channel:
//   push   → every web-push subscription AND every registered native device the audience reaches
//            (in one go through push.notify, which already handles claims and dead tokens)
//   email  → every account the audience reaches, in pages, honouring unsubscribes, with an
//            unsubscribe link in each message
//
// Sending runs in the background (the route answers with the campaign id immediately) and the row in
// `campaigns` is updated after every batch, so the console can poll progress. Campaigns left
// unfinished by a deploy or crash are resumed at boot (runScheduledJobs → campaigns.resume()).
import crypto from 'node:crypto';
import { emailKey } from './email-address.js';

/**
 * @param {object}   o
 * @param {object}   o.db       database (campaigns + devices + users)
 * @param {object}   o.push     createPush() service (push channel)
 * @param {object}   o.mailer   mailer (email channel)
 * @param {Function} o.email    (data) => { subject, text, html } — the campaign template (emails.js)
 * @param {object}   o.log
 */
export function createCampaigns({ db, push = null, mailer = null, email = null, log = console, pageSize = 25 }) {
  const running = new Set();                                       // campaign ids being sent right now (per process)
  const pushReady = () => !!(push && (push.configured || push.nativeConfigured));
  const mailReady = () => !!(mailer && mailer.provider === 'smtp');

  /** Push audience descriptors (`news`, `all`, `show:<id>`, `launch:<id>`) become db audiences here. */
  function pushAudience(id, resolve = null) {
    if (resolve) return resolve(id);
    if (id === 'all') return { kind: 'all' };
    if (id === 'news') return { kind: 'news' };
    return null;
  }

  async function runPush(campaign, { resolveAudience }) {
    const audience = pushAudience(campaign.audience, resolveAudience);
    if (!audience) { await db.campaigns.finish(campaign.id, 'failed', 'Unknown audience.'); return db.campaigns.get(campaign.id); }
    try {
      const r = await push.notify(audience, { title: campaign.title, body: campaign.body, url: campaign.url || '/', tag: `campaign-${campaign.id}` });
      const total = (r.sent || 0) + (r.failed || 0) + (r.removed || 0);
      await db.campaigns.progress(campaign.id, { sent: r.sent, failed: r.failed, skipped: r.removed, total });
      await db.campaigns.finish(campaign.id, r.failed && !r.sent ? 'failed' : (r.failed ? 'partial' : 'sent'));
    } catch (e) {
      log.error?.(`[campaigns] push ${campaign.id} failed: ${e.message}`);
      await db.campaigns.finish(campaign.id, 'failed', e.message);
    }
    return db.campaigns.get(campaign.id);
  }

  async function runEmail(campaign, { unsubscribeUrlFor, siteUrl }) {
    let cursor = campaign.cursor || 0, total = campaign.total || 0;
    let sent = 0, failed = 0, skipped = 0;                          // deltas since the last progress() call
    // One message per ADDRESS: two account rows that share an address (legacy duplicates, which the
    // admin merge in Admin → Users cleans up) must not receive the same e-mail twice.
    const seen = new Set();
    try {
      for (;;) {
        const page = await db.adminUsers.emailAudience(campaign.audience, { limit: pageSize, offset: cursor });
        if (!page.length) break;
        for (const u of page) {
          const address = emailKey(u.email);
          if (seen.has(address)) { skipped++; continue; }
          seen.add(address);
          try {
            const message = email({ name: u.name, email: u.email, subject: campaign.title, body: campaign.body, button: campaign.button ? { label: campaign.button, url: campaign.url } : null, siteUrl, unsubscribeUrl: unsubscribeUrlFor ? unsubscribeUrlFor(u) : '' });
            const r = await mailer.send({ to: u.email, ...message });
            if (r?.sent) sent++; else skipped++;
          } catch (e) {
            failed++; log.warn?.(`[campaigns] email to ${u.email} failed: ${e.message}`);
          }
        }
        cursor += page.length;
        total = Math.max(total, cursor);                            // people signing up mid-send extend the audience
        await db.campaigns.progress(campaign.id, { sent, failed, skipped, total, cursor });
        sent = failed = skipped = 0;
        if (page.length < pageSize) break;
      }
      const done = await db.campaigns.get(campaign.id);
      await db.campaigns.finish(campaign.id, done.failed && !done.sent ? 'failed' : (done.failed ? 'partial' : 'sent'));
    } catch (e) {
      log.error?.(`[campaigns] email ${campaign.id} failed: ${e.message}`);
      await db.campaigns.finish(campaign.id, 'failed', e.message);
    }
    return db.campaigns.get(campaign.id);
  }

  const svc = {
    /** Creates the campaign row and starts sending in the background. Returns the campaign as it was queued. */
    async start({ channel, audience, title, body, url = null, button = null, by = null }, opts = {}) {
      const ready = channel === 'push' ? pushReady() : mailReady();
      const campaign = { id: crypto.randomUUID(), channel, audience, title, body, url, button, by };
      await db.campaigns.create({ ...campaign, status: ready ? 'queued' : 'failed' });
      if (!ready) {
        await db.campaigns.finish(campaign.id, 'failed', channel === 'push' ? 'Push is not configured on this server.' : 'E-mail is not configured on this server.');
        return db.campaigns.get(campaign.id);
      }
      const id = campaign.id;
      setImmediate(() => svc.run(id, opts).catch((e) => log.error?.(`[campaigns] ${id}: ${e.message}`)));
      return db.campaigns.get(id);
    },
    /** Runs (or continues) a campaign now. The same id never runs twice in parallel inside one process. */
    async run(id, opts = {}) {
      if (running.has(id)) return db.campaigns.get(id);
      const campaign = await db.campaigns.get(id);
      if (!campaign || campaign.status === 'sent' || campaign.status === 'cancelled' || campaign.status === 'failed') return campaign;
      running.add(id);
      try {
        return campaign.channel === 'push' ? await runPush(campaign, opts) : await runEmail(campaign, opts);
      } finally { running.delete(id); }
    },
    /** Sends one test message to the admin who asked — never to the audience, never recorded as a campaign. */
    async sendTest({ channel, to, userId, name = 'there', title, body, url = null, button = null, siteUrl, unsubscribeUrlFor }) {
      if (channel === 'push') {
        if (!pushReady()) return { ok: false, error: 'Push is not configured on this server.' };
        const r = await push.notify({ kind: 'user', userId }, { title, body, url: url || '/', tag: 'campaign-test' });
        const delivered = (r.sent || 0) + (r.removed || 0);
        return delivered ? { ok: true, delivered } : { ok: false, error: 'No push-enabled device found for your account. Open the site/app and allow notifications first.' };
      }
      if (!mailReady()) return { ok: false, error: 'E-mail is not configured on this server.' };
      const message = email({ name, email: to, subject: `[TEST] ${title}`, body, button: button ? { label: button, url } : null, siteUrl, unsubscribeUrl: unsubscribeUrlFor ? unsubscribeUrlFor({ id: userId, email: to }) : '' });
      const r = await mailer.send({ to, ...message });
      return r?.sent ? { ok: true } : { ok: false, error: 'The mail server did not accept the message.' };
    },
    /** At boot: continue campaigns a deploy or crash left unfinished. */
    async resume(opts = {}) {
      const left = await db.campaigns.unfinished().catch(() => []);
      if (!left.length) return 0;
      log.log?.(`[campaigns] resuming ${left.length} unfinished campaign(s)`);
      for (const c of left) setImmediate(() => svc.run(c.id, opts).catch((e) => log.error?.(`[campaigns] ${c.id}: ${e.message}`)));
      return left.length;
    },
    /** Progress row for the console's poller. */
    async status(id) { return db.campaigns.get(id); },
  };
  return svc;
}
