import { html, fmtDate } from '../util.js';
import { icon } from '../icons.js';

export function accountPlan(user) {
  const subscription = user.subscription || {};
  const active = user.isPremium;
  const period = subscription.planId === 'plus-yearly' ? 'Yearly' : subscription.planId === 'plus-monthly' ? 'Monthly' : '';
  const title = active
    ? html`<span class="brand-lockup"><b>ADDA</b><i>BAAZ</i> <em class="premium-word">premium</em></span>${period ? html`<span class="account-plan-period">${period}</span>` : ''}`
    : 'Free';
  const validDate = subscription.expiresAt && Number.isFinite(Date.parse(subscription.expiresAt));
  const expired = !active && (subscription.status === 'expired' || (subscription.planId !== 'free' && validDate && Date.parse(subscription.expiresAt) <= Date.now()));
  return html`<section class="account-current-plan" aria-labelledby="currentPlanTitle">
    <div><h2 class="account-field-label" id="currentPlanTitle">Current Plan</h2><p class="account-plan-name">${title}</p>
      <p class="account-field-help">${active ? validDate ? `Active until ${fmtDate(subscription.expiresAt)}` : 'Active' : expired ? validDate ? `Premium expired on ${fmtDate(subscription.expiresAt)}` : 'Premium expired' : 'Free access'}</p>
    </div><a class="icon-btn" href="#/plans" aria-label="View plan details" title="View plan details">${icon('right', { size: 20 })}</a>
  </section>`;
}
