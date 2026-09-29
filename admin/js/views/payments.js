import { api } from '../api.js';
import { html, $, $$, icon, badge, empty, pager, pageHead, formModal, guard, toast, errMsg, fmtDT, inr, debounce } from '../ui.js';

const PLAN = { 'plus-monthly': 'Plus · monthly', 'plus-yearly': 'Plus · yearly' };
const LIMIT = 30;
const canRefund = (p) => p.status === 'paid' && p.provider === 'razorpay' && p.amountPaise > 0 && p.refundedPaise < p.amountPaise;

function statusBadges(p) {
  const b = [badge(p.status, p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'bad' : '')];
  if (p.provider !== 'razorpay') b.push(badge(p.provider));
  for (const r of p.refunds || []) b.push(badge(`refund ${inr(r.amountPaise)} · ${r.status}`, r.status === 'processed' ? 'warn' : r.status === 'failed' ? 'bad' : ''));
  return b;
}
/** Shared by the payments page and the user page. */
export function paymentTable(rows, { showUser = true } = {}) {
  return html`<table class="tbl"><thead><tr><th>Date</th>${showUser ? html`<th>Buyer</th>` : ''}<th>Plan</th><th class="end">Amount</th><th>Status</th><th>Documents</th><th></th></tr></thead><tbody>
    ${rows.map((p) => html`<tr><td class="small date">${fmtDT(p.paidAt || p.createdAt)}</td>${showUser ? html`<td>${p.userId ? html`<a href="#/users/${p.userId}">${p.userEmail}</a>` : html`<span class="muted">${p.userEmail || 'deleted user'}</span>`}</td>` : ''}
      <td>${PLAN[p.planId] || p.planId}${p.couponCode ? html`<br><small class="muted">coupon ${p.couponCode} (−${inr(p.discountPaise)})</small>` : ''}</td>
      <td class="end"><strong>${inr(p.amountPaise)}</strong></td><td class="badges">${statusBadges(p)}</td>
      <td><div class="docs">${(p.invoices || []).map((i) => html`<button class="btn sm" data-inv="${i.id}" data-num="${i.number}" title="Download PDF">${icon('download', 14)} ${i.kind === 'credit_note' ? 'Credit note' : 'Invoice'} ${i.number}</button>`)}</div></td>
      <td class="end">${canRefund(p) ? html`<button class="btn sm danger" data-refund="${p.id}">Refund…</button>` : ''}</td></tr>`)}</tbody></table>`;
}
export function wirePaymentActions(root, rows, reload) {
  $$('[data-inv]', root).forEach((b) => b.onclick = () => guard(b, () => api.download(`/invoices/${b.dataset.inv}/pdf`, `${b.dataset.num.replaceAll('/', '-')}.pdf`)));
  $$('[data-refund]', root).forEach((b) => b.onclick = () => refundDialog(rows.find((p) => p.id === b.dataset.refund), reload));
}
function refundDialog(p, reload) {
  const left = p.amountPaise - p.refundedPaise;
  formModal({ title: `Refund ${p.userEmail || 'payment'}`, submit: 'Refund via Razorpay',
    note: `Paid ${inr(p.amountPaise)}${p.refundedPaise ? `, already refunded ${inr(p.refundedPaise)}` : ''}. The money goes back to the buyer’s original payment method (usually 5–7 working days). A credit note is issued and emailed once Razorpay confirms.`,
    fields: [{ k: 'amount', label: `Amount to refund (₹) — up to ${inr(left)}`, type: 'number', min: 1, req: true, help: 'Refunding the full remaining amount also ends the access this payment bought.' }, { k: 'reason', label: 'Reason', max: 200, wide: true }, { k: 'revokeAccess', label: 'Also end the buyer’s access (for a partial refund)', type: 'bool', wide: true }],
    values: { amount: left / 100 },
    extra: (form) => { form.elements.amount.step = '0.01'; },
    onSubmit: async (v) => {
      const paise = Math.round(Number(v.amount) * 100); if (!(paise >= 100) || paise > left) throw new Error(`Enter an amount from ₹1 to ${inr(left)}.`);
      const r = await api.post(`/payments/${p.id}/refund`, { amountPaise: paise, reason: v.reason, revokeAccess: v.revokeAccess });
      toast(`Refund ${r.refund.status}${r.creditNote ? ` · credit note ${r.creditNote.number}` : ''}${r.accessRevoked ? ' · access ended' : ''}`); await reload();
    } });
}

export default async function payments(root, _p, ctx) {
  const st = { email: '', status: '', offset: 0 };
  const now = new Date(Date.now() + 5.5 * 3600_000), month = now.toISOString().slice(0, 7);
  root.innerHTML = html`${pageHead('Payments & refunds', 'Every checkout, with its GST invoice and any refunds.')}
    <div class="toolbar"><div class="search">${icon('search', 16)}<input id="q" type="search" placeholder="Buyer email…"></div>
      <select id="s"><option value="">All statuses</option><option value="paid">Paid</option><option value="created">Started, not paid</option><option value="failed">Failed</option></select></div>
    <div id="list"></div>
    <section class="card"><div class="card-head"><h2>Sales register (for your accountant)</h2></div>
      <p class="muted small">All invoices and credit notes in a date range as CSV — taxable value, CGST/SGST/IGST and place of supply for GSTR-1.</p>
      <form class="row wrap" id="reg"><div class="field"><label>From</label><input type="date" name="from" value="${month}-01"></div><div class="field"><label>To</label><input type="date" name="to" value="${now.toISOString().slice(0, 10)}"></div><button class="btn" type="submit">${icon('download', 16)} Download CSV</button></form></section>`.s;
  const load = async () => {
    const r = await api.get(`/payments?email=${encodeURIComponent(st.email)}&status=${st.status}&limit=${LIMIT}&offset=${st.offset}`); if (ctx.stale()) return;
    $('#list').innerHTML = html`<div class="card flush">${r.payments.length ? paymentTable(r.payments) : empty('No payments match.')}</div>${pager({ total: r.total, offset: st.offset, limit: LIMIT })}`.s;
    wirePaymentActions(root, r.payments, load);
    $$('[data-page]', root).forEach((b) => b.onclick = () => { st.offset = Number(b.dataset.page); load(); });
  };
  $('#q').addEventListener('input', debounce((e) => { st.email = e.target.value.trim(); st.offset = 0; load(); }, 300));
  $('#s').addEventListener('change', (e) => { st.status = e.target.value; st.offset = 0; load(); });
  $('#reg').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; guard($('button', f), () => api.download(`/invoices.csv?from=${f.from.value}&to=${f.to.value}`, `sales-register-${f.from.value}_${f.to.value}.csv`)); });
  await load();
}
