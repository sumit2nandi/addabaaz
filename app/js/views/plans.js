// Plans and checkout page (#/plans).
import { app } from '../app.js';
import { html, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { sectionHeader, toast } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { go } from '../router.js';
import { isNative } from '../platform.js';
import { openDialog } from '../ui/dialog.js';
import { storage, store, $ } from '../util.js';
import { friendly } from '../errors.js';

// Formats paise as ₹.
const inr = (paise) => `₹${(paise / 100).toFixed(paise % 100 ? 2 : 0)}`;
// Server error codes that are shown inside the checkout form instead of as a toast.
const FORM_ERRORS = new Set(['invalid_coupon', 'billing_state_required', 'invalid_gstin', 'business_name_required', 'gstin_not_supported']);

/** Checkout details: coupon + (when GST invoicing is on) the buyer's state and optional GSTIN. Resolves null if dismissed. */
function askCheckout({ plan, u, billing, memo, error = '' }) {
  return new Promise((resolve) => {
    let done = false, quote = null;
    const saved = storage('ab.billing', {});
    const states = billing.states || [];
    const b2b = !!(memo.gstin || saved.gstin);
    const { el, close } = openDialog(html`<h2>Checkout</h2>
      <form class="form" id="co" novalidate>
        <div class="co-total"><span>${plan.name}</span><b id="coTotal">${inr(plan.priceINR * 100)}</b></div>
        ${billing.coupons ? html`<label>Coupon code<span class="co-row"><input name="coupon" autocomplete="off" autocapitalize="characters" maxlength="30" placeholder="Have a code?" value="${memo.coupon || ''}"><button type="button" class="btn btn-ghost" id="coApply">Apply</button></span></label><div class="form-status" id="coMsg"></div>` : ''}
        ${billing.gst ? html`<label>State (for GST)<select name="state" required><option value="">Select your state…</option>${states.map((x) => html`<option value="${x.code}" ${x.code === (memo.state || saved.state) ? 'selected' : ''}>${x.name}</option>`)}</select></label>
          <label class="check"><input type="checkbox" name="b2b" ${b2b ? 'checked' : ''}> <span>I have a GST number and want it on the invoice</span></label>
          <div id="b2bBox" ${b2b ? '' : 'hidden'} class="form"><label>Business name<input name="bname" maxlength="100" value="${memo.name || saved.name || ''}"></label><label>GSTIN<input name="gstin" maxlength="15" autocapitalize="characters" placeholder="22AAAAA0000A1Z5" value="${memo.gstin || saved.gstin || ''}"></label></div>` : ''}
        <div class="form-status" id="coErr" role="alert">${error}</div>
        <button class="btn btn-primary btn-lg block" type="submit" id="coPay">Pay ${inr(plan.priceINR * 100)}</button>
        <p class="muted co-note">Prices include GST. You’ll pay securely with Razorpay (UPI, cards, netbanking, wallets).</p>
      </form>`, { title: 'Checkout', cls: 'dialog-sm', onClose: () => { if (!done) resolve(null); } });
    const f = $('#co', el), val = (n) => f.elements[n]?.value?.trim() || '';
    const paint = () => { const p = quote ? quote.finalPaise : plan.priceINR * 100; $('#coTotal', el).textContent = inr(p); $('#coPay', el).textContent = p === 0 ? 'Activate for free' : `Pay ${inr(p)}`; };
    $('#b2bBox', el) && f.elements.b2b.addEventListener('change', () => { $('#b2bBox', el).hidden = !f.elements.b2b.checked; });
    $('#coApply', el)?.addEventListener('click', async () => {
      const msg = $('#coMsg', el); const code = val('coupon'); quote = null; msg.className = 'form-status'; msg.textContent = '';
      if (!code) { paint(); return; }
      try { quote = await u.quote(plan.id, code); msg.className = 'form-status success'; msg.textContent = `${quote.coupon.code} applied — you save ${inr(quote.discountPaise)}.`; }
      catch (e) { msg.textContent = friendly(e); }
      paint();
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = $('#coErr', el);
      if (billing.gst && !val('state') && !(f.elements.b2b?.checked && val('gstin'))) { err.textContent = 'Select your state — it decides how GST is shown on your invoice.'; return; }
      const withGstin = billing.gst && f.elements.b2b?.checked;
      const out = { coupon: val('coupon').toUpperCase(), state: val('state'), gstin: withGstin ? val('gstin').toUpperCase() : '', name: withGstin ? val('bname') : '' };
      if (billing.gst) store('ab.billing', { state: out.state, gstin: out.gstin, name: out.name });
      done = true; close(); resolve(out);
    });
  });
}

/** Plans & checkout. Premium video plays only for a signed-in viewer with an active plan.
 *  `?next=/watch/<id>` (set by the locked-video wall) sends the viewer back to that video after paying. */
export default async function plans(ctx) {
  const u = app.user;
  ctx.setTitle('Plans');
  const next = /^\/(?!\/)/.test(ctx.query.next || '') ? ctx.query.next : '';
  if (!u.supportsAuth) {
    ctx.root.innerHTML = html`<div class="page"><div class="empty">${icon('crown', { size: 44 })}<h2>Plans need the ADDABAAZ server</h2><p>This copy of ADDABAAZ is running without the API, so subscriptions aren’t available. Free episodes and reels work as usual.</p><a class="btn btn-primary" href="#/">Keep watching</a></div></div>`.s; return;
  }
  const { plans: list, payments, billing: bill } = await u.plans();
  const memo = {};
  const canBuy = !isNative && payments.provider !== 'none';
  let busy = false;

  const draw = () => {
    const s = u.subscription || {}, active = u.isPremium, cur = active ? s.planId : 'free';
    const status = active
      ? html`<div class="notice ok">${icon('check', { size: 18 })} Your plan is active until <b>${fmtDate(s.expiresAt)}</b>. Renew any time — the extra time is added to the end.</div>`
      : s.status === 'expired' ? html`<div class="notice">${icon('info', { size: 18 })} Your plan expired on ${fmtDate(s.expiresAt)}. Choose a plan to watch premium videos again.</div>` : '';
    const why = isNative
      ? html`<div class="notice">${icon('info', { size: 18 })} Plans are managed on the ADDABAAZ website. Once you’ve subscribed with this account, premium videos unlock here automatically.</div>`
      : payments.provider === 'mock' ? html`<div class="notice">${icon('info', { size: 18 })} Demo checkout — no real payment is taken. Add Razorpay keys on the API to go live (docs/PREMIUM.md).</div>`
      : payments.provider === 'none' ? html`<div class="notice">${icon('info', { size: 18 })} Payments aren’t available right now. Please try again later.</div>` : '';
    ctx.root.innerHTML = html`<div class="page">
      ${sectionHeader({ tag: 'ADDABAAZ Plus', title: 'Choose your plan', subtitle: 'Pay once for the period — no auto-renewal, nothing to cancel.' })}
      ${status}${why}
      <div class="plans">${list.map((p) => html`<article class="plan ${p.id === cur ? 'current' : ''} ${p.id === 'plus-yearly' ? 'best' : ''}">
        ${p.id === 'plus-yearly' ? html`<span class="badge">Best value</span>` : ''}
        <h2>${p.name}</h2><div class="price">${p.priceINR ? html`₹${p.priceINR}<small>/${p.interval}</small>` : 'Free'}</div>
        <ul>${p.features.map((f) => html`<li>${icon('check', { size: 16 })} ${f}</li>`)}</ul>
        ${p.id === 'free' ? html`<button class="btn btn-ghost block" disabled>${cur === 'free' ? 'Current plan' : 'Included'}</button>`
          : !canBuy ? (p.id === cur ? html`<button class="btn btn-ghost block" disabled>Current plan</button>` : '')
          : html`<button class="btn btn-primary block" data-plan="${p.id}">${p.id === cur ? 'Extend' : active ? 'Switch to' : 'Get'} ${p.interval === 'year' ? 'yearly' : 'monthly'} plan</button>`}
      </article>`)}</div>
      ${s.demo ? html`<p class="muted" style="margin-top:18px"><button class="btn btn-ghost" data-cancel>End demo plan</button></p>` : ''}
      <p class="muted" style="margin-top:18px;font-size:13px">${isNative
        ? html`Prices in INR, inclusive of GST. Subscriptions are bought on the ADDABAAZ website, never inside this app — your plan unlocks premium video here as soon as the payment is confirmed. ${u.account ? html`<a href="#/billing">Billing & invoices</a>` : ''}`
        : html`Prices in INR, inclusive of GST. UPI, cards, netbanking and wallets via Razorpay. ${u.account ? html`<a href="#/billing">Billing & invoices</a>` : ''}`}</p>
    </div>`.s;
  };
  draw();

  ctx.root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-plan]'), c = e.target.closest('[data-cancel]');
    if (!b && !c) return;
    if (busy) return;
    if (b && !u.account) { go('/signin?next=' + encodeURIComponent('/plans' + (next ? '?next=' + encodeURIComponent(next) : ''))); return; }
    busy = true;
    try {
      if (b) {
        const plan = list.find((p) => p.id === b.dataset.plan);
        let opts = { couponCode: '', billing: {} };
        if (payments.provider === 'razorpay') {                          // coupon + GST details (the demo provider skips this)
          let error = '';
          for (;;) {                                                      // reopen with the server's message if it rejects the form
            const a = await askCheckout({ plan, u, billing: bill, memo: memo, error });
            if (!a) return;
            Object.assign(memo, a);
            opts = { couponCode: a.coupon, billing: { state: a.state, gstin: a.gstin, name: a.name } };
            try { await u.checkout(plan.id, opts); break; }
            catch (err) { if (err.cancelled) return; if (FORM_ERRORS.has(err.code)) { error = err.message; continue; } throw err; }
          }
        } else await u.checkout(plan.id, opts);
        toast('You’re in! Premium unlocked 🎉');
        if (next) { go(next, { replace: true }); return; }
      } else if (await confirmDialog({ title: 'End demo plan?', text: 'Premium videos will lock again.', confirm: 'End plan' })) { await u.cancelSubscription(); toast('Demo plan ended'); }
    } catch (err) {
      if (!err.cancelled) toast(friendly(err) + (b && err.status >= 500 ? ' If money was deducted, your plan will activate automatically within a few minutes.' : ''));
    } finally { busy = false; draw(); }
  });
}
