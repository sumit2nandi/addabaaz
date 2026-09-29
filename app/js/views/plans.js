import { app } from '../app.js';
import { CONFIG } from '../config.js';
import { html } from '../util.js';
import { icon } from '../icons.js';
import { sectionHeader, toast } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { go } from '../router.js';

export default async function plans(ctx) {
  const u = app.user;
  ctx.setTitle('Plans');
  if (!CONFIG.premiumEnabled) {
    ctx.root.innerHTML = html`<div class="page"><div class="empty">${icon('crown', { size: 44 })}<h2>ADDABAAZ Plus is coming soon</h2><p>Everything on ADDABAAZ is free to watch today. Premium originals and early access are on the way.</p><a class="btn btn-primary" href="#/">Keep watching</a></div></div>`.s; return;
  }
  const list = await u.plans();
  const draw = () => {
    const cur = u.subscription?.planId || 'free';
    ctx.root.innerHTML = html`<div class="page">
      ${sectionHeader({ tag: 'ADDABAAZ Plus', title: 'Choose your plan', subtitle: 'Cancel any time.' })}
      ${u.subscription?.demo ? html`<div class="notice">${icon('info', { size: 18 })} Demo checkout — no real payment is taken. Connect a payment provider on the API to go live (see docs/ARCHITECTURE.md).</div>` : ''}
      <div class="plans">${list.map((p) => html`<article class="plan ${p.id === cur ? 'current' : ''} ${p.id === 'plus-yearly' ? 'best' : ''}">
        ${p.id === 'plus-yearly' ? html`<span class="badge">Best value</span>` : ''}
        <h2>${p.name}</h2><div class="price">${p.priceINR ? html`₹${p.priceINR}<small>/${p.interval}</small>` : 'Free'}</div>
        <ul>${p.features.map((f) => html`<li>${icon('check', { size: 16 })} ${f}</li>`)}</ul>
        ${p.id === cur ? html`<button class="btn btn-ghost block" disabled>Current plan</button>` : p.id === 'free' ? html`<button class="btn btn-ghost block" data-cancel>Switch to Free</button>` : html`<button class="btn btn-primary block" data-plan="${p.id}">Choose ${p.name}</button>`}
      </article>`)}</div></div>`.s;
  };
  draw();
  ctx.root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-plan]'), c = e.target.closest('[data-cancel]');
    if (!b && !c) return;
    if (u.supportsAuth && !u.account) { go('/signin?next=' + encodeURIComponent('/plans')); return; }
    try {
      if (b) { await u.subscribe(b.dataset.plan); toast('Plan updated 🎉'); }
      else if (await confirmDialog({ title: 'Switch to Free?', text: 'You’ll lose access to premium titles.', confirm: 'Switch to Free' })) { await u.cancelSubscription(); toast('Plan cancelled'); }
      draw();
    } catch (err) { toast(err.message); }
  });
}
