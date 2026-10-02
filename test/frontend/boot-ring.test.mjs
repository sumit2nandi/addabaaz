// The boot loader's spinner must revolve exactly around the edges of the logo: the ring's circle
// has to sit on the logo's rim, not float outside it. Run: node --test test/frontend/boot-ring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
const block = (selector) => {
  const line = css.split('\n').find((l) => l.startsWith(`${selector} {`));
  return line ? line.slice(line.indexOf('{') + 1, line.indexOf('}')) : '';
};
const px = (decl, prop) => {
  const m = decl.match(new RegExp(`(?:^|[\\s;])${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? Number(m[1]) : null;
};

test('the boot ring hugs the logo edge (inset = (mark - logo) / 2)', () => {
  const mark = block('.boot-mark');
  const logo = block('.boot-mark img');
  const ring = block('.boot-ring');
  const markSize = px(mark, 'width'), logoSize = px(logo, 'width'), inset = px(ring, 'inset');
  assert.equal(markSize, px(mark, 'height'), 'the mark box is square');
  assert.ok(markSize > 0 && logoSize > 0 && inset != null, 'mark, logo and ring sizes are declared in px');
  assert.equal(inset, (markSize - logoSize) / 2, 'the ring circle lands exactly on the logo rim');
  assert.match(ring, /border-radius:\s*50%/, 'the ring is a circle');
  assert.match(ring, /animation:\s*spin/, 'and it revolves');
});

test('the ring is a thick Material-style indeterminate spinner (round caps, track, sweep)', () => {
  const circ = block('.boot-ring circle');
  const arc = block('.boot-ring .arc');
  const sw = Number((circ.match(/stroke-width:\s*([\d.]+)/) || [])[1]);
  assert.ok(sw >= 6, `the stroke is thick (${sw} units on a 100-unit viewBox, was 3px before)`);
  assert.match(circ, /stroke-linecap:\s*round/, 'Material round line caps');
  assert.match(block('.boot-ring .tr'), /stroke:\s*rgba\(255,255,255/, 'a faint track behind the arc');
  assert.match(arc, /stroke:\s*var\(--accent\)/, 'the sweep is the brand red');
  assert.match(arc, /animation:\s*bootarc/, 'the arc grows and shrinks (indeterminate)');
  assert.match(css, /@keyframes bootarc/, 'with its own keyframes');
});

test('the splash markup is logo image plus the ring', () => {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const boot = html.match(/<div id="boot"[\s\S]*?<\/div><\/div>/);
  assert.ok(boot, 'a #boot splash exists in index.html');
  assert.match(boot[0], /class="boot-mark"><img[^>]*media\/icons\//, 'the logo image is inside .boot-mark');
  assert.match(boot[0], /<span class="boot-ring"/, 'the ring spans the logo');
  assert.match(boot[0], /boot-ring[^>]*><svg[^>]*><circle class="tr"[\s\S]*<circle class="arc"/, 'the ring is an SVG track + arc spinner');
});
