// Modal dialogs built on the native <dialog> element (focus trap and Esc key come for free).
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { friendly } from '../errors.js';

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

/** Asks for a 4–6 digit PIN (or any short secret). Resolves with the digits, or null if cancelled. `check(pin)` may throw to show an error and keep the dialog open. */
export function pinPrompt({ title = 'Enter your PIN', text = '', confirm = 'Continue', check } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const { el, close } = openDialog(html`<h2>${title}</h2>${text ? html`<p class="muted">${text}</p>` : ''}
      <form class="form" id="pinf" novalidate><label>PIN<input name="pin" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="6" required class="pin-input" placeholder="••••"></label>
      <div class="form-status" id="pins" role="alert"></div>
      <div class="row end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">${confirm}</button></div></form>`, { title, cls: 'dialog-sm', onClose: () => resolve(result) });
    const input = $('[name=pin]', el); input.focus();
    $('#pinf', el).addEventListener('submit', async (e) => {
      e.preventDefault(); const pin = input.value.trim();
      if (!/^\d{4,6}$/.test(pin)) { $('#pins', el).textContent = 'The PIN is 4 to 6 digits.'; return; }
      try { if (check) await check(pin); result = pin; close(); } catch (err) { $('#pins', el).textContent = friendly(err); input.select(); }
    });
  });
}
