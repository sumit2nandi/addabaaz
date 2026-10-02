// Users list with search and filters.
import { api } from '../api.js';
import { html, $, $$, icon, badge, empty, pager, pageHead, openModal, guard, toast, errMsg, fmtD, ago, debounce } from '../ui.js';

const LIMIT = 25;
// Quick filters for the list.
const FILTERS = [['all', 'All users'], ['paid', 'Paid plan'], ['expiring', 'Expiring in 7 days'], ['expired', 'Expired plan'], ['free', 'Free'], ['admin', 'Admins'], ['disabled', 'Disabled']];
export const planBadge = (u) => u.planId === 'free' ? badge('free') : html`${badge(u.planId.includes('year') ? 'plus · yearly' : 'plus', 'gold')}${u.planSource === 'admin' ? html` ${badge('complimentary')}` : ''}`;

export default async function users(root, _p, ctx) {
  const st = { q: ctx.query.get('q') || '', filter: ctx.query.get('filter') || 'all', offset: 0 };
  root.innerHTML = html`${pageHead('Users', 'Everyone who has signed up.')}
    <div id="dupes"></div>
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

  /* ---------- accounts that share one e-mail address ----------
   * One address must be one account. Rows that still collide differ by characters MySQL's collation does
   * not ignore (a pasted non-breaking space, an ideographic space, a full-width ＠ …) or are identical
   * rows from a database that predates the unique e-mail index. The card shows the offending characters
   * made visible and merges the accounts into one: profiles, devices, payments and comments move to the
   * account that stays, the others are deleted. */
  const box = $('#dupes', root);
  const loadDupes = async () => {
    let r;
    try { r = await api.get('/users/duplicates'); } catch { box.innerHTML = ''; return; }
    if (ctx.stale()) return;
    const groups = r.groups || [];
    if (!groups.length) { box.innerHTML = ''; return; }
    box.innerHTML = html`${groups.map((g) => html`<section class="card setup" data-group="${g.key}">
      <h2>${icon('alert', 20)} ${g.count} accounts share one e-mail address</h2>
      <p>These rows are the same address to a person but different strings to MySQL — usually a copy-pasted non-breaking space, an ideographic space or a full-width <b>＠</b>, and sometimes an account created before the unique e-mail index existed (in that case the rows are identical character for character). New sign-ups for the address are already refused; pick the account to keep here: the others’ profiles, watch history, devices, payments, comments and push subscriptions move to it, then they are deleted.</p>
      ${new Set(g.users.map((u) => u.email)).size === 1 ? html`<p class="muted small">${icon('alert', 14)} All ${g.count} rows carry exactly the same address — typical of a database created before the unique e-mail index existed. Keep the account the person uses.</p>` : ''}
      <table class="tbl compact"><thead><tr><th>Account</th><th>Address as stored</th><th>Plan</th><th>Joined</th><th class="end">Keep this one</th></tr></thead><tbody>
        ${g.users.map((u) => html`<tr><td><strong>${u.name}</strong>${u.isAdmin ? html` ${badge('admin', 'ok')}` : ''}${u.disabled ? html` ${badge('disabled', 'bad')}` : ''}<br><small class="muted">${[u.providers.join(', '), u.profiles ? `${u.profiles} profile${u.profiles === 1 ? '' : 's'}` : '', u.devices ? `${u.devices} device${u.devices === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || '—'}</small></td>
          <td><code>${u.emailVisible}</code>${u.emailPlain ? '' : html`<br><small class="muted">shown with invisible/look-alike characters marked</small>`}</td>
          <td>${planBadge(u)}</td><td class="small">${fmtD(u.createdAt)}<br><span class="muted">${ago(u.createdAt)}</span></td>
          <td class="end"><button class="btn sm" data-keep="${u.id}">Keep this</button></td></tr>`)}
      </tbody></table></section>`)}`.s;
    $$('[data-keep]', box).forEach((b) => b.onclick = () => {
      const group = groups.find((x) => x.users.some((u) => u.id === b.dataset.keep));
      const keep = group.users.find((u) => u.id === b.dataset.keep);
      merge(group, keep);
    });
  };
  const merge = (group, keep) => {
    const others = group.users.filter((u) => u.id !== keep.id);
    const m = openModal(html`
      <p>Keep <strong>${keep.name}</strong> (<code>${keep.emailVisible}</code>) and move everything from ${others.length === 1 ? html`<strong>${others[0].name}</strong>` : html`${others.length} other accounts`} into it?</p>
      <ul class="muted small"><li>Profiles, My List, watch history and reminders</li><li>Devices, push subscriptions and app installations</li><li>Plan, payments, invoices and refund requests</li><li>Comments and error reports</li></ul>
      <p class="muted small">The other account${others.length === 1 ? '' : 's'} ${others.length === 1 ? 'is' : 'are'} deleted. This cannot be undone — take a backup first if you are unsure (<code>npm run backup</code>).</p>
      <div class="row end"><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${icon('check', 16)} Merge into ${keep.name}</button></div>`, { title: 'Merge duplicate accounts' });
    $('[data-ok]', m.el).onclick = (e) => guard(e.currentTarget, async () => {
      try {
        for (const other of others) await api.post('/users/merge', { keepId: keep.id, removeId: other.id });
        m.close(); toast('Accounts merged'); await Promise.all([load(), loadDupes()]);
      } catch (err) { toast(errMsg(err), 'err'); }
    });
  };

  await Promise.all([load(), loadDupes()]);
}
