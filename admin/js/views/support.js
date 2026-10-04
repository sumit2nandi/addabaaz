// Support queue (Admin → Support): the tickets viewers raise from the site's Support page.
//
// List with filters (needs an answer / in progress / resolved / closed), search, and a conversation view
// where an admin can reply (the reply is e-mailed to the viewer when SMTP is configured), change status
// and priority, keep an internal note, or delete the ticket.
import { api } from '../api.js';
import { html, $, $$, icon, badge, empty, pager, pageHead, guard, toast, errMsg, fmtDT, ago, openModal, confirmBox } from '../ui.js';

const LIMIT = 25;
const CATS = [['all', 'All topics'], ['signin', 'Sign-in'], ['registration', 'Registration'], ['payment', 'Payment'], ['playback', 'Playback'], ['content', 'Content'], ['account', 'Account'], ['other', 'Other']];
const STATUS = { open: ['Needs an answer', 'warn'], pending: ['Waiting on viewer', ''], resolved: ['Resolved', 'ok'], closed: ['Closed', ''] };
const PRIO = { low: ['Low', ''], normal: ['Normal', ''], high: ['High', 'err'] };

export default async function support(root, _p, ctx) {
  const st = { status: 'awaiting', category: 'all', q: '', offset: 0 };
  // 'awaiting' is a console-side view of 'open' + 'pending' — the server filters by one status at a time.
  const load = async () => {
    const qs = st.status === 'awaiting' ? 'status=open' : `status=${st.status}`;
    const r = await api.get(`/tickets?${qs}&category=${st.category}&q=${encodeURIComponent(st.q)}&limit=${LIMIT}&offset=${st.offset}`).catch((e) => ({ error: errMsg(e) }));
    if (ctx.stale()) return;
    if (r.error) { root.innerHTML = html`${pageHead('Support', 'Tickets raised from the Support page.')}<div class="card">${empty(r.error)}</div>`.s; return; }
    const counts = r.counts || {};
    const tabs = [['awaiting', `Needs an answer${counts.open ? ` (${counts.open})` : ''}`], ['pending', 'Waiting on viewer'], ['resolved', 'Resolved'], ['closed', 'Closed'], ['all', 'All']];
    root.innerHTML = html`${pageHead('Support', 'Tickets raised from the Support page on the site or in the app.')}
      <div class="tabs">${tabs.map(([v, l]) => html`<button class="tab ${st.status === v ? 'on' : ''}" data-tab="${v}">${l}</button>`)}</div>
      <div class="filters">
        <input type="search" id="tkQ" value="${st.q}" placeholder="Search subject, message, name or e-mail" aria-label="Search tickets">
        <select id="tkCat" aria-label="Topic">${CATS.map(([v, l]) => html`<option value="${v}" ${st.category === v ? 'selected' : ''}>${l}</option>`)}</select>
      </div>
      ${r.items?.length ? r.items.map(ticketCard).join('') : html`<div class="card">${empty(st.status === 'awaiting' ? 'No tickets waiting for an answer. 🎉' : 'Nothing here.')}</div>`}
      ${pager({ total: r.total, offset: st.offset, limit: LIMIT })}`.s;

    $$('[data-tab]', root).forEach((b) => b.onclick = () => { st.status = b.dataset.tab; st.offset = 0; load(); });
    $('#tkCat', root).onchange = (e) => { st.category = e.target.value; st.offset = 0; load(); };
    let deb;
    $('#tkQ', root).oninput = (e) => { clearTimeout(deb); const v = e.target.value; deb = setTimeout(() => { st.q = v.trim(); st.offset = 0; load(); }, 350); };
    $$('[data-page]', root).forEach((b) => b.onclick = () => { st.offset = Number(b.dataset.page); load(); });
    // Opening a ticket: the button, the card, or Enter on a focused card. Links and buttons inside the
    // card keep their own behaviour (mailto:, quick resolve).
    $$('[data-open]', root).forEach((b) => b.onclick = (e) => { e.stopPropagation(); openTicket(b.dataset.open, load); });
    $$('[data-ticket]', root).forEach((c) => {
      c.onclick = (e) => { if (e.target.closest('a, button')) return; openTicket(c.dataset.ticket, load); };
      c.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a, button')) { e.preventDefault(); openTicket(c.dataset.ticket, load); } };
    });
    // Quick triage straight from the list: resolve or reopen without opening the conversation.
    $$('[data-close-ticket]', root).forEach((b) => b.onclick = (e) => { e.stopPropagation(); guard(b, async () => { await api.patch(`/tickets/${b.dataset.closeTicket}`, { status: 'resolved' }); toast('Marked resolved'); await load(); ctx.refreshCounts(); }); });
  };
  await load();
}

const ticketCard = (t) => {
  const [label, kind] = STATUS[t.status] || [t.status, ''];
  const [plabel, pkind] = PRIO[t.priority] || PRIO.normal;
  const topic = (CATS.find(([v]) => v === t.category)?.[1] || 'Other').toLowerCase();
  return html`<article class="card tk" data-ticket="${t.id}" role="button" tabindex="0">
    <div class="card-head">
      <div class="tk-sub"><strong>${t.subject}</strong>
        <div class="muted small">${t.name} · <a href="mailto:${t.email}">${t.email}</a>${t.phone ? html` · <a href="tel:${t.phone}">${t.phone}</a>` : ''}</div>
      </div>
      <div class="tk-badges">${badge(label, kind)}${t.priority !== 'normal' ? badge(plabel, pkind) : ''}</div>
    </div>
    <p class="tk-preview">${t.body}</p>
    <div class="row wrap tk-meta">
      <span class="muted small">${t.reference} · ${topic} · opened ${ago(t.createdAt)}${t.replies ? ` · ${t.replies} ${t.replies === 1 ? 'reply' : 'replies'}` : ''}${t.platform ? ` · ${t.platform}` : ''}</span>
      <span class="spacer"></span>
      ${t.status !== 'resolved' && t.status !== 'closed' ? html`<button class="btn sm" data-close-ticket="${t.id}">${icon('check', 14)} Mark resolved</button>` : ''}
      <button class="btn sm" data-open="${t.id}">${icon('chat', 14)} Open</button>
    </div>
  </article>`;
};

/** The conversation with the viewer + triage controls. `reload` refreshes the list behind the modal. */
async function openTicket(id, reload) {
  const m = openModal(html`<div class="spinner"></div>`, { title: 'Support ticket', wide: true });
  const draw = async () => {
    let data;
    try { data = await api.get(`/tickets/${id}`); }
    catch (e) { m.body.innerHTML = html`<div class="form-err">${errMsg(e)}</div>`.s; return; }
    if (!m.el.isConnected) return;
    const t = data.ticket, replies = data.replies || [], acc = data.account;
    const [label, kind] = STATUS[t.status] || [t.status, ''];
    m.body.innerHTML = html`
      <div class="tk-detail-head">
        <div><h3>${t.subject}</h3>
          <p class="muted small">${t.reference} · ${t.name} · <a href="mailto:${t.email}">${t.email}</a>${t.phone ? html` · <a href="tel:${t.phone}">${t.phone}</a>` : ''} · opened ${fmtDT(t.createdAt)}</p>
          <p class="muted small">${t.platform ? `Raised from ${t.platform}${t.appVersion ? ` (v${t.appVersion})` : ''}` : 'Raised on the website'}${t.device ? ` · ${t.device}` : ''}</p>
        </div>
        <div class="tk-badges">${badge(label, kind)}${badge((CATS.find(([v]) => v === t.category)?.[1] || 'Other'))}</div>
      </div>
      ${acc ? html`<p class="muted small">Account: <a href="#/users/${acc.id}">${acc.email}</a>${acc.name ? ` (${acc.name})` : ''}${acc.phone ? ` · ${acc.phone}` : ''}${acc.disabled ? ' · disabled' : ''}</p>` : html`<p class="muted small">No account is linked to this ticket — the viewer wrote in from the Support page while signed out.</p>`}
      <div class="tk-thread">
        <article class="tk-msg viewer"><header><b>${t.name}</b><small>${fmtDT(t.createdAt)}</small></header><p>${t.body}</p></article>
        ${replies.map((r) => html`<article class="tk-msg ${r.author === 'admin' ? 'staff' : 'viewer'}"><header><b>${r.author === 'admin' ? (r.authorName || 'Support') : t.name}</b><small>${fmtDT(r.createdAt)}</small></header><p>${r.body}</p></article>`)}
      </div>
      <form class="form tk-reply" id="tkReply">
        <div class="field wide"><label for="tkBody">Reply to the viewer</label>
          <textarea id="tkBody" name="body" rows="4" maxlength="5000" placeholder="Answer their question. This is e-mailed to them when the server has SMTP configured."></textarea></div>
        <div class="filters">
          <label class="inline">Status after reply
            <select name="status">${[['pending', 'Waiting on viewer'], ['resolved', 'Resolved'], ['open', 'Keep open'], ['closed', 'Close ticket']].map(([v, l]) => html`<option value="${v}" ${t.status === v || (v === 'pending' && t.status === 'open') ? 'selected' : ''}>${l}</option>`)}
            </select></label>
          <label class="inline">Priority
            <select name="priority">${[['low', 'Low'], ['normal', 'Normal'], ['high', 'High']].map(([v, l]) => html`<option value="${v}" ${t.priority === v ? 'selected' : ''}>${l}</option>`)}</select></label>
        </div>
        <div class="form-err" hidden></div>
        <div class="row wrap end">
          <button type="button" class="btn danger" data-del>${icon('trash', 15)} Delete</button>
          <button type="button" class="btn" data-save-note>Save status &amp; note</button>
          <button type="submit" class="btn primary">${icon('send', 15)} Send reply</button>
        </div>
      </form>
      <details class="tk-note"><summary>Internal note (never shown to the viewer)</summary>
        <div class="field wide"><textarea id="tkNote" rows="2" maxlength="300" placeholder="e.g. refunded via Razorpay dashboard">${t.adminNote || ''}</textarea></div>
      </details>`;
    wire(t, reload, m, draw);
  };
  await draw();
}

function wire(t, reload, m, draw) {
  const form = $('#tkReply', m.el), err = $('.form-err', form);
  const note = () => $('#tkNote', m.el)?.value.trim() || '';

  // Only triage fields change here (no reply yet) — handy when the answer already went out by e-mail.
  $('[data-save-note]', form).onclick = (e) => guard(e.target.closest('button'), async () => {
    await api.patch(`/tickets/${t.id}`, { status: form.status.value, priority: form.priority.value, adminNote: note() });
    toast('Ticket updated'); await reload?.();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guard($('button[type=submit]', form), async () => {
      const body = form.body.value.trim();
      if (body.length < 2) { err.textContent = 'Write a reply first.'; err.hidden = false; return; }
      const r = await api.post(`/tickets/${t.id}/replies`, { body, status: form.status.value });
      if (note()) await api.patch(`/tickets/${t.id}`, { adminNote: note(), priority: form.priority.value }).catch(() => {});
      toast(r.emailed ? 'Reply sent and e-mailed to the viewer' : 'Reply saved — e-mail is not configured, so tell the viewer another way', r.emailed ? 'ok' : 'err');
      await draw(); await reload?.();
    });
  });

  $('[data-del]', form).onclick = async () => {
    if (!await confirmBox({ title: 'Delete this ticket?', text: 'The conversation is removed for good. The viewer keeps the copy in their e-mail.', confirm: 'Delete', danger: true })) return;
    const btn = $('[data-del]', form);
    guard(btn, async () => { await api.del(`/tickets/${t.id}`); m.close(); toast('Ticket deleted'); await reload?.(); });
  };
}
