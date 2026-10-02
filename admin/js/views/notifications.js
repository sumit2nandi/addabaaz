// Broadcast: send an app push notification or an e-mail to viewers (Admin → Broadcast).
// Two channels, one composer each: "App push" reaches phones/tablets (native FCM tokens) and browsers
// that turned notifications on; "E-mail" reaches accounts by their Users-page filter. Sending happens
// in the background, so the page polls the campaign row and shows live progress.
import { api } from '../api.js';
import { empty, html, $, icon, pageHead, toast, errMsg, guard, fmtDT, badge } from '../ui.js';

// Status badge for a campaign row.
const STATUS = { queued: ['Queued', 'warn'], sending: ['Sending…', 'warn'], sent: ['Sent', 'ok'], partial: ['Partly sent', 'warn'], failed: ['Failed', 'bad'], cancelled: ['Cancelled', ''] };
const statusBadge = (s) => badge(...(STATUS[s] || [s, '']));
const CHANNEL = { push: 'App push', email: 'E-mail' };
const k = (n) => (Number(n) || 0).toLocaleString('en-IN');
const done = (s) => ['sent', 'partial', 'failed', 'cancelled'].includes(s);
// One step line in a "not set up yet" card; `parts` alternate text / code.
const step = (...parts) => html`<span>${parts.map((p, i) => (i % 2 ? html`<code>${p}</code>` : p))}</span>`;

export default async function notifications(root, _p, ctx) {
  let channel = 'push';
  let meta = await api.get('/notifications'); if (ctx.stale()) return;
  let timer = null;

  root.innerHTML = html`${pageHead('Broadcast', 'Send an app push notification or an e-mail to your viewers — the way film and series apps announce new releases. Test it on yourself first.')}
    <div class="tabs" id="bctabs">${[['push', 'App push', 'bell'], ['email', 'E-mail', 'mail']].map(([v, l, i]) => html`<button class="tab" data-ch="${v}">${icon(i, 15)} ${l}</button>`)}</div>
    <div id="bcbody"></div>
    <section class="card flush" style="margin-top:16px"><div class="card-head pad"><h2>Recent broadcasts</h2><span class="muted small" id="bclive"></span></div><div id="bchistory"></div></section>`.s;

  const body = $('#bcbody', root), history = $('#bchistory', root), live = $('#bclive', root);
  for (const t of [...root.querySelectorAll('[data-ch]')]) {
    t.classList.toggle('on', t.dataset.ch === channel);
    t.addEventListener('click', () => { channel = t.dataset.ch; for (const x of [...root.querySelectorAll('[data-ch]')]) x.classList.toggle('on', x === t); paint(); });
  }

  /* ---------- recent broadcasts (with live progress while one is sending) ---------- */
  const row = (c) => html`<tr>
    <td>${badge(CHANNEL[c.channel] || c.channel)} <strong>${c.title}</strong><br><small class="muted">${(c.body || '').slice(0, 110)}${(c.body || '').length > 110 ? '…' : ''}</small></td>
    <td class="small">${c.audience}${c.test ? html` ${badge('test')}` : ''}</td>
    <td class="small">${k(c.sent)}${c.total ? html` / ${k(c.total)}` : ''} sent${c.failed ? html` ${badge(`${k(c.failed)} failed`, 'warn')}` : ''}${c.skipped ? html`<br><small class="muted">${k(c.skipped)} skipped</small>` : ''}</td>
    <td>${statusBadge(c.status)}${c.error ? html`<br><small class="muted">${c.error}</small>` : ''}</td>
    <td class="small muted">${fmtDT(c.at || c.createdAt)}<br>${c.by || ''}</td></tr>`;
  const paintHistory = () => {
    const list = meta.campaigns || [];
    history.innerHTML = list.length
      ? html`<table class="tbl compact"><thead><tr><th>Broadcast</th><th>Audience</th><th>Progress</th><th>Status</th><th>When</th></tr></thead><tbody>${list.map(row)}</tbody></table>`.s
      : empty('Nothing broadcast yet.').s;
    const active = list.filter((c) => !done(c.status)).length;
    live.textContent = active ? `${active} sending…` : '';
  };
  // While something is sending, refresh the list every few seconds (and stop when the page changes).
  function schedule() {
    clearTimeout(timer);
    if (!(meta.campaigns || []).some((c) => !done(c.status)) || !history.isConnected) return;
    timer = setTimeout(async () => {
      if (ctx.stale() || !history.isConnected) return;
      try { meta = await api.get('/notifications'); } catch { /* keep the last view */ }
      paintHistory(); schedule();
    }, 3000);
  }

  /* ---------- composer + channel status ---------- */
  const setupCard = (title, steps) => html`<div class="card setup"><h2>${icon('alert', 20)} ${title}</h2>${steps.map((s) => html`<p>${s}</p>`)}</div>`;
  const line = (label, value, sub = '') => html`<div class="row" style="justify-content:space-between;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid var(--border)"><span class="muted small">${label}</span><span><strong>${value}</strong>${sub ? html` <small class="muted">${sub}</small>` : ''}</span></div>`;

  function paint() {
    clearTimeout(timer);
    body.innerHTML = (channel === 'push' ? pushHtml() : emailHtml()).s;
    wire();
    paintHistory(); schedule();
  }

  /* ---------- app push ---------- */
  function pushHtml() {
    const p = meta.push || {};
    const ready = !!(p.web || p.native);
    const setup = ready ? '' : setupCard('Push isn’t set up yet', [
      step('Browsers and the installed web app: generate VAPID keys with ', 'npx web-push generate-vapid-keys', ', then set ', 'VAPID_PUBLIC_KEY', ', ', 'VAPID_PRIVATE_KEY', ' and ', 'VAPID_SUBJECT', '.'),
      step('Phone apps: add your Firebase service account as ', 'FCM_SERVICE_ACCOUNT', ' (the JSON itself) or ', 'FCM_SERVICE_ACCOUNT_FILE', ' (a path) — see docs/MOBILE.md.'),
      'Restart the service, then reload this page.',
    ]);
    return html`${setup}
      <div class="grid two">
        <form class="card" id="bcf" novalidate><div class="card-head"><h2>Send an app notification</h2></div>
          <div class="field"><label for="bc_aud">Send to</label><select id="bc_aud" name="audience">${(meta.audiences || []).map((a) => html`<option value="${a.id}">${a.label}</option>`)}</select></div>
          <div class="field"><label for="bc_t">Title <small class="muted">(max 80)</small></label><input id="bc_t" name="title" maxlength="80" required placeholder="New episode is live"></div>
          <div class="field"><label for="bc_b">Message <small class="muted">(max 180)</small></label><textarea id="bc_b" name="body" rows="3" maxlength="180" required placeholder="Season 2, Episode 1 is now streaming."></textarea></div>
          <div class="field"><label for="bc_u">Opens <small class="muted">(a page on the site, e.g. /show/…)</small></label><input id="bc_u" name="url" value="/" maxlength="300"></div>
          <div class="form-err" id="bc_err" hidden></div>
          <div class="row"><button class="btn primary" type="submit" ${ready ? '' : 'disabled'}>${icon('bell', 16)} Send now</button>
            <button class="btn" type="button" id="bc_test" ${ready ? '' : 'disabled'}>${icon('check', 16)} Send a test to me</button></div>
          <p class="muted small">Notifications appear on the phones and tablets where the app is installed, and in browsers where the viewer allowed them. Every app installation receives the broadcast; browser subscriptions follow the viewer's own preferences. A test goes only to your own devices.</p>
        </form>
        <section class="card"><div class="card-head"><h2>Reach</h2></div>
          ${line('Browsers & web app', k(p.webSubscribers), p.web ? '' : 'not configured')}
          ${line('App installations', k(p.nativeDevices), p.native ? '' : 'not configured')}
          <p class="muted small" style="margin-top:10px">${p.native
            ? 'App push goes through Firebase Cloud Messaging to every device token the apps registered at sign-in.'
            : 'App push needs a Firebase service account (FCM_SERVICE_ACCOUNT or FCM_SERVICE_ACCOUNT_FILE) — see docs/MOBILE.md.'}</p>
        </section>
      </div>`;
  }

  /* ---------- e-mail ---------- */
  function emailHtml() {
    const e = meta.email || {}, auds = e.audiences || [];
    const setup = e.configured ? '' : setupCard('E-mail isn’t set up yet', [
      step('Set ', 'SMTP_URL', ' (for example ', 'smtps://user:pass@smtp.example.com:465', ') and ', 'MAIL_FROM', ', then restart the service.'),
      step('Use ', 'Send a test to me', ' once it is configured — that catches wrong credentials or a blocked port.'),
    ]);
    return html`${setup}
      <div class="grid two">
        <form class="card" id="bcf" novalidate><div class="card-head"><h2>Send an e-mail announcement</h2></div>
          <div class="field"><label for="bc_aud">Send to</label><select id="bc_aud" name="audience">${auds.map((a) => html`<option value="${a.id}">${a.label} — ${k(a.count)} ${a.count === 1 ? 'account' : 'accounts'}</option>`)}</select></div>
          <div class="field"><label for="bc_t">Subject <small class="muted">(max 120)</small></label><input id="bc_t" name="title" maxlength="120" required placeholder="New on ADDABAAZ this week"></div>
          <div class="field"><label for="bc_b">Message <small class="muted">(plain text; a blank line starts a new paragraph)</small></label><textarea id="bc_b" name="body" rows="7" maxlength="4000" required placeholder="Hello!&#10;&#10;Season 2 of your favourite show is streaming now."></textarea></div>
          <div class="field"><label for="bc_u">Button opens <small class="muted">(a page on the site, e.g. /plans)</small></label><input id="bc_u" name="url" value="/" maxlength="300"></div>
          <div class="field"><label for="bc_btn">Button label <small class="muted">(optional)</small></label><input id="bc_btn" name="button" maxlength="40" placeholder="Watch now"></div>
          <div class="form-err" id="bc_err" hidden></div>
          <div class="row"><button class="btn primary" type="submit" ${e.configured ? '' : 'disabled'}>${icon('mail', 16)} <span id="bc_sendlabel">Send now</span></button>
            <button class="btn" type="button" id="bc_test" ${e.configured ? '' : 'disabled'}>${icon('check', 16)} Send a test to me</button></div>
          <p class="muted small">Every message carries a one-click unsubscribe link; people who use it are skipped from then on. Receipts and account e-mails are never affected.</p>
        </form>
        <section class="card"><div class="card-head"><h2>Reach</h2></div>
          ${auds.map((a) => line(a.label, k(a.count)))}
          ${line('Unsubscribed', k(e.optedOut), 'excluded')}
          <p class="muted small" style="margin-top:10px">Sent from <strong>${e.from || '—'}</strong>. Disabled accounts are always skipped.</p>
        </section>
      </div>`;
  }

  /* ---------- wiring ---------- */
  function wire() {
    const form = $('#bcf', body), err = $('#bc_err', body);
    const payload = () => ({ channel, audience: form.audience.value, title: form.title.value, body: form.body.value, url: form.url.value, button: form.button ? form.button.value : '' });
    const label = $('#bc_sendlabel', body);
    const count = () => {
      if (channel !== 'email' || !label) return;
      const a = (meta.email?.audiences || []).find((x) => x.id === form.audience.value);
      label.textContent = `Send to ${k(a?.count)} ${a?.count === 1 ? 'account' : 'accounts'}`;
    };
    if (channel === 'email') { count(); form.audience.addEventListener('change', count); }
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      await guard($('button[type=submit]', form), async () => {
        try {
          const c = await api.post('/notifications/send', payload());
          form.title.value = ''; form.body.value = '';
          meta = await api.get('/notifications');
          paintHistory(); schedule();
          toast(c && c.status === 'failed' ? (c.error || 'The broadcast could not be started.') : 'Queued — sending in the background.', c && c.status === 'failed' ? 'err' : 'ok');
        } catch (x) { err.textContent = errMsg(x); err.hidden = false; }
      });
    });
    $('#bc_test', body)?.addEventListener('click', (e) => guard(e.currentTarget, async () => {
      try { await api.post('/notifications/test', payload()); toast('Test sent to you.'); }
      catch (x) { err.textContent = errMsg(x); err.hidden = false; }
    }));
  }

  paint();
  // Stop the poller once the page has been replaced by a navigation.
  const stop = setInterval(() => { if (ctx.stale() || !root.isConnected) { clearTimeout(timer); clearInterval(stop); } }, 5000);
}
