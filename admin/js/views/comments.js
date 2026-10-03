// Comment moderation: search and filter comments; approve, hide (3 viewer reports hide automatically) or delete.
import { api } from '../api.js';
import { html, $, $$, icon, badge, empty, pager, pageHead, confirmBox, toast, errMsg, ago, fmtDT, debounce, loadingLines } from '../ui.js';

const LIMIT = 30;
export default async function comments(root, _p, ctx) {
  const st = { filter: 'review', q: '', offset: 0 };
  root.innerHTML = html`${pageHead('Comments', 'Viewer comments on videos. Comments reported by 3 people are hidden automatically and wait here for you.')}
    <div class="toolbar"><div class="tabs" id="tabs">${[['review', 'Needs review'], ['hidden', 'Hidden'], ['all', 'All']].map(([v, l]) => html`<button class="tab" data-tab="${v}">${l}</button>`)}</div><div class="search">${icon('search', 16)}<input id="q" type="search" placeholder="Search text or name"></div></div><div id="list">${loadingLines(4)}</div>`.s;
  const load = async () => {
    const r = await api.get(`/comments?filter=${st.filter}&q=${encodeURIComponent(st.q)}&limit=${LIMIT}&offset=${st.offset}`); if (ctx.stale()) return;
    $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === st.filter));
    $('#list', root).innerHTML = html`${r.comments.length ? r.comments.map((c) => html`<article class="card msg ${c.status === 'hidden' ? 'done' : ''}">
      <div class="card-head"><div><strong>${c.author}</strong> <span class="muted small">${c.email}</span> ${c.status === 'hidden' ? badge(c.hiddenReason === 'admin' ? 'hidden by admin' : 'hidden · reports', 'warn') : ''} ${c.reports ? badge(`${c.reports} report${c.reports === 1 ? '' : 's'}`, 'bad') : ''}</div><span class="muted small" title="${fmtDT(c.createdAt)}">${ago(c.createdAt)}</span></div>
      <p class="msg-text">${c.body}</p><p class="muted small">on <a href="/watch/${c.videoId}" target="_blank" rel="noopener">${c.videoTitle}</a></p>
      <div class="row wrap">${c.status === 'hidden' ? html`<button class="btn sm primary" data-approve="${c.id}">Restore</button>` : html`<button class="btn sm" data-hide="${c.id}">Hide</button>`}<button class="btn sm danger" data-del="${c.id}">${icon('trash', 14)} Delete</button></div></article>`) : empty(st.filter === 'review' ? 'Nothing to review — all quiet.' : 'No comments found.')}
      ${pager({ total: r.total, offset: st.offset, limit: LIMIT })}`.s;
    const act = (sel, fn) => $$(sel, root).forEach((b) => b.onclick = async () => { try { await fn(b); await load(); ctx.refreshCounts(); } catch (e) { toast(errMsg(e), 'err'); } });
    act('[data-approve]', (b) => api.post(`/comments/${b.dataset.approve}/approve`)); act('[data-hide]', (b) => api.post(`/comments/${b.dataset.hide}/hide`));
    $$('[data-del]', root).forEach((b) => b.onclick = async () => { if (await confirmBox({ title: 'Delete this comment?', text: 'This can’t be undone.', confirm: 'Delete', danger: true })) { try { await api.del(`/comments/${b.dataset.del}`); await load(); ctx.refreshCounts(); } catch (e) { toast(errMsg(e), 'err'); } } });
    $$('[data-page]', root).forEach((b) => b.onclick = () => { st.offset = Number(b.dataset.page); load(); });
  };
  $$('[data-tab]', root).forEach((b) => b.onclick = () => { st.filter = b.dataset.tab; st.offset = 0; load(); });
  $('#q', root).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.offset = 0; load(); }, 300));
  await load();
}
