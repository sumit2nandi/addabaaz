// One user's detail page: profile, plan, payments and profiles; admin actions (edit, grant a plan, end the plan now, delete).
import { api } from '../api.js';
import { html, $, $$, icon, badge, empty, pageHead, formModal, confirmBox, guard, toast, errMsg, fmtD, fmtDT, inr } from '../ui.js';
import { paymentTable, wirePaymentActions } from './payments.js';

export default async function user(root, [id], ctx) {
  const load = async () => {
    let r; try { r = await api.get(`/users/${encodeURIComponent(id)}`); } catch (e) { if (e.status === 404) { root.innerHTML = html`<div class="card"><h2>User not found</h2><a href="#/users">Back to users</a></div>`.s; return; } throw e; }
    if (ctx.stale()) return; draw(r);
  };
  const me = ctx.admin.id === id;
  const act = (fn, ok) => async (e) => { await guard(e.currentTarget, async () => { await fn(); toast(ok); await load(); }); };

  function draw({ user: u, profiles, subscription: s, payments, spentPaise }) {
    const paid = s.planId !== 'free';
    root.innerHTML = html`<a href="#/users" class="back">${icon('left', 16)} Users</a>
      ${pageHead(u.name, u.email, html`
        <button class="btn" id="rename">${icon('edit', 16)} Rename</button>
        <button class="btn" id="mkadmin" ${me ? 'disabled title="You can’t change your own access"' : ''}>${icon('shield', 16)} ${u.isAdmin ? 'Remove admin' : 'Make admin'}</button>
        <button class="btn" id="disable" ${me ? 'disabled' : ''}>${icon('lock', 16)} ${u.disabledAt ? 'Enable account' : 'Disable account'}</button>
        <button class="btn danger" id="delete" ${me ? 'disabled' : ''}>${icon('trash', 16)} Delete</button>`)}
      <div class="chips">${u.isAdmin ? badge('administrator', 'ok') : ''} ${u.disabledAt ? badge(`disabled ${fmtD(u.disabledAt)}`, 'bad') : ''} ${badge(u.hasPassword ? 'password login' : 'no password')} ${u.providers.map((p) => badge(p))} <span class="muted small">joined ${fmtDT(u.createdAt)} · id ${u.id}</span></div>
      <div class="grid two">
        <section class="card"><div class="card-head"><h2>Plan</h2></div>
          ${paid ? html`<p><strong>${s.planId === 'plus-yearly' ? 'ADDABAAZ Plus (Yearly)' : 'ADDABAAZ Plus'}</strong> ${s.provider === 'admin' ? badge('complimentary') : s.demo ? badge('demo') : ''}</p><p class="muted">Active until <strong>${fmtDT(s.expiresAt)}</strong></p>`
            : html`<p><strong>Free</strong>${s.status === 'expired' ? html` <span class="muted">— plan expired ${fmtD(s.expiresAt)}</span>` : ''}</p>`}
          <p class="muted small">Total paid (net of refunds): <strong>${inr(spentPaise)}</strong></p>
          <div class="row wrap"><button class="btn primary" id="grant">${icon('crown', 16)} Give free access…</button>${paid ? html`<button class="btn danger" id="revoke">End plan now</button>` : ''}</div></section>
        <section class="card"><div class="card-head"><h2>Profiles</h2></div>
          <ul class="plain">${profiles.map((p) => html`<li><span class="dot c${p.color}"></span>${p.name}</li>`)}</ul></section>
      </div>
      <section class="card"><div class="card-head"><h2>Payments</h2></div>${payments.length ? paymentTable(payments, { showUser: false }) : empty('No payments.')}</section>`.s;
    wirePaymentActions(root, payments, load);
    $('#rename').onclick = () => formModal({ title: 'Rename user', fields: [{ k: 'name', label: 'Name', req: true, max: 60 }], values: { name: u.name }, onSubmit: async (v) => { await api.patch(`/users/${id}`, v); toast('Saved'); await load(); } });
    $('#mkadmin').onclick = async (e) => { if (await confirmBox({ title: u.isAdmin ? 'Remove admin access?' : 'Make this user an administrator?', text: u.isAdmin ? `${u.email} will lose access to this console immediately.` : `${u.email} will be able to edit the catalog, see all users and payments and issue refunds.`, confirm: u.isAdmin ? 'Remove admin' : 'Make admin', danger: !u.isAdmin })) act(() => api.patch(`/users/${id}`, { isAdmin: !u.isAdmin }), 'Saved')(e); };
    $('#disable').onclick = async (e) => { if (u.disabledAt || await confirmBox({ title: 'Disable this account?', text: 'They are signed out everywhere and can’t sign in again until you enable it. Their data and payments are kept.', confirm: 'Disable', danger: true })) act(() => api.patch(`/users/${id}`, { disabled: !u.disabledAt }), u.disabledAt ? 'Account enabled' : 'Account disabled')(e); };
    $('#delete').onclick = async () => { if (await confirmBox({ title: 'Delete this user?', text: `This permanently deletes ${u.email}, their profiles, lists and watch history. Payment and invoice records are kept for accounting. This can’t be undone.`, confirm: 'Delete permanently', danger: true })) { try { await api.del(`/users/${id}`); toast('User deleted'); ctx.go('users'); } catch (e) { toast(errMsg(e), 'err'); } } };
    $('#grant').onclick = () => formModal({ title: 'Give free access', note: 'No payment or invoice is created. If they already have a plan, the days are added to the end of it.', submit: 'Grant access',
      fields: [{ k: 'days', label: 'Days', type: 'number', min: 1, max: 3650, req: true, help: '30 = a month, 365 = a year' }, { k: 'planId', label: 'Plan', type: 'select', options: [{ v: 'plus-monthly', l: 'ADDABAAZ Plus' }, { v: 'plus-yearly', l: 'ADDABAAZ Plus (Yearly)' }] }, { k: 'note', label: 'Note (for the audit log)', max: 200, wide: true }], values: { days: 30 },
      onSubmit: async (v) => { await api.post(`/users/${id}/grant`, v); toast('Access granted'); await load(); } });
    $('#revoke')?.addEventListener('click', async (e) => { if (await confirmBox({ title: 'End this plan now?', text: 'Premium access stops immediately. This does not refund any payment — use Refund on the payment for that.', confirm: 'End plan', danger: true })) act(() => api.post(`/users/${id}/revoke-plan`), 'Plan ended')(e); });
  }
  await load();
}
