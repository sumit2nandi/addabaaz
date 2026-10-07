// Billing page (#/billing): payments, GST invoices, credit notes and refund requests.
import { app } from '../app.js';
import { html, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { sectionHeader, toast } from '../ui/components.js';
import { go } from '../router.js';
import { openDialog } from '../ui/dialog.js';
import { $ } from '../util.js';
import { friendly } from '../errors.js';
import { isNative } from '../platform.js';

// Formats paise (integer hundredths of a rupee) as ₹ with Indian digit grouping.
const inr = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

/** Billing & invoices: every paid plan with its GST invoice, credit notes for refunds, and the refund status. */
export default async function billing(ctx) {
  const u = app.user;
  ctx.setTitle('Billing & invoices');
  if (!u.supportsAuth || !u.account) { go('/signin?next=' + encodeURIComponent('/billing'), { replace: true }); return; }
  const backLink = html`<p class="back-row"><a class="account-edit-back" href="#/plans" aria-label="Back to plan details">${icon('left', { size: 24 })}</a></p>`;
  let items, rr = { requests: [], windowDays: 0 };
  try { items = await u.billingHistory(); } catch (e) { ctx.root.innerHTML = html`<div class="page page-narrow">${backLink}<div class="empty"><h2>Couldn’t load your billing history</h2><p>${friendly(e)}</p></div></div>`.s; return; }

  try { rr = await u.remote.refundRequests(); } catch { /* older server: no self-service refunds */ }
  const pending = new Set(rr.requests.filter((r) => r.status === 'pending').map((r) => r.paymentId));
  const canAsk = (p) => rr.windowDays > 0 && p.provider === 'razorpay' && p.amountPaise > 0 && p.refundedPaise < p.amountPaise && !pending.has(p.id) && (Date.now() - Date.parse(p.paidAt)) / 864e5 <= rr.windowDays;
  const doc = (d, label) => html`<button class="btn btn-ghost" data-dl="${d.id}" data-name="${d.number}">${icon('download', { size: 16 })} ${label} ${d.number}</button>`;
  ctx.root.innerHTML = html`<div class="page page-narrow">
    ${backLink}
    ${sectionHeader({ tag: 'Account', title: 'Billing & invoices', subtitle: u.account.emailIsPlaceholder ? 'Your payment documents and refunds. Add a verified contact email in Account to receive billing emails.' : 'Your payments, GST invoices and refunds.' })}
    ${items.length ? html`<div class="bill">${items.map((p) => html`<article class="bill-item">
      <div class="bill-head"><div><b>${p.planName}</b><div class="muted small">${fmtDate(p.paidAt)}${p.couponCode ? ` · coupon ${p.couponCode} (−${inr(p.discountPaise)})` : ''}</div></div><div class="bill-amt">${p.amountPaise ? inr(p.amountPaise) : 'Free'}</div></div>
      ${p.refundedPaise ? html`<div><span class="pill ok">Refunded ${inr(p.refundedPaise)}</span></div>` : p.refunds.some((r) => r.status === 'pending') ? html`<div><span class="pill">Refund in progress</span></div>` : pending.has(p.id) ? html`<div><span class="pill">${u.account.emailIsPlaceholder ? 'Refund requested — check this page for updates' : 'Refund requested — we’ll email you'}</span></div>` : ''}
      <div class="bill-docs">
        ${p.invoice ? doc(p.invoice, p.invoice.title === 'TAX INVOICE' ? 'Tax invoice' : 'Receipt') : p.amountPaise ? '' : html`<span class="muted small">Nothing was charged, so there is no invoice.</span>`}
        ${p.creditNotes.map((c) => doc(c, 'Credit note'))}
        ${canAsk(p) ? html`<button class="btn btn-ghost" data-refund="${p.id}">${icon('info', { size: 16 })} Request a refund</button>` : ''}
        ${p.invoice ? u.account.emailIsPlaceholder ? html`<span class="muted small">Confirm an email in Account to send documents by email.</span>` : html`<button class="btn btn-ghost" data-mail="${p.invoice.id}">${icon('mail', { size: 16 })} Email me the invoice</button>` : ''}
      </div></article>`)}</div>` : html`<div class="empty">${icon('crown', { size: 44 })}<h2>No payments yet</h2><p>${isNative ? 'There are no website payment records linked to this account.' : html`When you subscribe to ADDABAAZ <em class="premium-word">premium</em>, your invoices will appear here.`}</p>${isNative ? '' : html`<a class="btn btn-primary" href="#/plans">See plans</a>`}</div>`}
  </div>`.s;

  ctx.root.addEventListener('click', async (e) => {
    const rf = e.target.closest('[data-refund]');
    if (rf) return refundDialog(rf.dataset.refund);
    const dl = e.target.closest('[data-dl]'), ml = e.target.closest('[data-mail]');
    if (!dl && !ml) return;
    const btn = dl || ml; btn.disabled = true;
    try {
      if (dl) {
        const blob = await u.invoiceBlob(dl.dataset.dl);
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${dl.dataset.name.replace(/\//g, '-')}.pdf`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      } else { await u.emailInvoice(ml.dataset.mail); toast('Sent to ' + u.account.email); }
    } catch (err) { toast(friendly(err)); } finally { btn.disabled = false; }
  });

  function refundDialog(paymentId) {
    const hasVerifiedEmail = !u.account.emailIsPlaceholder;
    const { el, close } = openDialog(html`<h2>Request a refund</h2><p class="muted">You can ask within ${rr.windowDays} days of buying. We review every request and ${hasVerifiedEmail ? 'email you the outcome' : 'show the outcome on this Billing page'}; approved refunds go back to your original payment method (5–7 working days) and premium access ends.</p>
      <form class="form" id="rfForm" novalidate><label>Why are you asking? <small class="muted">(optional)</small><textarea name="reason" rows="3" maxlength="500" placeholder="Tell us what went wrong"></textarea></label>
      <div class="form-status" role="alert"></div><div class="row end"><button type="button" class="btn btn-ghost" data-close>Not now</button><button class="btn btn-primary" type="submit">Send request</button></div></form>`, { cls: 'dialog-sm' });
    $('#rfForm', el).addEventListener('submit', async (e) => {
      e.preventDefault(); const st = $('.form-status', el); e.submitter && (e.submitter.disabled = true);
      try { await u.remote.requestRefund(paymentId, new FormData(e.target).get('reason')); close(); toast(hasVerifiedEmail ? 'Request sent — we’ll email you the outcome.' : 'Request sent — check Billing for updates.'); go('/billing', { replace: true }); location.reload(); }
      catch (err) { st.textContent = friendly(err); e.submitter && (e.submitter.disabled = false); }
    });
  }
}
