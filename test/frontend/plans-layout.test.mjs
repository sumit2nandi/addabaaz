import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('website checkout is one Plus card with duration tiles and a single pay button', () => {
  const plans = read('app/js/views/plans.js');
  const css = read('app/css/styles.css');

  assert.match(plans, /const plusCard = html`<div class="plus-card">/,
    'one Plus card holds the purchase UI');
  assert.match(plans, /data-sel="\$\{p\.id\}"/,
    'each paid plan is a selectable tile');
  assert.match(plans, /<b>₹\$\{p\.priceINR\}<\/b><small>/,
    'tiles show the price and period');
  assert.match(plans, /Just ₹\$\{Math\.round\(p\.priceINR \/ 12\)\}\/month/,
    'yearly shows the per-month hint');
  assert.match(plans, /class="btn btn-primary btn-lg block paybar" data-pay/,
    'a single pay button buys the selected tile');
  assert.match(plans, /const b = pay \? \{ dataset: \{ plan: sel \} \} : e\.target\.closest\('\[data-plan\]'\)/,
    'paying reuses the existing purchase flow with the selected plan');
  assert.match(plans, /\$\{canBuy \? plusCard : legacyCards\}/,
    'the selector renders only when buying is possible');
  assert.match(css, /\.dur\.is-sel \{[^}]*box-shadow/,
    'the selected tile glows');
  assert.match(css, /\.dur\.is-current \{[^}]*border-color: var\(--gold\)/,
    'the current-plan tile gets its own color');
});

test('read-only plan cards stay for native apps and payment-less servers', () => {
  const plans = read('app/js/views/plans.js');

  assert.match(plans, /const legacyCards = html`<div class="plans">/,
    'the legacy cards still exist');
  assert.match(plans, /<span class="badge cur">Current plan<\/span>/,
    'the current plan gets a badge there too');
});
