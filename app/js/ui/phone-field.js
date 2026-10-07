// Split phone fields: a tappable country-code button beside the national number, and the searchable
// "Select a country" sheet that button opens. Shared by sign-in (SMS code), support, the project
// inquiry form and the add-mobile-number dialog, so every phone input looks and behaves the same.
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { openDialog } from './dialog.js';
import { COUNTRY_CHOICES } from '../data/countries.js';

/** The country picker sheet. Resolves with { name, dial } of the chosen country, or null on close. */
export function pickCountry(currentDial = '91') {
  return new Promise((resolve) => {
    let result = null;
    const { el } = openDialog(html`<h2>Select a country</h2>
      <input type="search" class="country-search" placeholder="Search" aria-label="Search country or code">
      <div class="country-list" role="listbox" aria-label="Countries"></div>`,
      { title: 'Select a country', cls: 'dialog-sm country-picker', onClose: () => resolve(result) });
    const list = $('.country-list', el), search = $('.country-search', el);
    const rows = () => {
      const q = search.value.trim().toLowerCase();
      const dialQ = q.replace(/\D/g, '');
      const shown = COUNTRY_CHOICES.filter((c) => !q
        || c.name.toLowerCase().includes(q)
        || (!!dialQ && c.dial.includes(dialQ))
        || c.code.toLowerCase().startsWith(q));
      list.innerHTML = shown.map((c) => `<button type="button" class="country-row${c.dial === currentDial ? ' on' : ''}" role="option" aria-selected="${c.dial === currentDial}" data-dial="${c.dial}" data-name="${c.name}"><span>${c.name}</span><b>+${c.dial}</b></button>`).join('')
        || '<p class="muted country-empty">No country found.</p>';
    };
    search.addEventListener('input', rows);
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.country-row');
      if (!row) return;
      result = { dial: row.dataset.dial, name: row.dataset.name };
      el.close();
    });
    rows();
    search.focus();
  });
}

/** The split field fragment: "+<dial> ˅ | [national number]". The wrapper remembers the dial code. */
export function phoneSplit({ dial = '91', value = '', placeholder = 'Mobile number', maxlength = 14, autocomplete = 'tel-national', required = false, ariaLabel = 'Phone number' } = {}) {
  return html`<span class="phone-split" data-phone-split data-dial="${dial}">
    <button type="button" class="phone-cc" data-cc-btn aria-label="Select country code"><span data-cc-dial>+${dial}</span>${icon('chev-down', { size: 14 })}</button>
    <input name="phone" type="tel" inputmode="numeric" autocomplete="${autocomplete}" maxlength="${maxlength}" placeholder="${placeholder}" aria-label="${ariaLabel}" ${required ? 'required' : ''} value="${value}" data-phone-national>
  </span>`;
}

/** Wires every split field under `root` to the picker (delegated). Returns the cleanup function. */
export function wirePhoneSplits(root, { onCountry } = {}) {
  const handler = async (e) => {
    const btn = e.target.closest('[data-cc-btn]');
    if (!btn || !root.contains(btn)) return;
    const wrap = btn.closest('[data-phone-split]');
    const picked = await pickCountry(wrap.dataset.dial || '91');
    if (!picked || picked.dial === wrap.dataset.dial || !wrap.isConnected) return;
    wrap.dataset.dial = picked.dial;
    $('[data-cc-dial]', wrap).textContent = `+${picked.dial}`;
    $('[data-phone-national]', wrap)?.focus();
    onCountry?.(picked, wrap);
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener('click', handler);
}

/** What a form submits for a split field: "+<dial> <national digits>", or '' when left empty. */
export function splitValue(wrap) {
  const dial = wrap?.dataset?.dial || '91';
  const digits = wrap?.querySelector?.('[data-phone-national]')?.value.replace(/\D/g, '') || '';
  return digits ? `+${dial} ${digits}` : '';
}
