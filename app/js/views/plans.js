import { app } from '../app.js';
import { html, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { sectionHeader, toast } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { go } from '../router.js';
import { isNative } from '../platform.js';

/** Plans & checkout. Premium video plays only for a signed-in viewer with an active plan.
 *  `?next=/watch/<id>` (set by the locked-video wall) sends the viewer back to that video after paying. */
export default async function plans(ctx) {
  const u = app.user;
  ctx.setTitle('Plans');
  const next = /^\/(?!\/)/.test(ctx.query.next || '') ? ctx.query.next : '';
  if (!u.supportsAuth) {
    ctx.root.innerHTML = html`<div class="page"><div class="empty">${icon('crown', { size: 44 })}<h2>Plans need the ADDABAAZ server</h2><p>This copy of ADDABAAZ is running without the API, so subscriptions aren’t available. Free episodes and reels work as usual.</p><a class="btn btn-primary" href="#/">Keep watching</a></div></div>`.s; return;
  }
  const { plans: list, payments } = await u.plans();
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
      <p class="muted" style="margin-top:18px;font-size:13px">Prices in INR. UPI, cards, netbanking and wallets via Razorpay.</p>
    </div>`.s;
  };
  draw();

  ctx.root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-plan]'), c = e.target.closest('[data-cancel]');
    if (!b && !c) return;
    if (busy) return;
    if (b && !u.account) { go('/signin?next=' + encodeURIComponent('/plans' + (next ? '?next=' + encodeURIComponent(next) : ''))); return; }
    busy = true; if (b) b.disabled = true;
    try {
      if (b) {
        await u.checkout(b.dataset.plan);
        toast('You’re in! Premium unlocked 🎉');
        if (next) { go(next, { replace: true }); return; }
      } else if (await confirmDialog({ title: 'End demo plan?', text: 'Premium videos will lock again.', confirm: 'End plan' })) { await u.cancelSubscription(); toast('Demo plan ended'); }
    } catch (err) {
      if (!err.cancelled) toast(err.message + (b && err.status >= 500 ? ' If money was deducted, your plan will activate automatically within a few minutes.' : ''));
    } finally { busy = false; draw(); }
  });
}
