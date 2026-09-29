// Users list with search and filters.
import { api } from '../api.js';
import { html, $, $$, icon, badge, empty, pager, pageHead, fmtD, ago, debounce } from '../ui.js';

const LIMIT = 25;
// Quick filters for the list.
const FILTERS = [['all', 'All users'], ['paid', 'Paid plan'], ['expiring', 'Expiring in 7 days'], ['expired', 'Expired plan'], ['free', 'Free'], ['admin', 'Admins'], ['disabled', 'Disabled']];
export const planBadge = (u) => u.planId === 'free' ? badge('free') : html`${badge(u.planId.includes('year') ? 'plus · yearly' : 'plus', 'gold')}${u.planSource === 'admin' ? html` ${badge('complimentary')}` : ''}`;

export default async function users(root, _p, ctx) {
  const st = { q: ctx.query.get('q') || '', filter: ctx.query.get('filter') || 'all', offset: 0 };
  root.innerHTML = html`${pageHead('Users', 'Everyone who has signed up.')}
    <div class="toolbar"><div class="search">${icon('search', 16)}<input id="q" type="search" placeholder="Search name or email…" value="${st.q}"></div>
      <select id="f">${FILTERS.map(([v, l]) => html`<option value="${v}" ${st.filter === v ? 'selected' : ''}>${l}</option>`)}</select></div>
    <div id="list"></div>`.s;
  const load = async () => {
    const r = await api.get(`/users?q=${encodeURIComponent(st.q)}&filter=${st.filter}&limit=${LIMIT}&offset=${st.offset}`); if (ctx.stale()) return;
    $('#list').innerHTML = html`<div class="card flush">${r.users.length ? html`<table class="tbl"><thead><tr><th>User</th><th>Plan</th><th>Sign-in</th><th>Joined</th><th></th></tr></thead><tbody>
      ${r.users.map((u) => html`<tr class="link" data-go="${u.id}"><td><strong>${u.name}</strong> ${u.isAdmin ? badge('admin', 'ok') : ''} ${u.disabledAt ? badge('disabled', 'bad') : ''}<br><small class="muted">${u.email}</small></td>
        <td>${planBadge(u)}${u.planId !== 'free' ? html`<br><small class="muted">until ${fmtD(u.expiresAt)}</small>` : ''}</td>
        <td class="small">${['password', ...u.providers].filter((v, i, a) => a.indexOf(v) === i).join(', ')}</td><td class="small">${fmtD(u.createdAt)}<br><span class="muted">${ago(u.createdAt)}</span></td><td class="end">${icon('right', 16)}</td></tr>`)}</tbody></table>` : empty('No users match.')}</div>
      ${pager({ total: r.total, offset: st.offset, limit: LIMIT })}<p class="muted small">${r.total.toLocaleString('en-IN')} user${r.total === 1 ? '' : 's'}</p>`.s;
    $$('[data-go]', root).forEach((tr) => tr.onclick = () => ctx.go(`users/${tr.dataset.go}`));
    $$('[data-page]', root).forEach((b) => b.onclick = () => { st.offset = Number(b.dataset.page); load(); });
  };
  $('#q').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.offset = 0; load(); }, 250));
  $('#f').addEventListener('change', (e) => { st.filter = e.target.value; st.offset = 0; load(); });
  await load();
}
