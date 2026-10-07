// Cross buttons. Every ✕ in the app — the dialog's close, the lightbox's, the sign-in / create-account
// sheet's, the player settings sheet's, the "dismiss next video" chip and the search field's clear button —
// draws in the theme's LIGHT red (--accent-soft) instead of plain white or grey, so a close reads as part of
// the red theme on the near-black page. One rule owns that colour (the "cross buttons" section at the end of
// styles.css); this suite pins the token, that rule, and the fact that it beats each button's own base
// colour in the cascade.
// Run: node --test test/frontend/close-buttons-red.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const css = read('app/css/styles.css');

/* ---------------------------------------------------------------- helpers */

// Every rule in the stylesheet, in file order (at-rule frames included; nested rules land in the same order).
const RULES = (() => {
  const out = []; const stack = []; let prelude = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') { stack.push({ sel: prelude.replace(/\/\*[\s\S]*?\*\//g, ' ').trim(), from: i + 1 }); prelude = ''; }
    else if (ch === '}') { const r = stack.pop(); if (r) out.push({ sel: r.sel, body: css.slice(r.from, i) }); prelude = ''; }
    else prelude += ch;
  }
  return out;
})();
// Rules whose selector list contains `sel` verbatim, optionally only those that set a `color`.
const rulesFor = (sel, { colorOnly = true } = {}) => RULES
  .map((r, i) => ({ ...r, i }))
  .filter((r) => !r.sel.startsWith('@') && r.sel.split(',').map((s) => s.trim()).includes(sel))
  .filter((r) => !colorOnly || /(?:^|[\s;])color\s*:/.test(r.body));
const colorOf = (body) => (body.match(/(?:^|[\s;])color\s*:\s*([^;]+)/) || [])[1]?.trim();

// [ids, classes/attrs/pseudo-classes, elements] — enough to compare the handful of selectors below.
const specificity = (sel) => {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) || []).length;
  const els = sel.replace(/[#.][\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return [ids, classes, els];
};
const beats = (a, aIndex, b, bIndex) => {
  const [ai, ac, ae] = specificity(a), [bi, bc, be] = specificity(b);
  if (ai !== bi) return ai > bi;
  if (ac !== bc) return ac > bc;
  if (ae !== be) return ae > be;
  return aIndex > bIndex;   // equal weight: the later rule wins
};

const token = (name) => (css.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim();
const hexRgb = (h) => { const s = h.replace('#', ''); const x = s.length === 3 ? [...s].map((c) => c + c).join('') : s; return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
const luminance = ([r, g, b]) => {
  const f = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [luminance(hexRgb(a)), luminance(hexRgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// Each cross: the selector the one rule uses for it, the markup that renders it, and the base rules that
// paint it a different colour and must lose.
const CROSSES = [
  { where: 'the dialog', icon: true, member: '.dlg-x', file: 'app/js/ui/dialog.js', markup: /class="dlg-x icon-btn" aria-label="Close"/, beaten: ['.icon-btn'] },
  { where: 'the lightbox', icon: true, member: '.lb-close', file: 'app/js/ui/lightbox.js', markup: /class="lb-close icon-btn" aria-label="Close"/, beaten: ['.icon-btn'] },
  { where: 'the sign-in sheet', icon: true, member: '.auth-close', file: 'app/js/views/auth.js', markup: /class="auth-close" id="authClose" aria-label="Close"/, beaten: ['.auth-close'] },
  { where: '"dismiss next video"', icon: true, member: '.next-close', file: 'app/js/views/watch.js', markup: /class="next-close icon-btn"/, beaten: ['.next-close', '.icon-btn'] },
  { where: 'the search field', icon: true, member: '#clr', file: 'app/js/views/search.js', markup: /class="icon-btn" id="clr"/, beaten: ['.icon-btn'] },
  { where: 'the player settings sheet', member: '.ytp-settings-header [data-settings-close]', file: 'app/js/players/html5.js', markup: /data-settings-close/, beaten: ['.ytp-settings-header button'] },
];

/* ---------------------------------------------------------------- the colour */

test('the theme keeps a light red for close glyphs', () => {
  const soft = token('accent-soft');
  assert.ok(soft, '--accent-soft is defined in :root');
  assert.match(soft, /^#[0-9a-f]{6}$/i, 'a plain hex colour');
  const [r, g, b] = hexRgb(soft);
  assert.ok(r > g && r > b, 'it is a red');
  assert.ok(Math.abs(g - b) <= 12, 'a red, not an orange or a pink');
  // Light: brighter than both reds the theme already had, which are fills — as a glyph on near-black they
  // all but disappear.
  assert.ok(luminance([r, g, b]) > luminance(hexRgb(token('accent'))), 'lighter than --accent');
  assert.ok(luminance([r, g, b]) > luminance(hexRgb(token('accent-2'))), 'lighter than --accent-2');
  // And still clearly legible where the ✕ sits — the dialog/panel fill and the page itself.
  assert.ok(contrast(soft, token('panel')) >= 4.5, `legible on the panel (${contrast(soft, token('panel')).toFixed(2)}:1)`);
  assert.ok(contrast(soft, token('bg')) >= 4.5, `legible on the page (${contrast(soft, token('bg')).toFixed(2)}:1)`);
  assert.ok(contrast(soft, token('text')) < contrast(token('text'), token('bg')), 'but the ✕ is still not white');
});

/* ---------------------------------------------------------------- the one rule */

test('one rule paints every ✕ in the app the light red, and it wins the cascade', () => {
  const group = RULES.filter((r) => CROSSES.every((c) => r.sel.split(',').map((s) => s.trim()).includes(c.member)));
  assert.equal(group.length, 1, 'exactly one rule lists every cross');

  for (const c of CROSSES) {
    const mine = rulesFor(c.member).find((r) => r.body === group[0].body && r.sel.includes(c.member));
    assert.ok(mine, `${c.where}: the shared rule covers ${c.member}`);
    assert.equal(colorOf(mine.body), 'var(--accent-soft)', `${c.where}: drawn in the light red`);

    // Nothing later (or heavier) repaints it, and every base colour it overrides loses.
    const painters = rulesFor(c.member);
    assert.equal(painters.at(-1).i, mine.i, `${c.where}: no later rule repaints ${c.member}`);
    for (const base of c.beaten) {
      const rival = rulesFor(base).filter((r) => r.body !== group[0].body).at(-1);
      assert.ok(rival, `${c.where}: ${base} is the base colour it overrides`);
      assert.ok(beats(c.member, mine.i, base, rival.i), `${c.where}: ${c.member} beats ${base}`);
    }
  }
  // The one deliberate exception: the sign-in sheet's ✕ fills red on hover and turns white inside it.
  const hover = rulesFor('.auth-close:hover').at(-1);
  assert.match(hover.body, /background:\s*var\(--accent\)/);
  assert.equal(colorOf(hover.body), '#fff', 'white on the filled red circle');
  assert.equal(RULES.filter((r) => /(?:^|[\s;])color\s*:/.test(r.body) && /\.auth-close(?![\w-])/.test(r.sel) && /:hover/.test(r.sel)).length, 1);
});

/* ---------------------------------------------------------------- what is actually rendered */

test('each cross is really rendered with the class that rule targets', () => {
  for (const c of CROSSES) assert.match(read(c.file), c.markup, `${c.where} renders its ✕`);
  assert.match(read('app/js/players/youtube.js'), /data-settings-close/, 'the YouTube-skin player too');
  assert.match(css, /\.ytp-settings-header button \{ [^}]*color: #fff/, 'whose shared header rule starts white');
});

test('every ✕ the app draws is either covered by that rule or deliberately not a button', () => {
  // A missing ✕ here means a new cross button was added: give it the light red in styles.css and add it to
  // this list (or to the exemptions below, with a reason).
  const files = fs.readdirSync(new URL('../../app/js', import.meta.url), { recursive: true })
    .map((p) => `app/js/${p}`)
    .filter((p) => p.endsWith('.js') && /icon\('x'/.test(read(p)))
    .sort();
  const covered = CROSSES.filter((c) => c.icon).map((c) => c.file).sort();
  const exempt = ['app/js/views/plans.js'];   // the big ✕ in the "Payment Failed" illustration (.fail-x), not a control
  assert.deepEqual(files, [...covered, ...exempt].sort(), 'no uncovered ✕ button');
  assert.match(read('app/js/views/plans.js'), /class="fail-x"/);
  assert.equal(colorOf(rulesFor('.fail-x').at(-1).body), '#fff', 'the illustration keeps its own white ink');
  assert.equal(RULES.filter((r) => r.sel.includes('.fail-x') && /--accent-soft/.test(r.body)).length, 0, 'and is not in the cross rule');
});

test('the dialog close button really carries the class the rule paints', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = document; globalThis.window = window;
  const { openDialog } = await import('../../app/js/ui/dialog.js');
  const { el } = openDialog('<h2>Clear watch history?</h2>', { title: 'Clear watch history?' });
  const x = el.querySelector('button[aria-label="Close"]');
  assert.ok(x, 'the dialog has a close button');
  assert.ok(x.classList.contains('dlg-x'), 'carrying .dlg-x — the selector the rule paints');
  assert.ok(x.classList.contains('icon-btn'), 'and .icon-btn, the white default it overrides');
  assert.ok(x.querySelector('svg'), 'drawn as the ✕ glyph');
});
