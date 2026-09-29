import { html, $ } from '../util.js';
import { icon } from '../icons.js';

/** Accessible modal built on <dialog>. Returns { el, close }. */
export function openDialog(content, { title = '', cls = '', onClose } = {}) {
  const d = document.createElement('dialog');
  d.className = 'dialog ' + cls;
  d.setAttribute('aria-label', title || 'Dialog');
  d.innerHTML = html`<button type="button" class="dlg-x icon-btn" aria-label="Close" data-close>${icon('x', { size: 22 })}</button><div class="dlg-body">${content}</div>`.s;
  document.body.appendChild(d);
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  d.addEventListener('close', () => { d.remove(); onClose?.(); });
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  return { el: d, close: () => d.close() };
}
/** Promise-based confirm. */
export function confirmDialog({ title, text = '', confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const { el } = openDialog(html`<h2>${title}</h2>${text ? html`<p class="muted">${text}</p>` : ''}<div class="row end"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="ok">${confirm}</button></div>`, { title, cls: 'dialog-sm', onClose: () => resolve(result) });
    $('#ok', el).onclick = () => { result = true; el.close(); };
  });
}
