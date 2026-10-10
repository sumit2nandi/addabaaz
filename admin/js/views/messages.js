// Contact-form inbox: filter by status; mark handled or reopen; delete.
import { api } from '../api.js';
import { html, $, $$, icon, badge, empty, pager, pageHead, confirmBox, toast, errMsg, fmtDT, ago } from '../ui.js';

const LIMIT = 20;
export default async function messages(root, _p, ctx) {
  const st = { status: 'open', offset: 0 };
  const load = async () => {
    const r = await api.get(`/messages?status=${st.status}&limit=${LIMIT}&offset=${st.offset}`); if (ctx.stale()) return;
    root.innerHTML = html`${pageHead('Messages', 'Sent from the Contact form on the site.')}
      <div class="tabs">${[['open', 'Open'], ['handled', 'Handled'], ['all', 'All']].map(([v, l]) => html`<button class="tab ${st.status === v ? 'on' : ''}" data-tab="${v}">${l}</button>`)}</div>
      ${r.messages.length ? r.messages.map((m) => html`<article class="card msg ${m.handledAt ? 'done' : ''}">
        <div class="card-head"><div><strong>${m.name}</strong> <a href="mailto:${m.email}">${m.email}</a>${m.phone ? html` · <a href="tel:${m.phone}">${m.phone}</a>` : ''}</div><span class="muted small" title="${fmtDT(m.createdAt)}">${ago(m.createdAt)}</span></div>
        <p class="msg-text">${m.message}</p>
        <div class="row wrap">${m.handledAt ? html`${badge(`handled by ${m.handledBy || 'admin'}`, 'ok')} <button class="btn sm" data-reopen="${m.id}">Reopen</button>` : html`<a class="btn sm primary" href="mailto:${m.email}?subject=${encodeURIComponent('Re: your message to ADDABAAZ')}">${icon('mail', 14)} Reply by email</a><button class="btn sm" data-done="${m.id}">${icon('check', 14)} Mark handled</button>`}<button class="icon-btn danger" data-del="${m.id}" title="Delete">${icon('trash', 16)}</button></div></article>`) : html`<div class="card">${empty(st.status === 'open' ? 'No open messages — all caught up. 🎉' : 'Nothing here.')}</div>`}
      ${pager({ total: r.total, offset: st.offset, limit: LIMIT })}`.s;
    const patch = async (id, handled) => { try { await api.patch(`/messages/${id}`, { handled }); await load(); ctx.refreshCounts(); } catch (e) { toast(errMsg(e), 'err'); } };
    $$('[data-tab]', root).forEach((b) => b.onclick = () => { st.status = b.dataset.tab; st.offset = 0; load(); });
    $$('[data-done]', root).forEach((b) => b.onclick = () => patch(b.dataset.done, true)); $$('[data-reopen]', root).forEach((b) => b.onclick = () => patch(b.dataset.reopen, false));
    $$('[data-del]', root).forEach((b) => b.onclick = async () => { if (await confirmBox({ title: 'Delete this message?', confirm: 'Delete', danger: true })) { try { await api.del(`/messages/${b.dataset.del}`); await load(); ctx.refreshCounts(); } catch (e) { toast(errMsg(e), 'err'); } } });
    $$('[data-page]', root).forEach((b) => b.onclick = () => { st.offset = Number(b.dataset.page); load(); });
  };
  await load();
}
