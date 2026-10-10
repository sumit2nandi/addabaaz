// Refund requests from the customer Billing page: approve (issues the refund) or decline.
import { api } from '../api.js';
import { html, $$, badge, empty, pager, pageHead, formModal, confirmBox, toast, errMsg, ago, fmtDT, inr } from '../ui.js';

const LIMIT = 20;
export default async function refunds(root, _p, ctx) {
  const st = { status: 'pending', offset: 0 };
  const load = async () => {
    const r = await api.get(`/refund-requests?status=${st.status}&limit=${LIMIT}&offset=${st.offset}`); if (ctx.stale()) return;
    root.innerHTML = html`${pageHead('Refund requests', 'Customers ask for a refund from their Billing page (within the refund window). Approving sends the refund through Razorpay and issues a credit note.')}
      <div class="tabs">${[['pending', 'Pending'], ['approved', 'Approved'], ['declined', 'Declined'], ['all', 'All']].map(([v, l]) => html`<button class="tab ${st.status === v ? 'on' : ''}" data-tab="${v}">${l}</button>`)}</div>
      ${r.requests.length ? r.requests.map((q) => html`<article class="card msg ${q.status !== 'pending' ? 'done' : ''}">
        <div class="card-head"><div><strong>${q.email}</strong> ${badge(q.status, q.status === 'approved' ? 'ok' : q.status === 'declined' ? 'bad' : 'warn')}</div><span class="muted small" title="${fmtDT(q.createdAt)}">${ago(q.createdAt)}</span></div>
        <p class="small muted">${q.payment ? `${q.payment.planId} · ${inr(q.payment.amountPaise)} paid ${fmtDT(q.payment.paidAt)}${q.payment.refundedPaise ? ` · ${inr(q.payment.refundedPaise)} already refunded` : ''}` : 'Payment not found'}</p>
        <p class="msg-text">${q.reason || html`<em class="muted">No reason given.</em>`}</p>
        ${q.status === 'pending' ? html`<div class="row wrap"><button class="btn sm primary" data-approve="${q.id}">Approve & refund…</button><button class="btn sm" data-decline="${q.id}">Decline…</button></div>`
          : html`<p class="small muted">Decided by ${q.decidedBy || 'admin'} ${ago(q.decidedAt)}${q.adminNote ? ` — “${q.adminNote}”` : ''}</p>`}</article>`) : empty(st.status === 'pending' ? 'No pending refund requests.' : 'Nothing here.')}
      ${pager({ total: r.total, offset: st.offset, limit: LIMIT })}`.s;
    $$('[data-tab]', root).forEach((b) => b.onclick = () => { st.status = b.dataset.tab; st.offset = 0; load(); });
    $$('[data-page]', root).forEach((b) => b.onclick = () => { st.offset = Number(b.dataset.page); load(); });
    const find = (id) => r.requests.find((x) => x.id === id);
    $$('[data-approve]', root).forEach((b) => b.onclick = () => { const q = find(b.dataset.approve), left = q.payment ? q.payment.amountPaise - q.payment.refundedPaise : 0;
      formModal({ title: 'Approve refund', submit: 'Refund now', note: `Refunds up to ${inr(left)} to the customer’s original payment method. Razorpay may take 5–7 days to settle.`,
        fields: [{ k: 'amount', label: 'Amount (₹) — blank = full remaining', type: 'number', min: 1, max: left / 100 }, { k: 'revoke', label: 'Also end their premium access', type: 'bool' }, { k: 'note', label: 'Note (private)', max: 300, wide: true }], values: { revoke: true },
        onSubmit: async (v) => { await api.post(`/refund-requests/${q.id}/approve`, { note: v.note, amountPaise: v.amount === '' ? undefined : Math.round(v.amount * 100), revokeAccess: !!v.revoke }); toast('Refund issued'); await load(); ctx.refreshCounts(); } }); });
    $$('[data-decline]', root).forEach((b) => b.onclick = () => { const q = find(b.dataset.decline);
      formModal({ title: 'Decline request', submit: 'Decline', note: 'The customer is emailed (if email is configured) with your note.', fields: [{ k: 'note', label: 'Reason shown to the customer', type: 'textarea', rows: 3, max: 300, wide: true }],
        onSubmit: async (v) => { await api.post(`/refund-requests/${q.id}/decline`, { note: v.note }); toast('Request declined'); await load(); ctx.refreshCounts(); } }); });
  };
  await load();
}
