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
function askCheckout({ plan, u, billing, memo, error = '', creditPaise = 0, useCredit = false }) {
  return new Promise((resolve) => {
    let done = false, quote = null, wantsCredit = useCredit && creditPaise > 0;
    const saved = storage('ab.billing', {});
    const states = billing.states || [];
    const b2b = !!(memo.gstin || saved.gstin);
    const { el, close } = openDialog(html`<h2>Checkout</h2>
      <form class="form" id="co" novalidate>
        <div class="co-total"><span>${plan.name}</span><b id="coTotal">${inr(plan.priceINR * 100)}</b></div>
        ${billing.coupons ? html`<label>Coupon code<span class="co-row"><input name="coupon" autocomplete="off" autocapitalize="characters" maxlength="30" placeholder="Have a code?" value="${memo.coupon || ''}"><button type="button" class="btn btn-ghost" id="coApply">Apply</button></span></label><div class="form-status" id="coMsg"></div>` : ''}
        ${creditPaise > 0 ? html`<label class="check"><input type="checkbox" name="usec" ${wantsCredit ? 'checked' : ''}> <span>Use my ${inr(creditPaise)} ADDABAAZ credit on this order</span></label>` : ''}
        ${billing.gst ? html`<label>State (for GST)<select name="state" required><option value="">Select your state…</option>${states.map((x) => html`<option value="${x.code}" ${x.code === (memo.state || saved.state) ? 'selected' : ''}>${x.name}</option>`)}</select></label>
          <label class="check"><input type="checkbox" name="b2b" ${b2b ? 'checked' : ''}> <span>I have a GST number and want it on the invoice</span></label>
          <div id="b2bBox" ${b2b ? '' : 'hidden'} class="form"><label>Business name<input name="bname" maxlength="100" value="${memo.name || saved.name || ''}"></label><label>GSTIN<input name="gstin" maxlength="15" autocapitalize="characters" placeholder="22AAAAA0000A1Z5" value="${memo.gstin || saved.gstin || ''}"></label></div>` : ''}
        <div class="form-status" id="coErr" role="alert">${error}</div>
        <button class="btn btn-primary btn-lg block" type="submit" id="coPay">Pay ${inr(plan.priceINR * 100)}</button>
        <p class="muted co-note">Prices include GST. You’ll pay securely with Razorpay (UPI, cards, netbanking, wallets).</p>
      </form>`, { title: 'Checkout', cls: 'dialog-sm', onClose: () => { if (!done) resolve(null); } });
    const f = $('#co', el), val = (n) => f.elements[n]?.value?.trim() || '';
    // The total is the price after the coupon and, when the box is ticked, after credit.
    const paint = () => {
      const final = quote ? quote.finalPaise : plan.priceINR * 100;
      const credit = wantsCredit ? (quote?.creditPaise || 0) : 0;
      const pay = final - credit;
      const total = $('#coTotal', el);
      total.innerHTML = credit > 0 ? `${inr(pay)} <s class="muted">${inr(final)}</s> <em class="pill">credit ${inr(credit)}</em>` : inr(final);
      $('#coPay', el).textContent = pay === 0 ? 'Activate for free' : `Pay ${inr(pay)}`;
    };
    f.elements.usec?.addEventListener('change', async () => {
      wantsCredit = !!f.elements.usec.checked;
      // Re-price with the server when the box changes: only the server knows how much credit applies.
      if (wantsCredit && !quote?.creditPaise) { try { quote = await u.quote(plan.id, val('coupon'), true); } catch { /* keep the old quote */ } }
      paint();
    });
    $('#b2bBox', el) && f.elements.b2b.addEventListener('change', () => { $('#b2bBox', el).hidden = !f.elements.b2b.checked; });
    $('#coApply', el)?.addEventListener('click', async () => {
      const msg = $('#coMsg', el); const code = val('coupon'); quote = null; msg.className = 'form-status'; msg.textContent = '';
      if (!code) { paint(); return; }
      try { quote = await u.quote(plan.id, code, wantsCredit); msg.className = 'form-status success'; msg.textContent = `${quote.coupon.code} applied — you save ${inr(quote.discountPaise)}.`; }
      catch (e) { msg.textContent = friendly(e); }
      paint();
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = $('#coErr', el);
      if (billing.gst && !val('state') && !(f.elements.b2b?.checked && val('gstin'))) { err.textContent = 'Select your state — it decides how GST is shown on your invoice.'; return; }
      const withGstin = billing.gst && f.elements.b2b?.checked;
      const out = { coupon: val('coupon').toUpperCase(), state: val('state'), gstin: withGstin ? val('gstin').toUpperCase() : '', name: withGstin ? val('bname') : '', useCredit: wantsCredit };
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
  // Selected billing period for the duration tiles (website checkout only). Defaults to the current
  // paid plan when subscribed, otherwise to yearly (best value); tile taps update it and repaint.
  let sel = u.isPremium && u.subscription?.planId !== 'free' ? u.subscription.planId : 'plus-yearly';
  if (!list.some((p) => p.id === sel)) sel = list.find((p) => p.id !== 'free')?.id || 'plus-yearly';
  // Promotional credit (welcome bonus / referrals): best effort — a failure here must never break the page.
  let creditPaise = 0, offer = null;
  if (u.account && u.supportsAuth) {
    try { const c = await u.credits(); creditPaise = c.creditPaise || 0; offer = c.offer || null; } catch { /* no credit to show */ }
  }

  const draw = () => {
    const s = u.subscription || {}, active = u.isPremium, cur = active ? s.planId : 'free';
    const status = active
      ? html`<div class="notice ok">${icon('check', { size: 18 })}<span>Your plan is active until <b>${fmtDate(s.expiresAt)}</b>.${isNative ? ' Access is linked to this ADDABAAZ account.' : ' Renew any time — the extra time is added to the end.'}</span></div>`
      : s.status === 'expired' ? html`<div class="notice">${icon('info', { size: 18 })}<span>Your plan expired on ${fmtDate(s.expiresAt)}.${isNative ? '' : ' Choose a plan to watch premium videos again.'}</span></div>` : '';
    const why = isNative
      ? html`<div class="notice">${icon('info', { size: 18 })}<span>This app does not offer purchases or payment links. Memberships and payments are managed separately on the ADDABAAZ website. If you already have access, sign in with the same account and it will appear here automatically.</span></div>`
      : payments.provider === 'mock' ? html`<div class="notice">${icon('info', { size: 18 })}<span>Demo checkout — no real payment is taken. Add Razorpay keys on the API to go live (docs/PREMIUM.md).</span></div>`
      : payments.provider === 'none' ? html`<div class="notice">${icon('info', { size: 18 })}<span>Payments aren’t available right now. Please try again later.</span></div>` : '';
    const paid = list.filter((p) => p.id !== 'free');
    if (!paid.some((p) => p.id === sel)) sel = paid[0]?.id || sel;
    const perks = (list.find((p) => p.id === 'plus-monthly') || paid[0] || { features: [] }).features;
    const sp = paid.find((p) => p.id === sel) || paid[0];
    // Duration tiles + one pay button (website with payments only — canBuy already implies !isNative).
    const plusCard = html`<div class="plus-card">
      <h2>ADDABAAZ Plus</h2>
      <p class="muted small">Premium originals, early access &amp; ad-free viewing.</p>
      <ul class="perks">${perks.map((f) => html`<li>${icon('check', { size: 15 })} ${f}</li>`)}</ul>
      <div class="durs" role="radiogroup" aria-label="Billing period">${paid.map((p) => html`<button class="dur ${p.id === sel ? 'is-sel' : ''} ${p.id === cur ? 'is-current' : ''}" data-sel="${p.id}" role="radio" aria-checked="${p.id === sel}">${p.id === 'plus-yearly' ? html`<span class="dur-tag">Best Value</span>` : ''}${p.id === cur ? html`<span class="dur-tag cur">Current</span>` : ''}<b>₹${p.priceINR}</b><small>${p.interval === 'year' ? 'Year' : 'Month'}</small>${p.interval === 'year' ? html`<em>Just ₹${Math.round(p.priceINR / 12)}/month</em>` : ''}</button>`)}</div>
      ${sp ? html`<button class="btn btn-primary btn-lg block paybar" data-pay>${sp.id === cur ? 'Extend' : active ? 'Switch to' : 'Pay'} ₹${sp.priceINR}</button>` : ''}
      <p class="free-line">Free · ${cur === 'free' ? 'your current plan' : 'included forever'}</p>
    </div>`;
    // Native apps and payment-less servers: read-only cards (no prices in native builds, no purchase buttons).
    const legacyCards = html`<div class="plans">${list.map((p) => html`<article class="plan ${p.id === cur ? 'current' : ''} ${!isNative && p.id === 'plus-yearly' ? 'best' : ''} ${p.id === 'free' ? 'free' : ''}">
        ${!isNative && p.id === 'plus-yearly' && p.id !== cur ? html`<span class="badge">Best Value</span>` : ''}
        ${p.id === cur && p.id !== 'free' ? html`<span class="badge cur">Current plan</span>` : ''}
        <h2>${p.name}</h2>${!isNative ? html`<div class="price">₹${p.priceINR}<small>/${p.interval}</small></div>` : ''}
        <ul>${p.features.map((f) => html`<li>${icon('check', { size: 16 })} ${f}</li>`)}</ul>
        ${p.id === 'free' ? html`<button class="btn btn-ghost block" disabled>${cur === 'free' ? 'Current plan' : 'Included'}</button>`
          : !canBuy ? (p.id === cur ? html`<button class="btn btn-ghost block" disabled>Current plan</button>` : '')
          : html`<button class="btn btn-primary block" data-plan="${p.id}">${p.id === cur ? 'Extend' : active ? 'Switch to' : 'Get'} ${p.interval === 'year' ? 'yearly' : 'monthly'} plan</button>`}
      </article>`)}</div>`;
    ctx.root.innerHTML = html`<div class="page">
      ${sectionHeader(isNative
        ? { tag: 'ADDABAAZ Plus', title: 'Your access', subtitle: 'View the access currently linked to your ADDABAAZ account.' }
        : { tag: 'ADDABAAZ Plus', title: 'Choose your plan', subtitle: 'Pay once for the period — no auto-renewal, nothing to cancel.' })}
      ${status}${why}
      ${!isNative && creditPaise > 0 ? html`<div class="notice ok">${icon('gift', { size: 18 })}<span>You have <b>${inr(creditPaise)}</b> of ADDABAAZ credit${offer?.expiryDays ? html` — it expires ${offer.expiryDays} days after it was added` : ''}. Tick “use my credit” at checkout and it comes straight off the price.</span></div>` : ''}
      ${canBuy ? plusCard : legacyCards}
      ${s.demo ? html`<p class="muted" style="margin-top:18px"><button class="btn btn-ghost" data-cancel>End demo plan</button></p>` : ''}
      <p class="muted" style="margin-top:18px;font-size:13px">${isNative
        ? html`No purchase can be started or completed in this app. Existing members can view past invoices and refunds here. ${u.account ? html`<a href="#/billing">Billing & invoices</a>` : ''}`
        : html`Prices in INR, inclusive of GST. UPI, cards, netbanking and wallets via Razorpay. ${u.account ? html`<a href="#/billing">Billing & invoices</a>` : ''}`}</p>
    </div>`.s;
  };
  draw();

  ctx.root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-sel]');
    if (t) { if (!busy && t.dataset.sel !== sel) { sel = t.dataset.sel; draw(); } return; }
    const pay = e.target.closest('[data-pay]');
    const b = pay ? { dataset: { plan: sel } } : e.target.closest('[data-plan]'), c = e.target.closest('[data-cancel]');
    if (!b && !c) return;
    if (busy) return;
    if (b && !u.account) { go('/signin?next=' + encodeURIComponent('/plans' + (next ? '?next=' + encodeURIComponent(next) : ''))); return; }
    busy = true;
    try {
      if (b) {
        const plan = list.find((p) => p.id === b.dataset.plan);
        let opts = { couponCode: '', billing: {}, useCredit: creditPaise > 0 };
        if (payments.provider === 'razorpay') {                          // coupon + GST details (the demo provider skips this)
          let error = '';
          for (;;) {                                                      // reopen with the server's message if it rejects the form
            const a = await askCheckout({ plan, u, billing: bill, memo, error, creditPaise, useCredit: opts.useCredit });
            if (!a) return;
            Object.assign(memo, a);
            opts = { couponCode: a.coupon, billing: { state: a.state, gstin: a.gstin, name: a.name }, useCredit: !!a.useCredit };
            try { await u.checkout(plan.id, opts); break; }
            catch (err) { if (err.cancelled) return; if (FORM_ERRORS.has(err.code)) { error = err.message; continue; } throw err; }
          }
        } else await u.checkout(plan.id, opts);
        toast('You’re in! Premium unlocked 🎉');
        if (payments.provider === 'razorpay' && opts.useCredit) creditPaise = 0;   // spent — don't offer it twice in one visit
        if (next) { go(next, { replace: true }); return; }
      } else if (await confirmDialog({ title: 'End demo plan?', text: 'Premium videos will lock again.', confirm: 'End plan' })) { await u.cancelSubscription(); toast('Demo plan ended'); }
    } catch (err) {
      if (!err.cancelled) toast(friendly(err) + (b && err.status >= 500 ? ' If money was deducted, your plan will activate automatically within a few minutes.' : ''));
    } finally { busy = false; draw(); }
  });
}
