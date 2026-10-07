import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { app } from '../../app/js/app.js';

test('web guests see premium pricing and a sign-in CTA, not unavailable payments', async () => {
  const oldWindow = globalThis.window, oldUser = app.user;
  const { window, document } = parseHTML('<main></main>');
  globalThis.window = window;
  try {
    const { default: plans } = await import('../../app/js/views/plans.js');
    for (const provider of ['none', 'mock', 'razorpay']) {
      app.user = { supportsAuth: true, account: null, isPremium: false, plans: async () => ({
        plans: [{ id: 'free', name: 'Free', priceINR: 0, features: [] },
          { id: 'plus-monthly', interval: 'month', priceINR: 99, features: ['Premium originals'] },
          { id: 'plus-yearly', interval: 'year', priceINR: 799, features: ['Premium originals'] }],
        payments: { provider }, billing: {},
      }) };
      const root = document.createElement('main');
      await plans({ root, query: { next: '/watch/demo' }, setTitle() {}, onCleanup() {} });
      assert.ok(root.querySelector('.plus-card'));
      assert.equal(root.querySelectorAll('.dur').length, 2);
      assert.match(root.textContent, /₹99/);
      assert.match(root.textContent, /₹799/);
      assert.doesNotMatch(root.textContent, /Payments aren’t available|Demo checkout|your current plan/);
      const cta = root.querySelector('a.paybar');
      assert.equal(cta.textContent, 'Sign in to subscribe');
      assert.equal(cta.getAttribute('href'), '#/signin?next=' + encodeURIComponent('/plans?next=' + encodeURIComponent('/watch/demo')));
      assert.equal(root.querySelector('[data-pay], [data-coupon]'), null);
    }
  } finally {
    app.user = oldUser;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});
