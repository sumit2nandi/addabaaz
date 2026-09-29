import { api } from '../api.js';
import { empty, html, $, icon, pageHead, toast, errMsg, guard, fmtDT, badge } from '../ui.js';

export default async function notifications(root, _p, ctx) {
  const n = await api.get('/notifications'); if (ctx.stale()) return;
  root.innerHTML = html`${pageHead('Notifications', 'Send a web-push message to viewers who turned notifications on. New episodes and launch reminders are sent automatically.')}
    ${n.configured ? '' : html`<div class="card setup"><h2>${icon('alert', 20)} Push isn’t set up yet</h2><p>Generate VAPID keys with <code>npx web-push generate-vapid-keys</code>, then set <code>VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code> and <code>VAPID_SUBJECT</code>. See docs/ENGAGEMENT.md.</p></div>`}
    <div class="grid two"><form class="card" id="nf" novalidate><div class="card-head"><h2>Send a notification</h2><span class="muted small">${n.subscribers.toLocaleString('en-IN')} device${n.subscribers === 1 ? '' : 's'} subscribed</span></div>
      <div class="field"><label for="n_aud">Send to</label><select id="n_aud" name="audience">${n.audiences.map((a) => html`<option value="${a.id}">${a.label}</option>`)}</select></div>
      <div class="field"><label for="n_t">Title <small class="muted">(max 80)</small></label><input id="n_t" name="ntitle" maxlength="80" required></div>
      <div class="field"><label for="n_b">Message <small class="muted">(max 180)</small></label><textarea id="n_b" name="nbody" rows="3" maxlength="180" required></textarea></div>
      <div class="field"><label for="n_u">Opens <small class="muted">(a page on the site, e.g. /show/…)</small></label><input id="n_u" name="nurl" value="/" maxlength="300"></div>
      <div class="form-err" id="nerr" hidden></div>
      <button class="btn primary" type="submit" ${n.configured ? '' : 'disabled'}>${icon('bell', 16)} Send now</button></form>
    <section class="card flush"><div class="card-head pad"><h2>Recent sends</h2></div>${n.history.length ? html`<table class="tbl compact"><tbody>${n.history.map((h) => html`<tr><td><strong>${h.title || '—'}</strong><br><small class="muted">${h.audience} · ${h.by}</small></td><td class="small">${h.sent ?? 0} sent${h.failed ? html` · ${badge(`${h.failed} failed`, 'warn')}` : ''}</td><td class="small muted">${fmtDT(h.at)}</td></tr>`)}</tbody></table>` : empty('Nothing sent yet.')}</section></div>`.s;
  const f = $('#nf', root), err = $('#nerr', root);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true;
    await guard($('button', f), async () => {
      try { const r = await api.post('/notifications/send', { audience: f.audience.value, title: f.ntitle.value, body: f.nbody.value, url: f.nurl.value });
        toast(`Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}${r.removed ? ` (${r.removed} expired subscriptions cleaned up)` : ''}`); f.ntitle.value = ''; f.nbody.value = ''; }
      catch (x) { err.textContent = errMsg(x); err.hidden = false; }
    });
  });
}
