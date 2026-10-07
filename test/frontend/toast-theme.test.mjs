// Toast redesign. The status bar at the bottom of the screen ("Watch history cleared", "Link copied"…)
// used to be an opaque light bar with black text — the only element on the site that was not part of the
// dark, red-accented theme. It is now a BLACK capsule with brand-red text, at exactly the size it always
// had (same padding, font-size, weight, gap and shadow — see the size test at the bottom).
//
// Run: node --test test/frontend/toast-theme.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// The full declaration block of a rule (the toast rules are wrapped over several lines, so this walks
// the braces instead of reading a single line).
const ruleText = (selector) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at > -1, `${selector} is styled`);
  const open = css.indexOf('{', at);
  let depth = 0, i = open;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) break;
  }
  return css.slice(open + 1, i);
};
const token = (name) => (css.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim();

/* ---------------------------------------------------------------- the look */

test('the toast is a black capsule with brand-red text, not the old light bar', () => {
  const toast = ruleText('.toast');
  // Black, near-opaque: the blurred artwork still tints the last few percent.
  assert.match(toast, /background:\s*rgba\(0,\s*0,\s*0,\s*\.9\)/, 'the fill is black');
  assert.match(toast, /backdrop-filter:\s*blur\(/, 'black glass over the artwork');
  assert.match(toast, /-webkit-backdrop-filter:\s*blur\(/, 'with the WebKit twin for iOS');
  assert.doesNotMatch(toast, /background-image:/, 'no coloured wash on top of the black');
  // Red text on the black fill.
  assert.match(toast, /color:\s*var\(--accent-bright\)/, 'the message is brand red');
  assert.match(toast, /border:\s*1px solid rgba\(var\(--accent-rgb\),\s*\.5\)/, 'a red hairline keeps the capsule visible on the black page');
  assert.doesNotMatch(toast, /text-shadow/, 'no halo needed on a near-opaque black fill');
  // Capsule shape, like the floating menu.
  assert.match(toast, /border-radius:\s*999px/, 'a capsule');
  // The old opaque light bar is gone for good.
  assert.doesNotMatch(css, /#f2f2f2/, 'no opaque light toast background remains');
  assert.doesNotMatch(toast, /color:\s*#111/);
});

test('the toast keeps exactly the size it had before the redesign', () => {
  // The pre-redesign toast (git 84daf0c: app/css/styles.css) was:
  //   display: flex; align-items: center; gap: 14px; padding: 12px 18px; font-weight: 600;
  //   font-size: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.6);
  // Only the fill, the text colour and the box radius may differ.
  const toast = ruleText('.toast');
  assert.match(toast, /display:\s*flex/);
  assert.match(toast, /align-items:\s*center/);
  assert.match(toast, /gap:\s*14px/);
  assert.match(toast, /padding:\s*12px 18px/, 'the padding that set the old height and side rhythm');
  assert.match(toast, /font-size:\s*14px/);
  assert.match(toast, /font-weight:\s*600/, 'the old weight, not bolder (bolder text grows the line box)');
  assert.match(toast, /box-shadow:\s*0 10px 40px rgba\(0,0,0,\.6\)/, 'the original drop shadow');
  assert.doesNotMatch(toast, /letter-spacing/, 'no extra tracking: it would widen the capsule');
  // The action chip stays inside the line box the plain message would use, so adding one never resizes it.
  const button = ruleText('.toast button');
  assert.match(button, /font-size:\s*13px/);
  assert.match(button, /line-height:\s*1\.2/);
  assert.match(button, /padding:\s*5px 12px/);
});

test('the optional action is a red chip, never a solid block', () => {
  const button = ruleText('.toast button');
  assert.match(button, /background:\s*rgba\(var\(--accent-rgb\),\s*\.22\)/, 'a translucent red chip on the black capsule');
  assert.match(button, /border:\s*1px solid rgba\(var\(--accent-rgb\),\s*\.5\)/);
  assert.match(button, /color:\s*var\(--accent-bright\)/, 'the same red as the message');
  assert.match(button, /border-radius:\s*999px/);
  assert.match(css, /\.toast button:hover,[^}]*background: rgba\(var\(--accent-rgb\), \.42\); color: #fff;/, 'it brightens on hover/focus');
});

test('the red used for text is the lightened brand tint and passes contrast on the dark page', () => {
  const bright = token('accent-bright');
  assert.match(bright, /^#[0-9a-f]{6}$/i, '--accent-bright is a plain hex colour');
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (hex) => rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

  // The deep brand reds are unreadable on the near-black page: the text tint must be a lighter red.
  for (const dark of ['accent', 'accent-2']) assert.ok(lum(bright) > lum(token(dark)), `${bright} is lighter than ${token(dark)}`);
  assert.ok(contrast(bright, token('bg')) >= 4.5, `${bright} on the page background ${token('bg')} reads clearly`);
  // And it stays red: the red channel dominates by a wide margin.
  const [r, g, b] = rgb(bright);
  assert.ok(r > 200 && g < 140 && b < 140 && r - Math.max(g, b) > 80, 'the hue is clearly red, not pink or orange');
});

/* ---------------------------------------------------------------- behaviour */

test('toast() still renders a status message, an action chip and clears itself', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><div id="toasts"></div></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
  const timers = [];
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push(ms); return timers.length; };
  try {
    const { toast } = await import('../../app/js/ui/components.js');
    toast('Watch history cleared');
    const host = document.querySelector('#toasts');
    const el = host.querySelector('.toast');
    assert.equal(host.textContent, 'Watch history cleared', 'the message is shown');
    assert.equal(el.getAttribute('role'), 'status', 'and announced to screen readers');
    assert.ok(el.classList.contains('show'), 'it slides in');
    assert.ok(timers.includes(3200), 'and leaves on its own');

    toast('ADDABAAZ was updated — restart the app to load the latest version.', { action: 'Restart', onAction() {} });
    assert.equal(host.querySelectorAll('.toast').length, 1, 'a new toast replaces the old one');
    const btn = host.querySelector('.toast button');
    assert.equal(btn.textContent, 'Restart', 'the action rides inside the pill');
    assert.ok(el.classList !== undefined);
  } finally { globalThis.setTimeout = realTimeout; }
});

test('the toast host keeps floating above the slim menu', () => {
  const host = ruleText('.toasts');
  assert.match(host, /position:\s*fixed/, 'it floats over the page');
  assert.match(host, /bottom:\s*calc\(var\(--tabbar-h\) \+ var\(--sab\) \+ 16px\)/, 'parked above the floating menu and the safe area');
  assert.match(host, /z-index:\s*500/, 'above dialogs, the top bar and the menu');
  assert.match(host, /pointer-events:\s*none/, 'the host itself never swallows taps');
  assert.match(ruleText('.toast'), /pointer-events:\s*auto/, 'only the toast takes them (for its action chip)');
  assert.match(read('app/js/ui/components.js'), /const host = document\.getElementById\('toasts'\)/, 'the host is the #toasts container in index.html');
});
