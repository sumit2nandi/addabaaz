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
          ${paid ? html`<p><strong>${s.planId === 'plus-yearly' ? 'ADDABAAZ Premium (Yearly)' : 'ADDABAAZ Premium'}</strong> ${s.provider === 'admin' ? badge('complimentary') : s.demo ? badge('demo') : ''}</p><p class="muted">Active until <strong>${fmtDT(s.expiresAt)}</strong></p>`
            : html`<p><strong>Free</strong>${s.status === 'expired' ? html` <span class="muted">— plan expired ${fmtD(s.expiresAt)}</span>` : ''}</p>`}
          <p class="muted small">Total paid (net of refunds): <strong>${inr(spentPaise)}</strong></p>
          <div class="row wrap"><button class="btn primary" id="grant">${icon('crown', 16)} Give free access…</button>${paid ? html`<button class="btn danger" id="revoke">End plan now</button>` : ''}</div></section>
        <section class="card"><div class="card-head"><h2>Profiles</h2></div><p class="muted small">Parental PIN: ${u.hasPin ? 'Enabled' : 'Not set'}</p>${u.hasPin ? html`<button class="btn danger" id="removeParentalPin">Remove parental PIN</button>` : ''}
          <ul class="plain">${profiles.map((p) => html`<li><span class="dot c${p.color}"></span>${p.name}</li>`)}</ul></section>
      </div>
      <section class="card" id="creditCard"><div class="card-head"><h2>Credit &amp; referrals</h2></div><div class="spinner" style="margin:14px auto"></div></section>
      <section class="card"><div class="card-head"><h2>Payments</h2></div>${payments.length ? paymentTable(payments, { showUser: false }) : empty('No payments.')}</section>`.s;
    $('#removeParentalPin', root)?.addEventListener('click', async (e) => {
      if (await confirmBox({ title: 'Remove parental PIN?', text: 'Verify the account owner’s identity first. This removes parental protection for this account and is recorded in the audit log.', confirm: 'Remove PIN', danger: true })) await act(() => api.del(`/users/${encodeURIComponent(id)}/parental-pin`), 'Parental PIN removed')(e);
    });
    wirePaymentActions(root, payments, load);
    // Promotional credit for this account (best effort: the card disappears when the offer is not running).
    $('#creditCard') && api.get(`/credits/user/${encodeURIComponent(id)}`)
      .then((cr) => {
        const box = $('#creditCard', root); if (!box || ctx.stale()) return;
        box.innerHTML = html`<div class="card-head"><h2>Credit &amp; referrals</h2></div>
          <p><strong>${inr(cr.balancePaise)}</strong> available${cr.pendingPaise ? html` · ${inr(cr.pendingPaise)} on hold` : ''}${cr.expiringPaise ? html` · ${inr(cr.expiringPaise)} expiring soon` : ''}${cr.spendMs ? html` <span class="muted small">(${inr(cr.spendMs)} used on plans)</span>` : ''}</p>
          <p class="muted small">${cr.code ? html`Invite code <strong>${cr.code}</strong> · ` : ''}${cr.invitedTotal || 0} friend${cr.invitedTotal === 1 ? '' : 's'} invited${cr.referredBy ? html` · joined via ${cr.referredBy.status === 'completed' ? 'a completed' : 'an open'} referral` : ''}</p>
          ${cr.ledger?.length ? html`<table class="tbl"><tbody>${cr.ledger.slice(0, 8).map((x) => html`<tr><td class="small">${fmtDT(x.createdAt)}<br><span class="muted">${x.reason || x.kind}</span></td><td class="num">${x.amountPaise < 0 ? '−' : '+'}${inr(Math.abs(x.amountPaise))}</td><td class="end small muted">${x.status === 'pending' ? 'on hold' : x.status}</td></tr>`)}</tbody></table>` : ''}
          <div class="row wrap"><button class="btn" id="giveCredit">${icon('gift', 16)} Add credit…</button><button class="btn" id="revokeCredit" ${cr.balancePaise + cr.pendingPaise > 0 ? '' : 'disabled'}>Remove all unspent</button></div>`;
        $('#giveCredit', box).onclick = () => formModal({ title: 'Add credit', note: 'Goodwill credit for this account — the viewer is e-mailed and the entry is logged.', submit: 'Add credit',
          fields: [{ k: 'amountINR', label: 'Amount (₹)', type: 'number', min: 1, max: 10000, req: true }, { k: 'reason', label: 'Reason (sent to the viewer)', max: 200, wide: true }],
          onSubmit: async (v) => { await api.post('/credits/grant', { user: id, ...v }); toast('Credit added'); await load(); } });
        $('#revokeCredit', box).onclick = async () => { if (!await confirmBox({ title: 'Remove unspent credit?', text: `${inr(cr.balancePaise + cr.pendingPaise)} that has not been used yet will be removed. Credit already spent on a plan is untouched.`, confirm: 'Remove credit', danger: true })) return; try { for (const x of cr.ledger.filter((y) => y.amountPaise > 0 && y.status !== 'void' && (y.status === 'available' || y.status === 'pending'))) await api.post(`/credits/${x.id}/revoke`, {}); toast('Credit removed'); await load(); } catch (e) { toast(errMsg(e), 'err'); } };
      })
      .catch(() => { const box = $('#creditCard', root); if (box) box.remove(); });
    $('#rename').onclick = () => formModal({ title: 'Rename user', fields: [{ k: 'name', label: 'Name', req: true, max: 60 }], values: { name: u.name }, onSubmit: async (v) => { await api.patch(`/users/${id}`, v); toast('Saved'); await load(); } });
    $('#mkadmin').onclick = async (e) => { if (await confirmBox({ title: u.isAdmin ? 'Remove admin access?' : 'Make this user an administrator?', text: u.isAdmin ? `${u.email} will lose access to this console immediately.` : `${u.email} will be able to edit the catalog, see all users and payments and issue refunds.`, confirm: u.isAdmin ? 'Remove admin' : 'Make admin', danger: !u.isAdmin })) act(() => api.patch(`/users/${id}`, { isAdmin: !u.isAdmin }), 'Saved')(e); };
    $('#disable').onclick = async (e) => { if (u.disabledAt || await confirmBox({ title: 'Disable this account?', text: 'They are signed out everywhere and can’t sign in again until you enable it. Their data and payments are kept.', confirm: 'Disable', danger: true })) act(() => api.patch(`/users/${id}`, { disabled: !u.disabledAt }), u.disabledAt ? 'Account enabled' : 'Account disabled')(e); };
    $('#delete').onclick = async () => { if (await confirmBox({ title: 'Delete this user?', text: `This permanently deletes ${u.email}, their profiles, lists and watch history. Payment and invoice records are kept for accounting. This can’t be undone.`, confirm: 'Delete permanently', danger: true })) { try { await api.del(`/users/${id}`); toast('User deleted'); ctx.go('users'); } catch (e) { toast(errMsg(e), 'err'); } } };
    $('#grant').onclick = () => formModal({ title: 'Give free access', note: 'No payment or invoice is created. If they already have a plan, the days are added to the end of it.', submit: 'Grant access',
      fields: [{ k: 'days', label: 'Days', type: 'number', min: 1, max: 3650, req: true, help: '30 = a month, 365 = a year' }, { k: 'planId', label: 'Plan', type: 'select', options: [{ v: 'plus-monthly', l: 'ADDABAAZ Premium' }, { v: 'plus-yearly', l: 'ADDABAAZ Premium (Yearly)' }] }, { k: 'note', label: 'Note (for the audit log)', max: 200, wide: true }], values: { days: 30 },
      onSubmit: async (v) => { await api.post(`/users/${id}/grant`, v); toast('Access granted'); await load(); } });
    $('#revoke')?.addEventListener('click', async (e) => { if (await confirmBox({ title: 'End this plan now?', text: 'Premium access stops immediately. This does not refund any payment — use Refund on the payment for that.', confirm: 'End plan', danger: true })) act(() => api.post(`/users/${id}/revoke-plan`), 'Plan ended')(e); });
  }
  await load();
}
