import { html } from '../util.js';
import { icon } from '../icons.js';

const INLINE = new Set(['playback', 'security', 'kids', 'notify']);
export function accountGroup(group) {
  const label = html`${icon(group.ic, { size: 22 })}<span><b>${group.title}</b><small>${group.sub}</small></span>${icon('right', { size: 18, cls: 'chev' })}`;
  if (!INLINE.has(group.id)) return html`<a class="row-link" href="${group.href}">${label}</a>`;
  return html`<div class="account-accordion" data-group="${group.id}">
    <button type="button" class="row-link accordion-toggle" id="toggle-${group.id}" aria-expanded="false" aria-controls="panel-${group.id}">${label}</button>
    <div class="accordion-panel" id="panel-${group.id}" role="region" aria-labelledby="toggle-${group.id}" aria-hidden="true" inert><div class="accordion-clip"><div class="accordion-body"></div></div></div>
  </div>`;
}

export function wireAccountAccordion(root, render, wire, ctx) {
  root.querySelectorAll('.account-accordion').forEach((item) => {
    const button = item.querySelector('.accordion-toggle');
    const panel = item.querySelector('.accordion-panel');
    const body = item.querySelector('.accordion-body');
    let initialized = false;
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      if (open && !initialized) {
        body.innerHTML = String(render(item.dataset.group));
        wire(item.dataset.group, body, ctx);
        initialized = true;
      }
      button.setAttribute('aria-expanded', String(open));
      panel.setAttribute('aria-hidden', String(!open));
      panel.toggleAttribute('inert', !open);
      item.classList.toggle('is-open', open);
    });
  });
}
