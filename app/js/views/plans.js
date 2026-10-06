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
// Server error codes from a purchase attempt that carry their own user-facing message.
const FORM_ERRORS = new Set(['invalid_coupon', 'billing_state_required', 'invalid_gstin', 'business_name_required', 'gstin_not_supported']);

/** Coupon popup: resolves the applied coupon code, or null if dismissed. Pricing errors show inside the form. */
function askCoupon(sel, wantsCredit) {
  return new Promise((resolve) => {
    let done = false;
    const { el, close } = openDialog(html`<h2>Apply Coupon</h2>
      <form class="form" id="cpn" novalidate>
        <label>Coupon code<input name="code" autocomplete="off" autocapitalize="characters" maxlength="30" placeholder="Enter code"></label>
        <div class="form-status" id="cpnMsg" role="alert"></div>
        <div class="row end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" id="cpnApply">Apply</button></div>
      </form>`, { title: 'Apply Coupon', cls: 'dialog-sm', onClose: () => { if (!done) resolve(null); } });
    $('#cpn', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = el.querySelector('[name=code]')?.value?.trim()?.toUpperCase() || '';
      const msg = $('#cpnMsg', el), btn = $('#cpnApply', el);
      if (!code) { msg.textContent = 'Enter a coupon code.'; return; }
      btn.disabled = true; msg.textContent = '';
      try {
        const q = await app.user.quote(sel, code, wantsCredit);
        done = true; close(); resolve({ code: q.coupon?.code || code, quote: q });
      } catch (err) { msg.textContent = friendly(err); btn.disabled = false; }
    });
  });
}

/** GST fallback: only ever shown when the server has GST enabled and demands billing details. Remembers the answer. */
function askGst(bill, base) {
  return new Promise((resolve) => {
    let done = false;
    const states = bill.states || [];
    const { el, close } = openDialog(html`<h2>Billing details</h2>
      <form class="form" id="gst" novalidate>
        <p class="muted small">Needed for your GST invoice — just this once, we remember it.</p>
        <label>State (for GST)<select name="state" required><option value="">Select your state…</option>${states.map((x) => html`<option value="${x.code}" ${x.code === base.state ? 'selected' : ''}>${x.name}</option>`)}</select></label>
        <label>Business name (optional)<input name="bname" maxlength="100" value="${base.name || ''}"></label>
        <label>GSTIN (optional)<input name="gstin" maxlength="15" autocapitalize="characters" placeholder="22AAAAA0000A1Z5" value="${base.gstin || ''}"></label>
        <div class="form-status" id="gstMsg" role="alert"></div>
        <div class="row end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save &amp; continue</button></div>
      </form>`, { title: 'Billing details', cls: 'dialog-sm', onClose: () => { if (!done) resolve(null); } });
    $('#gst', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (n) => el.querySelector(`[name=${n}]`)?.value?.trim() || '';
      if (!val('state')) { $('#gstMsg', el).textContent = 'Select your state — it decides how GST is shown on your invoice.'; return; }
      done = true; close();
      resolve({ state: val('state'), gstin: val('gstin').toUpperCase(), name: val('bname') });
    });
  });
}

/** Full-screen cancel screen (after the payment window is dismissed unpaid): Retry or back to plans. */
function failPopup() {
  return new Promise((resolve) => {
    const { el, close } = openDialog(html`<div class="fail-x">${icon('x', { size: 30 })}</div><h2>Payment Failed</h2><p class="muted">It looks like you cancelled the payment.</p><div class="fail-actions"><button class="btn btn-light block" id="fRetry">Retry Payment</button><button class="btn btn-outline block" id="fPlans">View Plans</button></div>`, { title: 'Payment Failed', cls: 'dialog-sm dlg-fail', onClose: () => resolve('plans') });
    $('#fRetry', el).onclick = () => { el.dataset.choice = 'retry'; close(); };
    el.addEventListener('close', () => resolve(el.dataset.choice || 'plans'), { once: true });
  });
}

/** Full-screen success celebration: confetti + check, dismisses itself or on tap. */
function celebrate() {
  const colors = ['#f5c518', '#b80000', '#2ecc71', '#ffffff', '#7cb0ff'];
  const bits = Array.from({ length: 28 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${colors[i % colors.length]};animation-delay:${(i % 12) * 0.12}s"></i>`).join('');
  const d = document.createElement('div');
  d.className = 'celebrate';
  d.innerHTML = html`<div class="confetti">${bits}</div><div class="cel-box"><div class="cel-check">${icon('check', { size: 46 })}</div><h2>You’re in!</h2><p>Premium unlocked — enjoy ADDABAAZ Plus.</p><button class="btn btn-light" data-cel>Start watching</button></div>`.s;
  document.body.appendChild(d);
  document.body.classList.add('no-scroll');
  const done = () => { d.remove(); document.body.classList.remove('no-scroll'); };
  d.addEventListener('click', () => { done(); go('/'); });
  setTimeout(() => { if (d.isConnected) done(); }, 4500);
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
  let creditPaise = 0, offer = null, useCredit = false;
  if (u.account && u.supportsAuth) {
    try { const c = await u.credits(); creditPaise = c.creditPaise || 0; offer = c.offer || null; } catch { /* no credit to show */ }
  }
  useCredit = creditPaise > 0;
  let wantsCredit = useCredit && creditPaise > 0;
  // Coupon + live pricing for the selected tile. `qseq` drops stale quote responses after quick tile taps.
  let coupon = '', quote = null, qseq = 0;
  const priceOf = (p) => {
    const list = p.priceINR * 100;
    if (!quote || quote.planId !== p.id) return { listPaise: list, payPaise: list, savePaise: 0 };
    const pay = quote.payablePaise ?? Math.max(0, quote.finalPaise - (wantsCredit ? quote.creditPaise || 0 : 0));
    return { listPaise: list, payPaise: pay, savePaise: Math.max(0, list - pay) };
  };
  const reprice = async () => {
    const my = ++qseq;
    quote = null;
    if (u.account && (coupon || wantsCredit)) {
      try { quote = await u.quote(sel, coupon || undefined, wantsCredit); }
      catch (e) { if (coupon) { toast(friendly(e)); coupon = ''; } }   // coupon died (expired/wrong plan) — drop it
    }
    if (my === qseq) draw();
  };

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
    const pr = sp ? priceOf(sp) : null;
    // Duration tiles + one pay button (website with payments only — canBuy already implies !isNative).
    const plusCard = html`<div class="plus-card">
      <h2>ADDABAAZ Plus</h2>
      <p class="muted small">Premium originals, early access &amp; ad-free viewing.</p>
      <ul class="perks">${perks.map((f) => html`<li>${icon('check', { size: 15 })} ${f}</li>`)}</ul>
      <div class="durs" role="radiogroup" aria-label="Billing period">${paid.map((p) => html`<button class="dur ${p.id === sel ? 'is-sel' : ''} ${p.id === cur ? 'is-current' : ''}" data-sel="${p.id}" role="radio" aria-checked="${p.id === sel}">${p.id === 'plus-yearly' ? html`<span class="dur-tag">Best Value</span>` : ''}${p.id === cur ? html`<span class="dur-tag cur">Current</span>` : ''}<b>₹${p.priceINR}</b><small>${p.interval === 'year' ? 'Year' : 'Month'}</small>${p.interval === 'year' ? html`<em>Just ₹${Math.round(p.priceINR / 12)}/month</em>` : ''}</button>`)}</div>
      ${creditPaise > 0 ? html`<label class="check credit-row"><input type="checkbox" name="usec" data-usec ${wantsCredit ? 'checked' : ''}> <span>Use my ${inr(creditPaise)} ADDABAAZ credit on this order</span></label>` : ''}
      ${sp ? html`<button class="btn btn-primary btn-lg block paybar" data-pay>${pr.payPaise === 0 ? 'Activate for free' : `${sp.id === cur ? 'Extend' : active ? 'Switch to' : 'Pay'} ${pr.savePaise > 0 ? html`<s>${inr(pr.listPaise)}</s> ` : ''}${inr(pr.payPaise)}`}</button>` : ''}
      ${coupon && quote?.coupon ? html`<p class="coupon-line"><b>${quote.coupon.code}</b> applied — you save ${inr(pr ? pr.savePaise : 0)}. <button class="linklike" data-uncoupon>Remove</button></p>` : html`<button class="linklike coupon-link" data-coupon>Apply Coupon</button>`}
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
  if (u.account && (coupon || wantsCredit)) reprice();

  // One purchase attempt: straight into checkout (saved billing details ride along). Returns 'ok',
  // 'cancelled' (payment window dismissed), or throws anything the caller must surface.
  const doBuy = async (plan) => {
    const saved = storage('ab.billing', {});
    const base = { state: saved.state || '', gstin: saved.gstin || '', name: saved.name || '' };
    try {
      await u.checkout(plan.id, { couponCode: coupon, billing: base, useCredit: wantsCredit });
    } catch (err) {
      if (err.cancelled) return 'cancelled';
      // GST-enabled servers may demand billing details: ask once, remember, retry with them.
      if (bill.gst && ['billing_state_required', 'invalid_gstin', 'business_name_required'].includes(err.code)) {
        const g = await askGst(bill, base);
        if (!g) return 'cancelled';
        store('ab.billing', g);
        await u.checkout(plan.id, { couponCode: coupon, billing: g, useCredit: wantsCredit });
        return 'ok';
      }
      throw err;
    }
    return 'ok';
  };

  ctx.root.addEventListener('change', (e) => {
    if (e.target.matches('[data-usec]')) { wantsCredit = e.target.checked && creditPaise > 0; reprice(); }
  });
  ctx.root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-sel]');
    if (t) { if (!busy && t.dataset.sel !== sel) { sel = t.dataset.sel; reprice(); } return; }
    if (e.target.closest('[data-coupon]')) {
      if (!u.account) { go('/signin?next=' + encodeURIComponent('/plans' + (next ? '?next=' + encodeURIComponent(next) : ''))); return; }
      if (busy) return;
      const r = await askCoupon(sel, wantsCredit);
      if (r) { coupon = r.code; quote = r.quote; toast(`${coupon} applied`); draw(); }
      return;
    }
    if (e.target.closest('[data-uncoupon]')) { if (!busy) { coupon = ''; reprice(); } return; }
    const pay = e.target.closest('[data-pay]');
    const b = pay ? { dataset: { plan: sel } } : e.target.closest('[data-plan]'), c = e.target.closest('[data-cancel]');
    if (!b && !c) return;
    if (busy) return;
    if (b && !u.account) { go('/signin?next=' + encodeURIComponent('/plans' + (next ? '?next=' + encodeURIComponent(next) : ''))); return; }
    busy = true;
    try {
      if (b) {
        const plan = list.find((p) => p.id === b.dataset.plan);
        for (;;) {                                                      // retry loop: the cancel screen offers another attempt
          let outcome;
          try { outcome = await doBuy(plan); }
          catch (err) {
            if (err.code === 'invalid_coupon') { coupon = ''; quote = null; toast(friendly(err)); reprice(); return; }
            if (FORM_ERRORS.has(err.code)) toast(friendly(err));
            else toast(friendly(err) + (err.status >= 500 ? ' If money was deducted, your plan will activate automatically within a few minutes.' : ''));
            return;
          }
          if (outcome === 'cancelled') { if (await failPopup() !== 'retry') return; continue; }
          break;
        }
        if (payments.provider === 'razorpay' && wantsCredit) creditPaise = 0;   // spent — don't offer it twice in one visit
        if (next) { go(next, { replace: true }); return; }
        celebrate();
      } else if (await confirmDialog({ title: 'End demo plan?', text: 'Premium videos will lock again.', confirm: 'End plan' })) { await u.cancelSubscription(); toast('Demo plan ended'); }
    } catch (err) {
      if (!err.cancelled) toast(friendly(err));
    } finally { busy = false; draw(); }
  });
}
