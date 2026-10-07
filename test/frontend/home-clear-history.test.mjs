// The bin at the end of the Continue Watching heading clears this profile's watch history —
// but only after the shared confirmation popup is confirmed; Cancel keeps everything.
// Run: node --test test/frontend/home-clear-history.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const cssHead = () => read('app/css/styles.css').split('\n').find((line) => line.includes('.rail-head { display: flex'));

test('home renders the bin at the right end of the Continue Watching heading and clears history after confirm', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><div id="toasts"></div></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => {};
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.IntersectionObserver = undefined;
  // linkedom has no <dialog> behaviour: give the element prototype the two methods openDialog uses.
  const dialogProto = Object.getPrototypeOf(document.createElement('dialog'));
  dialogProto.showModal = function () { this.setAttribute('open', ''); };
  dialogProto.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  let cleanup;
  try {
    const { app } = await import('../../app/js/app.js');
    const { Catalog } = await import('../../app/js/data/catalog.js');
    const { default: home } = await import('../../app/js/views/home.js');
    const catalog = new Catalog(JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8')));
    const watched = catalog.trending(1)[0];
    let cleared = 0;
    app.catalog = catalog;
    app.user = {
      account: { email: 'viewer@addabaaz.com' },
      lib: { progress: { [watched.id]: { position: 90, updatedAt: 1 } } },
      continueWatching: () => [{ video: watched }],
      resumeTarget: () => null,
      inList: () => false,
      hasReminder: () => false,
      listItems: () => [],
      recommendations: () => null,
      fraction: () => 0.5,
      clearHistory: () => { cleared++; },
    };
    const root = document.createElement('main');
    await home({ root, setTitle() {}, onCleanup(fn) { cleanup = fn; } });

    const railEl = root.querySelector('#cw-rail');
    const bin = railEl?.querySelector('button[data-clear-history]');
    assert.ok(bin, 'the Continue Watching heading carries a bin button');
    assert.equal(bin.getAttribute('aria-label'), 'Clear watch history');
    assert.ok(bin.querySelector('svg'), 'the bin renders as an icon-only button');
    const head = bin.parentElement;
    assert.ok(head.classList.contains('rail-head'), 'the bin is a child of the heading row');
    assert.equal(head.lastElementChild, bin, 'and the last one, so space-between pushes it to the right end');
    assert.ok(!head.querySelector('.see-all'), 'the right-end slot holds only the bin');
    assert.ok(!bin.closest('h2') && bin.previousElementSibling?.querySelector('h2'), 'the title block sits to its left, untouched');

    bin.click();
    await tick();
    const dlg = document.querySelector('dialog.dialog');
    assert.match(dlg.textContent, /Clear watch history\?/);
    dlg.querySelector('[data-close]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick();
    assert.equal(cleared, 0, 'Cancel keeps the history');
    assert.ok(root.querySelector('#cw-rail'), 'Cancel keeps the rail');

    root.querySelector('button[data-clear-history]').click();
    await tick();
    document.querySelector('dialog #ok').onclick();
    await tick();
    assert.equal(cleared, 1, 'confirming clears the profile watch history');
    assert.equal(root.querySelector('#cw-rail'), null, 'the empty Continue Watching rail is removed');
    assert.equal(root.querySelector('#byw-rail'), null, 'any history-seeded rail goes too');
    assert.match(document.querySelector('#toasts').textContent, /Watch history cleared/);

    cleanup();
    const before = cleared;
    root.dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick();
    assert.equal(cleared, before, 'the listener is removed with the view');
  } finally {
    cleanup?.();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('the shared rail helper accepts heading extras and home wires the destructive confirm', () => {
  const components = read('app/js/ui/components.js');
  assert.match(components, /headExtra = ''/);
  assert.match(components, /\$\{headExtra\}/);
  const view = read('app/js/views/home.js');
  assert.match(view, /id: 'cw-rail'/);
  assert.match(view, /data-clear-history aria-label="Clear watch history"/);
  assert.match(view, /confirmDialog\(\{ title: 'Clear watch history\?', text: 'This removes Continue Watching for this profile\.', confirm: 'Clear', danger: true \}\)/);
  assert.match(view, /u\.clearHistory\(\);\s*toast\('Watch history cleared'\)/);
  assert.match(view, /ctx\.onCleanup\(\(\) => ctx\.root\.removeEventListener\('click', onClear\)\)/);
});

test('home puts the history bin in the right-end slot, exactly like a rail\'s "See all" link', () => {
  const components = read('app/js/ui/components.js');
  // The action is a sibling of the title block, not part of it: .rail-head distributes its children with
  // space-between, so the last flex child is pushed to the far right — the slot "See all" occupies.
  assert.match(cssHead(), /justify-content: space-between/, 'the header pushes its last child to the right edge');
  assert.match(components, /<div><h2>\$\{title\}<\/h2>[\s\S]*?<\/div>\s*\$\{headExtra\}/, 'headExtra is a sibling of the title block');
  assert.doesNotMatch(components, /rail-title|rail-head-copy/, 'the title block is not wrapped around the action');

  // A plain white bin: no border, no background, no circle — the box is the glyph, plus a tap-target layer.
  const clear = read('app/css/styles.css').split('\n').find((line) => line.startsWith('.rail-clear {')) || '';
  assert.match(clear, /border: 0/, 'no border');
  assert.match(clear, /background: none/, 'no background');
  assert.match(clear, /color: #fff/, 'a white glyph');
  assert.doesNotMatch(clear, /border-radius/, 'no circle');
  assert.match(clear, /width: 18px; height: 18px/, 'the box is the glyph, so the row keeps its height');
  assert.match(clear, /align-self: center/, 'centred on the heading text');
  assert.doesNotMatch(clear, /--gold/, 'the gold ring is gone');
  assert.match(read('app/css/styles.css'), /\.rail-clear::after \{ content: ''; position: absolute; inset: -6px; \}/, 'the tap target is a separate layer');
  assert.match(read('app/js/views/home.js'), /class="rail-clear" data-clear-history aria-label="Clear watch history">\$\{icon\('trash', \{ size: 18 \}\)\}/);
});
