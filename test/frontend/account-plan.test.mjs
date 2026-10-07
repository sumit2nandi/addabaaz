import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { accountPlan } from '../../app/js/ui/account-plan.js';

test('current plan shows monthly/yearly access and links to plan details', () => {
  for (const [planId, label] of [['plus-yearly', 'Yearly'], ['plus-monthly', 'Monthly']]) {
    const { document } = parseHTML(accountPlan({ isPremium: true, subscription: { planId, expiresAt: '2099-10-07T00:00:00Z' } }).s);
    assert.match(document.querySelector('.account-plan-name').textContent, new RegExp(label));
    assert.match(document.querySelector('.account-field-help').textContent, /Active until/);
    assert.equal(document.querySelector('a').getAttribute('href'), '#/plans');
  }
});

test('free/expired plans do not claim active premium and absent dates render cleanly', () => {
  const expired = accountPlan({ isPremium: false, subscription: { planId: 'plus-yearly', status: 'expired', expiresAt: '2020-01-01' } }).s;
  assert.match(expired, />Free<\/p>/); assert.match(expired, /Premium expired on/);
  assert.match(accountPlan({ isPremium: false }).s, /Free access/);
  const active = accountPlan({ isPremium: true, subscription: { planId: 'plus-monthly' } }).s;
  assert.match(active, />Active<\/p>/);
  assert.doesNotMatch(active, /Invalid Date|undefined/);
});
