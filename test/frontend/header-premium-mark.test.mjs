import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

// The header brand wears a small superscript premium word for paid subscribers only — hidden for
// everyone else, and refreshed without a reload when the account (or route) changes.
test('header shows the premium exponent for subscribers, hides it otherwise', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><header id="topbar" class="topbar"></header><nav id="tabbar" class="tabbar"></nav><main id="view"></main></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.ADDABAAZ_ENV = {};

  const { app } = await import('../../app/js/app.js');
  const { renderShell, renderProfileMenu, markActive } = await import('../../app/js/ui/shell.js');
  const user = (premium) => ({
    supportsAuth: true, isPremium: premium, account: { id: 'u1' },
    profile: { id: 'p1', name: 'V', color: 0 }, profiles: [{ id: 'p1', name: 'V', color: 0 }], activeId: 'p1',
  });
  app.user = user(false);
  renderShell();

  const sup = () => document.querySelector('#brandPremium');
  assert.ok(sup(), 'the header brand carries a premium exponent slot');
  assert.equal(sup().textContent, 'premium');
  assert.ok(sup().classList.contains('premium-word'), '...in the golden wordmark style');
  assert.equal(sup().getAttribute('aria-hidden'), 'true', '...decorative to screen readers');
  assert.equal(sup().hidden, true, 'free viewers see no exponent');

  app.user = user(true);
  renderProfileMenu();
  assert.equal(sup().hidden, false, 'subscribers get the exponent with no reload');

  app.user = user(false);
  markActive({ path: '/shows' });
  assert.equal(sup().hidden, true, 'every navigation re-syncs it (expiry or sign-out hides it again)');

  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.brand-text \.premium-sup \{[^}]*align-self: flex-start/,
    'the header exponent pins to the top of the flex-row brand');

  const main = fs.readFileSync(new URL('../../app/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /app\.user\.on\('subscription', renderProfileMenu\)/,
    'buying (or ending) a plan re-renders the menus, so the header exponent flips with no reload');
});
