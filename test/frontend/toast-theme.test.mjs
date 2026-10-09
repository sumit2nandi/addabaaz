// Toast theme. The status bar at the bottom of the screen ("Watch history cleared", "Link copied"…)
// is a DARK panel capsule with white text, matching the menus and dialogs. Its height is 37.9px
// (padding 9.5px above and below the unchanged 14px message line).
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

test('the toast is a dark panel capsule with white text', () => {
  const toast = ruleText('.toast');
  assert.match(toast, /background:\s*rgba\(18,18,22,\s*\.97\)/, 'the fill is the dark panel colour used by the menus');
  assert.match(toast, /color:\s*var\(--text\)/, 'the message is white, like the rest of the app');
  assert.equal(token('accent'), '#b80000', 'the brand red is unchanged');
  // The ring is an INSET shadow, never a border (a border would add 2px to height and width): a faint
  // dark hairline so the white capsule keeps an edge over bright artwork.
  assert.match(toast, /box-shadow:\s*inset 0 0 0 1px rgba\(0,0,0,\s*\.08\),\s*0 10px 40px rgba\(0,0,0,\.6\)/, 'a faint light hairline INSIDE the box, plus the drop shadow');
  assert.doesNotMatch(toast, /(?:^|[;\s])border:/, 'no border property: it would grow the capsule by 2px');
  assert.doesNotMatch(toast, /backdrop-filter/, 'a solid white fill needs no glass blur');
  // Capsule shape, like the floating menu.
  assert.match(toast, /border-radius:\s*999px/, 'a capsule');
  // Neither the old light-grey bar nor the black fill remains.
  assert.doesNotMatch(css, /#f2f2f2/, 'no opaque light-grey toast background remains');
  assert.doesNotMatch(toast, /rgba\(0,\s*0,\s*0,\s*\.9\)/, 'the black capsule fill is gone');
});

test('the capsule grew ~40%, all of it as space above and below the words', () => {
  // The black capsule was 26.9px tall: a 14px/1.35 message line (18.9px) + 4px of padding twice.
  // The white capsule keeps the message line and the side rhythm, and only deepens the top/bottom
  // padding to 9.5px: 18.9 + 19 = 37.9px ≈ 141% of 26.9px.
  const toast = ruleText('.toast');
  assert.match(toast, /display:\s*flex/);
  assert.match(toast, /align-items:\s*center/);
  assert.match(toast, /gap:\s*14px/, 'the side rhythm is unchanged');
  assert.match(toast, /padding:\s*9\.5px 18px/, 'the space above and below grows from 4px to 9.5px; the sides stay 18px');
  assert.match(toast, /font-size:\s*14px/, 'the message keeps its size');
  assert.match(toast, /font-weight:\s*600/);
  assert.match(toast, /line-height:\s*1\.35/, 'the line box is untouched — only padding adds the height');
  assert.match(toast, /box-shadow:[^;]*0 10px 40px rgba\(0,0,0,\.6\)/, 'the original drop shadow is still there');

  const size = (rule) => ({
    font: Number((rule.match(/font-size:\s*(\d+(?:\.\d+)?)px/) || [])[1]),
    line: Number((rule.match(/line-height:\s*(\d+(?:\.\d+)?)/) || [])[1] || 1.5),
    padY: Number((rule.match(/padding:\s*(\d+(?:\.\d+)?(?:\.\d+)?)px/) || [])[1]),
  });
  const s = size(toast), OLD = 26.9;
  const height = s.font * s.line + s.padY * 2;
  assert.equal(Number((height / OLD * 100).toFixed(0)), 141, `the capsule is ${height.toFixed(1)}px — about 40% more than the old ${OLD}px`);
  assert.equal(Number((s.font * s.line).toFixed(1)), 18.9, 'and none of that growth came from the words');

  // The action chip stays inside the 18.9px line box, so it cannot thicken the capsule either.
  const button = ruleText('.toast button');
  assert.match(button, /font-size:\s*12\.5px/);
  assert.match(button, /line-height:\s*1\.2/);
  assert.match(button, /padding:\s*1px 9px/);
  const b = size(button);
  assert.ok(b.font * b.line + b.padY * 2 <= s.font * s.line, `the chip (${b.font * b.line + b.padY * 2}px) fits the message's line box (${s.font * s.line}px)`);
});

test('the optional action is a solid brand-red chip on the dark capsule', () => {
  const button = ruleText('.toast button');
  assert.match(button, /background:\s*var\(--accent\)/, 'a solid brand-red chip — unmistakably a button on the dark capsule');
  assert.match(button, /border:\s*0/, 'no border: the capsule keeps its exact size');
  assert.match(button, /color:\s*#fff/, 'white label on the red chip');
  assert.match(button, /border-radius:\s*999px/);
  assert.match(css, /\.toast button:hover,[^}]*background: var\(--accent-2\);/, 'it brightens on hover/focus');
});

test('white text on the dark capsule and the red chip reads clearly', () => {
  const red = token('accent');
  assert.equal(red, '#b80000');
  // #abc and #aabbcc both expand to [r, g, b].
  const rgb = (hex) => { const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const lum = (hex) => rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

  // White message on the near-black panel, and white chip label on the brand red, both clear WCAG AA.
  assert.ok(contrast('#ffffff', '#121216') >= 4.5, `white on the dark capsule is AA-legible (${contrast('#ffffff', '#121216').toFixed(2)}:1)`);
  assert.ok(contrast('#ffffff', red) >= 4.5, 'the chip label reads just as clearly');
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
