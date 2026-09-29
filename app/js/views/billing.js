import { app } from '../app.js';
import { html, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { sectionHeader, toast } from '../ui/components.js';
import { go } from '../router.js';

const inr = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

/** Billing & invoices: every paid plan with its GST invoice, credit notes for refunds, and the refund status. */
export default async function billing(ctx) {
  const u = app.user;
  ctx.setTitle('Billing & invoices');
  if (!u.supportsAuth || !u.account) { go('/signin?next=' + encodeURIComponent('/billing'), { replace: true }); return; }
  let items;
  try { items = await u.billingHistory(); } catch (e) { ctx.root.innerHTML = html`<div class="page"><div class="empty"><h2>Couldn’t load your billing history</h2><p>${e.message}</p></div></div>`.s; return; }

  const doc = (d, label) => html`<button class="btn btn-ghost" data-dl="${d.id}" data-name="${d.number}">${icon('download', { size: 16 })} ${label} ${d.number}</button>`;
  ctx.root.innerHTML = html`<div class="page page-narrow">
    ${sectionHeader({ tag: 'Account', title: 'Billing & invoices', subtitle: 'Your payments, GST invoices and refunds.' })}
    ${items.length ? html`<div class="bill">${items.map((p) => html`<article class="bill-item">
      <div class="bill-head"><div><b>${p.planName}</b><div class="muted small">${fmtDate(p.paidAt)}${p.couponCode ? ` · coupon ${p.couponCode} (−${inr(p.discountPaise)})` : ''}</div></div><div class="bill-amt">${p.amountPaise ? inr(p.amountPaise) : 'Free'}</div></div>
      ${p.refundedPaise ? html`<div><span class="pill ok">Refunded ${inr(p.refundedPaise)}</span></div>` : p.refunds.some((r) => r.status === 'pending') ? html`<div><span class="pill">Refund in progress</span></div>` : ''}
      <div class="bill-docs">
        ${p.invoice ? doc(p.invoice, p.invoice.title === 'TAX INVOICE' ? 'Tax invoice' : 'Receipt') : p.amountPaise ? '' : html`<span class="muted small">Nothing was charged, so there is no invoice.</span>`}
        ${p.creditNotes.map((c) => doc(c, 'Credit note'))}
        ${p.invoice ? html`<button class="btn btn-ghost" data-mail="${p.invoice.id}">${icon('mail', { size: 16 })} Email me the invoice</button>` : ''}
      </div></article>`)}</div>` : html`<div class="empty">${icon('crown', { size: 44 })}<h2>No payments yet</h2><p>When you subscribe to ADDABAAZ Plus, your invoices will appear here.</p><a class="btn btn-primary" href="#/plans">See plans</a></div>`}
  </div>`.s;

  ctx.root.addEventListener('click', async (e) => {
    const dl = e.target.closest('[data-dl]'), ml = e.target.closest('[data-mail]');
    if (!dl && !ml) return;
    const btn = dl || ml; btn.disabled = true;
    try {
      if (dl) {
        const blob = await u.invoiceBlob(dl.dataset.dl);
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${dl.dataset.name.replace(/\//g, '-')}.pdf`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      } else { await u.emailInvoice(ml.dataset.mail); toast('Sent to ' + u.account.email); }
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
}
