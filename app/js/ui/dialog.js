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
/** Promise-based confirm. Pass `icon` (icon name) for the centered glyph variant — a small,
 * brand-tinted circle above the title, the app's confirmation look. */
export function confirmDialog({ title, text = '', confirm = 'Confirm', danger = false, icon: glyph = '' }) {
  return new Promise((resolve) => {
    let result = false;
    const { el } = openDialog(html`${glyph ? html`<div class="dlg-icon${danger ? ' is-danger' : ''}">${icon(glyph, { size: 26 })}</div>` : ''}<h2>${title}</h2>${text ? html`<p class="muted">${text}</p>` : ''}<div class="row end"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="ok">${confirm}</button></div>`, { title, cls: `dialog-sm${glyph ? ' dlg-centered' : ''}`, onClose: () => resolve(result) });
    $('#ok', el).onclick = () => { result = true; el.close(); };
  });
}

/** Asks for a 4–6 digit PIN (or any short secret). Resolves with the digits, or null if cancelled. `check(pin)` may throw to show an error and keep the dialog open. */
export function pinPrompt({ title = 'Enter your PIN', text = '', confirm = 'Continue', check, onForgot } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const { el, close } = openDialog(html`<h2>${title}</h2>${text ? html`<p class="muted">${text}</p>` : ''}
      <form class="form" id="pinf" novalidate><label>PIN<input name="pin" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="6" required class="pin-input" placeholder="••••"></label>
      <div class="form-status" id="pins" role="alert"></div>${onForgot ? html`<button type="button" class="linklike" id="forgotPin">Forgot PIN?</button>` : ''}
      <div class="row end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">${confirm}</button></div></form>`, { title, cls: 'dialog-sm', onClose: () => resolve(result) });
    $('#forgotPin', el)?.addEventListener('click', () => { close(); onForgot(); });
    const input = $('[name=pin]', el); input.focus();
    $('#pinf', el).addEventListener('submit', async (e) => {
      e.preventDefault(); const pin = input.value.trim();
      if (!/^\d{4,6}$/.test(pin)) { $('#pins', el).textContent = 'The PIN is 4 to 6 digits.'; return; }
      try { if (check) await check(pin); result = pin; close(); } catch (err) { $('#pins', el).textContent = friendly(err); input.select(); }
    });
  });
}
