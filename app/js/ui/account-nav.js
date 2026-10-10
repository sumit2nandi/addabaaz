// Desktop account navigation. Callers pass the same permission-filtered groups as Profile.
import { html } from '../util.js';
import { icon } from '../icons.js';

export function accountNav(groups, active) {
  return html`<nav class="account-sidebar" aria-label="Account settings">
    <a class="account-overview" href="#/account" ${active === 'overview' ? html`aria-current="page"` : ''}>${icon('user', { size: 20 })}<span>Account Overview</span></a>
    ${groups.map((g) => html`<a href="${g.href}" ${g.id === active ? html`aria-current="page"` : ''}>${icon(g.ic, { size: 20 })}<span>${g.title}</span></a>`)}
  </nav>`;
}
