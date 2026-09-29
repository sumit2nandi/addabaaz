// Coupons: create, enable/disable, edit and delete discount codes.
import { api } from '../api.js';
import { html, $, $$, icon, badge, empty, pageHead, formModal, confirmBox, toast, errMsg, fmtD, inr } from '../ui.js';

// Badge: off / expired / active.
const status = (c) => !c.active ? badge('off') : c.expiresAt && new Date(c.expiresAt) < new Date() ? badge('expired', 'bad') : c.startsAt && new Date(c.startsAt) > new Date() ? badge('scheduled') : c.maxRedemptions != null && c.redeemed >= c.maxRedemptions ? badge('used up', 'warn') : badge('live', 'ok');

export default async function coupons(root, _p, ctx) {
  const load = async () => {
    const { coupons: list, plans } = await api.get('/coupons'); if (ctx.stale()) return;
    root.innerHTML = html`${pageHead('Coupons', 'Discount codes viewers enter at checkout. Prices include GST; the discount is taken off the total.', html`<button class="btn primary" id="new">${icon('plus', 16)} New coupon</button>`)}
      <div class="card flush">${list.length ? html`<table class="tbl"><thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th>Used</th><th>Valid</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((c) => html`<tr><td><strong class="mono">${c.code}</strong>${c.description ? html`<br><small class="muted">${c.description}</small>` : ''}</td>
          <td>${c.kind === 'percent' ? `${c.value}% off` : `${inr(c.value)} off`}</td><td class="small">${c.planIds ? c.planIds.map((id) => plans.find((p) => p.id === id)?.name || id).join(', ') : 'all plans'}<br><span class="muted">${c.perUserLimit}× per user</span></td>
          <td>${c.redeemed}${c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}</td><td class="small">${c.startsAt ? fmtD(c.startsAt) : 'now'} → ${c.expiresAt ? fmtD(c.expiresAt) : 'no end'}</td><td>${status(c)}</td>
          <td class="end nowrap"><button class="btn sm" data-toggle="${c.code}">${c.active ? 'Turn off' : 'Turn on'}</button> <button class="icon-btn" data-edit="${c.code}" title="Edit limits">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${c.code}" title="Delete">${icon('trash', 16)}</button></td></tr>`)}</tbody></table>` : empty('No coupons yet. Create one for a launch offer or to give a friend a discount.')}</div>`.s;
    const fail = (e) => toast(errMsg(e), 'err');
    $('#new').onclick = () => formModal({ title: 'New coupon', submit: 'Create coupon', wide: true,
      note: 'The discount itself can’t be changed after creation, so old invoices stay explainable — create a new code instead. 100% off gives free access without a payment.',
      fields: [
        { k: 'code', label: 'Code', req: true, max: 30, help: 'Letters, digits, - and _; not case-sensitive', placeholder: 'LAUNCH50' }, { k: 'description', label: 'Description (private)', max: 120 },
        { k: 'kind', label: 'Type', type: 'select', options: [{ v: 'percent', l: 'Percent off' }, { v: 'flat', l: 'Flat amount off (₹)' }] }, { k: 'value', label: 'Value', type: 'number', min: 1, req: true, help: 'Percent (1–100) or rupees' },
        { k: 'planIds', label: 'Plans', type: 'select', options: [{ v: '', l: 'All plans' }, ...plans.map((p) => ({ v: p.id, l: `${p.name} (₹${p.priceINR})` }))] },
        { k: 'perUserLimit', label: 'Uses per user', type: 'number', min: 1 }, { k: 'maxRedemptions', label: 'Total uses (blank = unlimited)', type: 'number', min: 1 },
        { k: 'startsAt', label: 'Starts (optional)', type: 'datetime' }, { k: 'expiresAt', label: 'Ends (optional)', type: 'datetime' },
      ], values: { kind: 'percent', perUserLimit: 1 },
      onSubmit: async (v) => { await api.post('/coupons', { ...v, value: v.kind === 'flat' ? Math.round(v.value * 100) : v.value, planIds: v.planIds ? [v.planIds] : [], maxRedemptions: v.maxRedemptions === '' ? null : v.maxRedemptions, startsAt: v.startsAt || null, expiresAt: v.expiresAt || null }); toast('Coupon created'); await load(); } });
    $$('[data-toggle]', root).forEach((b) => b.onclick = async () => { const c = list.find((x) => x.code === b.dataset.toggle); try { await api.patch(`/coupons/${c.code}`, { active: !c.active }); toast(c.active ? 'Coupon turned off' : 'Coupon turned on'); await load(); } catch (e) { fail(e); } });
    $$('[data-edit]', root).forEach((b) => b.onclick = () => { const c = list.find((x) => x.code === b.dataset.edit);
      formModal({ title: `Edit ${c.code}`, note: 'Only limits and dates can be changed.', fields: [{ k: 'description', label: 'Description', max: 120, wide: true }, { k: 'perUserLimit', label: 'Uses per user', type: 'number', min: 1 }, { k: 'maxRedemptions', label: 'Total uses (blank = unlimited)', type: 'number', min: 1 }, { k: 'startsAt', label: 'Starts', type: 'datetime' }, { k: 'expiresAt', label: 'Ends', type: 'datetime' }], values: c,
        onSubmit: async (v) => { await api.patch(`/coupons/${c.code}`, { description: v.description, perUserLimit: v.perUserLimit, maxRedemptions: v.maxRedemptions === '' ? null : v.maxRedemptions, startsAt: v.startsAt || null, expiresAt: v.expiresAt || null }); toast('Saved'); await load(); } }); });
    $$('[data-del]', root).forEach((b) => b.onclick = async () => { if (await confirmBox({ title: `Delete ${b.dataset.del}?`, text: 'Codes that have been used are kept for the records — turn those off instead.', confirm: 'Delete', danger: true })) { try { await api.del(`/coupons/${b.dataset.del}`); toast('Deleted'); await load(); } catch (e) { fail(e); } } });
  };
  await load();
}
