// Toast redesign. The status bar at the bottom of the screen ("Watch history cleared", "Link copied"…)
// used to be an opaque light bar with black text — the only element on the site that was not part of the
// dark, red-accented theme. It is now a mostly TRANSPARENT frosted-glass pill with brand-red text, a red
// hairline, a red glow and a dark text-shadow (which is what keeps the red readable when a toast lands
// over bright artwork).
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

test('the toast is transparent glass with brand-red text, not the old light bar', () => {
  const toast = ruleText('.toast');
  // Transparent: a low-alpha dark fill (the blurred page shows through) plus an inner red wash.
  const fill = toast.match(/background-color:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*\.?(\d+)\)/);
  assert.ok(fill, 'the fill is an rgba colour');
  assert.ok(Number(`0.${fill[4]}`) < 0.7, `the fill stays translucent (alpha ${fill[4]})`);
  assert.match(toast, /backdrop-filter:\s*blur\(/, 'the glass is frosted');
  assert.match(toast, /-webkit-backdrop-filter:\s*blur\(/, 'with the WebKit twin for iOS');
  assert.match(toast, /background-image:[^;]*radial-gradient\([^;]*rgba\(var\(--accent-rgb\)/, 'and a soft red wash from the top-left corner');
  // Red text on the dark page.
  assert.match(toast, /color:\s*var\(--accent-bright\)/, 'the message is brand red');
  assert.match(toast, /border:\s*1px solid rgba\(var\(--accent-rgb\),\s*\.55\)/, 'a red hairline frames it');
  assert.match(toast, /box-shadow:[^;]*rgba\(var\(--accent-rgb\)/, 'with a red glow around the pill');
  assert.match(toast, /text-shadow:\s*0 0 12px rgba\(0,0,0,\.95\),\s*0 1px 3px rgba\(0,0,0,\.9\)/, 'and a dark halo that keeps the red legible over bright artwork');
  assert.match(toast, /border-radius:\s*999px/, 'a pill, like the floating menu');
  assert.match(toast, /font-weight:\s*700/, 'bold enough to read at a glance over artwork');
  // The old opaque light bar is gone for good.
  assert.doesNotMatch(css, /#f2f2f2/, 'no opaque light toast background remains');
  assert.doesNotMatch(ruleText('.toast'), /color:\s*#111/);
});

test('the optional action is a red chip, never a solid block', () => {
  const button = ruleText('.toast button');
  assert.match(button, /background:\s*rgba\(var\(--accent-rgb\),\s*\.2\)/, 'a translucent red chip');
  assert.match(button, /border:\s*1px solid rgba\(var\(--accent-rgb\),\s*\.55\)/);
  assert.match(button, /color:\s*var\(--accent-bright\)/, 'the same red as the message');
  assert.match(button, /border-radius:\s*999px/);
  assert.match(css, /\.toast button:hover,[^}]*background: rgba\(var\(--accent-rgb\), \.38\); color: #fff;/, 'it brightens on hover/focus');
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
