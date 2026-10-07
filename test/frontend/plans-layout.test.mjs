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

test('buying skips straight to payment: coupon popup, cancel screen, celebration', () => {
  const plans = read('app/js/views/plans.js');
  const css = read('app/css/styles.css');

  assert.match(plans, /data-coupon>Apply Coupon<\//,
    'a small Apply Coupon link sits under the pay button');
  assert.match(plans, /<h2>Apply Coupon<\/h2>/,
    '...opening a coupon popup');
  assert.match(plans, /<s>\$\{inr\(pr\.listPaise\)\}<\/s>/,
    'a discount strikes through the original price on the pay button');
  assert.match(plans, /<h2>Payment Failed<\/h2>.*Retry Payment.*View Plans/,
    'cancelling shows the retry/view-plans screen');
  assert.match(plans, /d\.className = 'celebrate'/,
    'success shows a full-screen celebration');
  assert.match(plans, /<div class="confetti">\$\{raw\(bits\)\}<\/div>/,
    'confetti markup is injected unescaped (plain interpolation would print as text)');
  assert.match(plans, /data-cel>Start watching<\//,
    '...with a way forward');
  assert.match(plans, /name="usec" data-usec/,
    'credit is a checkbox on the page, not in a dialog');
  assert.match(css, /\.celebrate \{[^}]*position: fixed/,
    'the celebration covers the screen');
  assert.match(css, /@keyframes confFall/,
    'confetti falls');
});

test('the Premium brand word is italic, bold and glittery gold', () => {
  const plans = read('app/js/views/plans.js');
  const css = read('app/css/styles.css');

  assert.match(plans, /<h2><span class="brand-lockup"><b>ADDA<\/b><i>BAAZ<\/i> <em class="premium-word">premium<\/em><\/span><\/h2>/,
    'the purchase card titles it with the header-style lockup and a superscript premium');
  assert.match(css, /\.brand-lockup b \{[^}]*background-clip: text/,
    '...ADDA in the header white gradient');
  assert.match(css, /\.brand-lockup i \{[^}]*color: var\(--accent\)/,
    '...BAAZ in header red');
  assert.match(css, /\.brand-lockup \.premium-word \{[^}]*font-size: 12\.5px[^}]*vertical-align: super/,
    '...premium small and raised like an exponent');
  assert.match(plans, /: \{ title: 'Choose your plan', subtitle: 'Pay once for the period/,
    'the header opens directly on the title, with no brand eyebrow above it');
  assert.doesNotMatch(plans, /tag: html`ADDABAAZ/,
    'no ADDABAAZ premium eyebrow remains on the plans header');
  assert.match(css, /\.premium-word \{[^}]*font-style: italic; font-weight: 800;[^}]*background-clip: text/,
    'the brand word is italic bold gold gradient text');
  assert.match(css, /@keyframes premium-shine/,
    '...with a slow shine sweep');
});

test('read-only plan cards stay for native apps and payment-less servers', () => {
  const plans = read('app/js/views/plans.js');

  assert.match(plans, /const legacyCards = html`<div class="plans">/,
    'the legacy cards still exist');
  assert.match(plans, /<span class="badge cur">Current plan<\/span>/,
    'the current plan gets a badge there too');
});
