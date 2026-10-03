// Broadcast campaigns — the engine behind Admin → Notifications.
//
// A campaign is one broadcast the admin sent, to one audience, over one channel:
//   push   → every web-push subscription AND every registered native device the audience reaches
//            (in one go through push.notify, which already handles claims and dead tokens)
//   email  → every account the audience reaches, in pages, honouring unsubscribes, with an
//            unsubscribe link in each message
//
// Sending runs in the background. Progress and a database-backed lease let multiple instances
// safely resume work after a deploy or crash without starting duplicate workers.
import crypto from 'node:crypto';
import { emailKey } from './email-address.js';

const LEASE_SECONDS = 300;
const HEARTBEAT_MS = 60_000;
const leaseLost = () => Object.assign(new Error('Campaign lease was lost.'), { code: 'campaign_lease_lost' });
// Devices (and mail clients) fetch the picture themselves, so a site-relative upload path has to become
// an absolute URL before the message leaves the server.
const absoluteImage = (image, siteUrl = '') => {
  const v = String(image || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const base = String(siteUrl || '').replace(/\/+$/, '');
  return base ? `${base}${v.startsWith('/') ? '' : '/'}${v}` : v;
};

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

  async function runPush(campaign, { resolveAudience, claimToken, renewLease, siteUrl = '' }) {
    const finish = (status, error = null) => db.campaigns.finish(campaign.id, status, error, claimToken);
    const audience = pushAudience(campaign.audience, resolveAudience);
    if (!audience) { await finish('failed', 'Unknown audience.'); return db.campaigns.get(campaign.id); }
    try {
      await renewLease();
      const r = await push.notify(audience, {
        title: campaign.title, body: campaign.body, url: campaign.url || '/', tag: `campaign-${campaign.id}`,
        image: absoluteImage(campaign.imageUrl, siteUrl),   // devices load the picture themselves: it must be an absolute URL
      });
      const total = (r.sent || 0) + (r.failed || 0) + (r.removed || 0);
      const recorded = await db.campaigns.progress(campaign.id, { sent: r.sent, failed: r.failed, skipped: r.removed, total }, claimToken);
      if (!recorded) throw leaseLost();
      await finish(r.failed && !r.sent ? 'failed' : (r.failed ? 'partial' : 'sent'));
    } catch (e) {
      if (e.code !== 'campaign_lease_lost') {
        log.error?.(`[campaigns] push ${campaign.id} failed: ${e.message}`);
        await finish('failed', e.message);
      }
    }
    return db.campaigns.get(campaign.id);
  }

  async function runEmail(campaign, { unsubscribeUrlFor, siteUrl, claimToken, renewLease }) {
    let cursor = campaign.cursor || 0, total = campaign.total || 0;
    let sent = 0, failed = 0, skipped = 0;                          // deltas since the last progress() call
    // One message per ADDRESS: two account rows that share an address (legacy duplicates, which the
    // admin merge in Admin → Users cleans up) must not receive the same e-mail twice.
    const seen = new Set();
    const finish = (status, error = null) => db.campaigns.finish(campaign.id, status, error, claimToken);
    try {
      for (;;) {
        const page = await db.adminUsers.emailAudience(campaign.audience, { limit: pageSize, offset: cursor });
        if (!page.length) break;
        for (const u of page) {
          const address = emailKey(u.email);
          if (seen.has(address)) { skipped++; continue; }
          seen.add(address);
          try {
            // Renew per recipient as well as on the timer; a slow SMTP call cannot silently outlive the lease.
            await renewLease();
            const message = email({ name: u.name, email: u.email, subject: campaign.title, body: campaign.body, button: campaign.button ? { label: campaign.button, url: campaign.url } : null, siteUrl, unsubscribeUrl: unsubscribeUrlFor ? unsubscribeUrlFor(u) : '', image: absoluteImage(campaign.imageUrl, siteUrl), imageAlt: campaign.imageAlt || '' });
            const r = await mailer.send({ to: u.email, ...message });
            if (r?.sent) sent++; else skipped++;
          } catch (e) {
            if (e.code === 'campaign_lease_lost') throw e;
            failed++; log.warn?.(`[campaigns] email to ${u.email} failed: ${e.message}`);
          }
        }
        cursor += page.length;
        total = Math.max(total, cursor);                            // people signing up mid-send extend the audience
        const recorded = await db.campaigns.progress(campaign.id, { sent, failed, skipped, total, cursor }, claimToken);
        if (!recorded) throw leaseLost();
        sent = failed = skipped = 0;
        if (page.length < pageSize) break;
      }
      const done = await db.campaigns.get(campaign.id);
      await finish(done.failed && !done.sent ? 'failed' : (done.failed ? 'partial' : 'sent'));
    } catch (e) {
      if (e.code !== 'campaign_lease_lost') {
        log.error?.(`[campaigns] email ${campaign.id} failed: ${e.message}`);
        await finish('failed', e.message);
      }
    }
    return db.campaigns.get(campaign.id);
  }

  const svc = {
    /** Creates the campaign row and starts sending in the background. Returns the campaign as it was queued. */
    async start({ channel, audience, title, body, url = null, button = null, imageUrl = null, imageAlt = null, by = null }, opts = {}) {
      const ready = channel === 'push' ? pushReady() : mailReady();
      const campaign = { id: crypto.randomUUID(), channel, audience, title, body, url, button, imageUrl, imageAlt, by };
      await db.campaigns.create({ ...campaign, status: ready ? 'queued' : 'failed' });
      if (!ready) {
        await db.campaigns.finish(campaign.id, 'failed', channel === 'push' ? 'Push is not configured on this server.' : 'E-mail is not configured on this server.');
        return db.campaigns.get(campaign.id);
      }
      const id = campaign.id;
      setImmediate(() => svc.run(id, opts).catch((e) => log.error?.(`[campaigns] ${id}: ${e.message}`)));
      return db.campaigns.get(id);
    },
    /** Runs (or continues) a campaign now. A database lease prevents parallel runs across instances. */
    async run(id, opts = {}) {
      if (running.has(id)) return db.campaigns.get(id);
      const current = await db.campaigns.get(id);
      if (!current || ['sent', 'partial', 'cancelled', 'failed'].includes(current.status)) return current;

      const claimToken = crypto.randomUUID();
      if (!(await db.campaigns.claim(id, claimToken, LEASE_SECONDS))) return db.campaigns.get(id);
      const campaign = await db.campaigns.get(id);
      if (!campaign) return null;
      running.add(id);

      let leaseLostAlready = false, renewing = false;
      const renewLease = async () => {
        if (leaseLostAlready) throw leaseLost();
        try {
          const ok = await db.campaigns.renew(id, claimToken, LEASE_SECONDS);
          if (!ok) { leaseLostAlready = true; throw leaseLost(); }
        } catch (e) {
          leaseLostAlready = true;
          if (e.code === 'campaign_lease_lost') throw e;
          log.warn?.(`[campaigns] lease renewal ${id} failed: ${e.message}`);
          throw leaseLost();
        }
      };
      const heartbeat = setInterval(async () => {
        if (renewing || leaseLostAlready) return;
        renewing = true;
        try {
          if (!(await db.campaigns.renew(id, claimToken, LEASE_SECONDS))) leaseLostAlready = true;
        } catch (e) {
          leaseLostAlready = true;
          log.warn?.(`[campaigns] lease renewal ${id} failed: ${e.message}`);
        } finally { renewing = false; }
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      try {
        const runOpts = { ...opts, claimToken, renewLease };
        return campaign.channel === 'push' ? await runPush(campaign, runOpts) : await runEmail(campaign, runOpts);
      } finally { clearInterval(heartbeat); running.delete(id); }
    },
    /** Sends one test message to the admin who asked — never to the audience, never recorded as a campaign. */
    async sendTest({ channel, to, userId, name = 'there', title, body, url = null, button = null, imageUrl = null, imageAlt = null, siteUrl, unsubscribeUrlFor }) {
      if (channel === 'push') {
        if (!pushReady()) return { ok: false, error: 'Push is not configured on this server.' };
        const r = await push.notify({ kind: 'user', userId }, { title, body, url: url || '/', tag: 'campaign-test', image: absoluteImage(imageUrl, siteUrl) });
        const delivered = (r.sent || 0) + (r.removed || 0);
        return delivered ? { ok: true, delivered } : { ok: false, error: 'No push-enabled device found for your account. Open the site/app and allow notifications first.' };
      }
      if (!mailReady()) return { ok: false, error: 'E-mail is not configured on this server.' };
      const message = email({ name, email: to, subject: `[TEST] ${title}`, body, button: button ? { label: button, url } : null, siteUrl, unsubscribeUrl: unsubscribeUrlFor ? unsubscribeUrlFor({ id: userId, email: to }) : '', image: absoluteImage(imageUrl, siteUrl), imageAlt: imageAlt || '' });
      const r = await mailer.send({ to, ...message });
      return r?.sent ? { ok: true } : { ok: false, error: 'The mail server did not accept the message.' };
    },
    /** At boot: continue campaigns a deploy or crash interrupted; claim() arbitrates multi-instance races. */
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
