// Every phone input is split into a tappable country code and the national number, with the shared
// searchable "Select a Country" sheet — sign-in (SMS code), support, project inquiry, add-number.
// Run: node --test test/frontend/phone-split.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

test('country data leads with the popular five and splits stored numbers back apart', async () => {
  const { COUNTRY_CHOICES, POPULAR, splitInitial } = await import('../../app/js/data/countries.js');
  assert.deepEqual(POPULAR, ['IN', 'BD', 'AU', 'GB', 'US']);
  assert.deepEqual(COUNTRY_CHOICES.slice(0, 5).map((c) => c.name),
    ['India', 'Bangladesh', 'Australia', 'United Kingdom', 'United States'], 'popular first, in order');
  assert.ok(COUNTRY_CHOICES.length > 200, 'the full dial list is available');
  for (const c of COUNTRY_CHOICES) assert.match(c.dial, /^\d{1,4}$/);
  assert.deepEqual(splitInitial('+91 90000 00000'), { dial: '91', rest: '9000000000' });
  assert.deepEqual(splitInitial('919812345678'), { dial: '91', rest: '9812345678' });
  assert.deepEqual(splitInitial('447700900000'), { dial: '44', rest: '7700900000' });
  assert.deepEqual(splitInitial('9812345678').dial, '91', 'bare national numbers keep the default');
});

test('the picker sheet searches and the split field remembers the chosen code', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><main></main></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  const dialogProto = Object.getPrototypeOf(document.createElement('dialog'));
  dialogProto.showModal = function () { this.setAttribute('open', ''); };
  dialogProto.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  const { phoneSplit, wirePhoneSplits, splitValue, pickCountry } = await import('../../app/js/ui/phone-field.js');
  const root = document.querySelector('main');
  root.innerHTML = phoneSplit({ dial: '91', placeholder: '90000 00000' }).s;
  const cleanup = wirePhoneSplits(root);
  const wrap = root.querySelector('[data-phone-split]');
  const cc = wrap.querySelector('[data-cc-btn]');
  assert.equal(cc.getAttribute('aria-label'), 'Select country code');
  assert.match(cc.textContent, /\+91/);

  cc.click();
  await tick();
  const dlg = document.querySelector('dialog.country-picker');
  assert.match(dlg.textContent, /Select a Country/);
  const search = dlg.querySelector('.country-search');
  const firstRow = dlg.querySelector('.country-row');
  assert.equal(firstRow.dataset.name, 'India', 'popular entries lead the list');
  search.value = 'bang';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  const rows = [...dlg.querySelectorAll('.country-row')];
  assert.deepEqual(rows.map((r) => r.dataset.name), ['Bangladesh']);
  assert.equal(rows[0].textContent.includes('+880'), true);
  rows[0].click();
  await tick();
  assert.equal(document.querySelector('dialog'), null, 'picking closes the sheet');
  assert.equal(wrap.dataset.dial, '880', 'the wrapper carries the new dial code');
  assert.match(wrap.querySelector('[data-cc-dial]').textContent, /\+880/);

  wrap.querySelector('[data-phone-national]').value = '1700 000000';
  assert.equal(splitValue(wrap), '+880 1700000000', 'forms submit the full international value');
  assert.equal(splitValue(cc.closest('[data-phone-split]')), '+880 1700000000');

  const standalone = pickCountry('44');
  await tick();
  document.querySelector('dialog .country-row.on').click();
  assert.deepEqual(await standalone, { dial: '44', name: 'United Kingdom' }, 'the current code is preselected');

  wrap.querySelector('[data-cc-btn]').click();
  await tick();
  document.querySelector('dialog [data-close]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick();
  assert.equal(wrap.dataset.dial, '880', 'closing the sheet keeps the previous code');
  cleanup();
});

test('all four phone forms use the split field, and sign-in updates its code', async () => {
  const auth = read('app/js/views/auth.js');
  assert.match(auth, /<button type="button" class="otp-cc" data-cc-btn aria-label="Select country code">/);
  assert.match(auth, /let country = String\(providers\.otpCountryCode/);
  assert.match(auth, /wirePhoneSplits\(ctx\.root, \{ onCountry: \(c\) => \{ country = c\.dial; \} \}\)/);
  for (const [file, anchor] of [
    ['app/js/views/support.js', /phoneSplit\(\{ dial: phoneInit\.dial, value: phoneInit\.rest/],
    ['app/js/views/studio.js', /phoneSplit\(\{ placeholder: '90000 00000', maxlength: 16 \}\)/],
    ['app/js/ui/add-phone.js', /phoneSplit\(\{ placeholder: '98123 45678', required: true \}\)/],
  ]) assert.match(read(file), anchor);
  assert.match(read('app/js/views/support.js'), /splitValue\(\$\('#supForm \[data-phone-split\]', ctx\.root\)\) \|\| undefined/);
  assert.match(read('app/js/views/studio.js'), /phone: splitValue\(\$\('#cf \[data-phone-split\]', ctx\.root\)\)/);
  assert.match(read('app/js/ui/add-phone.js'), /const target = fullNumber\(\);/);
  assert.match(read('app/js/icons.js'), /'chev-down': '<path d="m6 9 6 6 6-6"\/>'/);
  const css = read('app/css/styles.css');
  assert.match(css, /\.country-list \{[^}]*max-height: 54vh/);
  assert.match(css, /\.phone-cc \{[^}]*min-height: 44px/);
});

test('the home page no longer leaves a dead band between the last rail and the footer', () => {
  const css = read('app/css/styles.css');
  const mobile = css.slice(css.indexOf('@media (max-width: 899px)'));
  assert.match(mobile, /\.rails-lean \.rail:last-child \{ margin-bottom: 12px; \}/);
  assert.match(mobile, /body\[data-route="home"\] \.footer \{ margin-top: 12px; \}/);
});
